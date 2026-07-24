import { Router } from 'express';
import mongoose from 'mongoose';
import { requireAuth } from '../middleware/auth.js';
import { isAdmin, AUTO_APPROVED_EMAILS } from '../lib/approval.js';
import { usageSummary } from '../lib/usage.js';
import { asyncHandler, isValidEmail } from '../lib/http.js';
import BugReport from '../models/BugReport.js';
import Message from '../models/Message.js';
import User from '../models/User.js';
import Day from '../models/Day.js';
import Product from '../models/Product.js';
import MealTemplate from '../models/MealTemplate.js';
import Conversation from '../models/Conversation.js';

const router = Router();

// All admin routes require a logged-in admin. requireAuth attaches req.user;
// non-admins get a 403 so the client hides the dashboard rather than erroring.
router.use(requireAuth);
router.use((req, res, next) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'למנהלים בלבד' });
  next();
});

// Fold a [{ _id: userId, ... }] aggregation result into a Map keyed by the
// stringified user id, for the per-user merges below.
const byUser = (rows) => new Map(rows.map((r) => [String(r._id), r]));

// GET /api/admin/users -> every account with its activity overview: journal
// stats (days/meals/weigh-ins), content counts, AI costs, approval state and a
// derived "last active". One $group per collection — no per-user queries.
router.get('/users', asyncHandler(async (req, res) => {
  const [users, dayRows, productRows, templateRows, convRows, bugRows, usage] =
    await Promise.all([
      User.find().select('email name approved createdAt updatedAt whatsappPhone').lean(),
      Day.aggregate([
        {
          $group: {
            _id: '$user',
            days: { $sum: 1 },
            meals: { $sum: { $size: { $ifNull: ['$meals', []] } } },
            // metrics.weight is a string; '' means no weigh-in that day
            weighIns: { $sum: { $cond: [{ $gt: [{ $ifNull: ['$metrics.weight', ''] }, ''] }, 1, 0] } },
            closedDays: { $sum: { $cond: ['$closed', 1, 0] } },
            lastDayDate: { $max: '$date' }, // 'YYYY-MM-DD' — string max is date max
            lastDayTouch: { $max: '$updatedAt' },
          },
        },
      ]),
      Product.aggregate([{ $group: { _id: '$user', n: { $sum: 1 } } }]),
      MealTemplate.aggregate([{ $group: { _id: '$user', n: { $sum: 1 } } }]),
      Conversation.aggregate([{ $group: { _id: '$user', n: { $sum: 1 }, last: { $max: '$updatedAt' } } }]),
      BugReport.aggregate([{ $match: { status: 'open' } }, { $group: { _id: '$user', n: { $sum: 1 } } }]),
      usageSummary(),
    ]);

  const days = byUser(dayRows);
  const products = byUser(productRows);
  const templates = byUser(templateRows);
  const convs = byUser(convRows);
  const bugs = byUser(bugRows);
  const costs = new Map(usage.rows.map((r) => [r.userId, r]));

  const rows = users.map((u) => {
    const id = String(u._id);
    const d = days.get(id);
    const c = convs.get(id);
    const cost = costs.get(id);
    // Latest sign of life across journal edits, assistant chats and profile
    // saves. updatedAt exists on every model (timestamps: true).
    const lastActive = [d?.lastDayTouch, c?.last, u.updatedAt]
      .filter(Boolean)
      .reduce((m, t) => (m && m > t ? m : t), null);
    return {
      id,
      email: u.email,
      name: u.name || '',
      approved: u.approved === true,
      autoApproved: AUTO_APPROVED_EMAILS.has(u.email),
      whatsappLinked: Boolean(u.whatsappPhone),
      createdAt: u.createdAt,
      lastActive,
      days: d?.days || 0,
      meals: d?.meals || 0,
      weighIns: d?.weighIns || 0,
      closedDays: d?.closedDays || 0,
      lastDayDate: d?.lastDayDate || '',
      products: products.get(id)?.n || 0,
      templates: templates.get(id)?.n || 0,
      conversations: c?.n || 0,
      openBugs: bugs.get(id)?.n || 0,
      costUsd: cost?.costUsd || 0,
      cost30d: cost?.cost30d || 0,
      byKind: cost?.byKind || {},
    };
  });
  rows.sort((a, b) => new Date(b.lastActive || 0) - new Date(a.lastActive || 0));

  res.json({
    users: rows,
    totals: { users: rows.length, totalUsd: usage.totalUsd, total30d: usage.total30d },
  });
}));

// GET /api/admin/users/:id -> drill-down lists for one user: their last 30
// journal days, recent bug reports and recent inbox messages. The overview row
// already carries the counters, so this only fetches what expands.
router.get('/users/:id', asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(404).json({ error: 'המשתמש לא נמצא' });
  }
  const uid = new mongoose.Types.ObjectId(req.params.id);
  const [recentDays, bugs, messages] = await Promise.all([
    Day.aggregate([
      { $match: { user: uid } },
      { $sort: { date: -1 } },
      { $limit: 30 },
      {
        $project: {
          _id: 0,
          date: 1,
          closed: 1,
          weight: { $ifNull: ['$metrics.weight', ''] },
          mealsCount: { $size: { $ifNull: ['$meals', []] } },
          updatedAt: 1,
        },
      },
    ]),
    BugReport.find({ user: uid }).sort({ createdAt: -1 }).limit(10)
      .select('status description createdAt').lean(),
    Message.find({ user: uid }).sort({ createdAt: -1 }).limit(10)
      .select('type title body read createdAt').lean(),
  ]);
  res.json({ recentDays, bugs, messages });
}));

// POST /api/admin/users/:id/approval { approved } -> flip the access gate.
// approved:false covers both "still pending" and "revoked": requireAuth starts
// returning 401, the client drops its token on the next poll (~2 min) and login
// is refused until re-approved. Auto-approved accounts bypass the flag entirely
// (isApproved checks the email list first), so revoking one would be a silent
// no-op — refuse it instead of pretending.
router.post('/users/:id/approval', asyncHandler(async (req, res) => {
  const user = mongoose.isValidObjectId(req.params.id)
    ? await User.findById(req.params.id)
    : null;
  if (!user) return res.status(404).json({ error: 'המשתמש לא נמצא' });
  const approved = Boolean(req.body.approved);
  if (!approved && AUTO_APPROVED_EMAILS.has(user.email)) {
    return res.status(400).json({ error: 'חשבון באישור אוטומטי — אי אפשר לחסום' });
  }
  user.approved = approved;
  await user.save();
  res.json({ ok: true, approved: user.approved });
}));

// GET /api/admin/messages -> history of broadcast system messages with read
// counts. Targeted messages (audience 'user') are deliberately excluded — they
// live inside the recipient's card in the admin panel. A broadcast creates one
// Message per recipient, so rows are grouped back by (title, body,
// send-minute); the minute key keeps a re-send of the same text on another day
// as its own row.
router.get('/messages', asyncHandler(async (req, res) => {
  const groups = await Message.aggregate([
    { $match: { type: 'system', audience: 'all' } },
    {
      $group: {
        _id: {
          title: '$title',
          body: '$body',
          minute: { $dateToString: { date: '$createdAt', format: '%Y-%m-%dT%H:%M' } },
        },
        sent: { $sum: 1 },
        read: { $sum: { $cond: ['$read', 1, 0] } },
        createdAt: { $min: '$createdAt' },
      },
    },
    { $sort: { createdAt: -1 } },
    { $limit: 50 },
  ]);

  res.json({
    groups: groups.map((g) => ({
      title: g._id.title,
      body: g._id.body,
      createdAt: g.createdAt,
      sent: g.sent,
      read: g.read,
    })),
  });
}));

// GET /api/admin/bugs -> every bug report, newest first, screenshots included.
router.get('/bugs', asyncHandler(async (req, res) => {
  const reports = await BugReport.find().sort({ createdAt: -1 }).limit(200).lean();
  res.json({ reports });
}));

// POST /api/admin/bugs/:id/reply { reply, status? } -> answer a bug report.
// Saves the reply on the report and delivers it to the reporter as an in-app
// message (that's where "the bug response" arrives for the user).
router.post('/bugs/:id/reply', asyncHandler(async (req, res) => {
  const reply = (typeof req.body.reply === 'string' ? req.body.reply : '').trim();
  if (!reply) return res.status(400).json({ error: 'כתבו תשובה לפני השליחה' });
  if (reply.length > 4000) return res.status(400).json({ error: 'התשובה ארוכה מדי (עד 4000 תווים)' });
  const status = ['answered', 'closed'].includes(req.body.status) ? req.body.status : 'answered';

  const report = await BugReport.findById(req.params.id);
  if (!report) return res.status(404).json({ error: 'הדיווח לא נמצא' });

  report.adminReply = reply;
  report.status = status;
  await report.save();

  await Message.create({
    user: report.user,
    type: 'bug_reply',
    title: 'תשובה לדיווח התקלה שלך',
    body: reply,
    bugReport: report._id,
  });

  res.json({ ok: true });
}));

// POST /api/admin/messages { title, body, email? } -> system message. With an
// email it goes to that user only; without, it's broadcast to every approved
// account (release notes, maintenance notices, etc.).
router.post('/messages', asyncHandler(async (req, res) => {
  const title = (typeof req.body.title === 'string' ? req.body.title : '').trim();
  const body = (typeof req.body.body === 'string' ? req.body.body : '').trim();
  if (!title) return res.status(400).json({ error: 'כותרת ההודעה נדרשת' });
  if (title.length > 120) return res.status(400).json({ error: 'הכותרת ארוכה מדי (עד 120 תווים)' });
  if (body.length > 4000) return res.status(400).json({ error: 'ההודעה ארוכה מדי (עד 4000 תווים)' });

  const email = (typeof req.body.email === 'string' ? req.body.email : '').trim().toLowerCase();
  let userIds;
  if (email) {
    if (!isValidEmail(email)) return res.status(400).json({ error: 'כתובת אימייל לא תקינה' });
    const target = await User.findOne({ email }).select('_id').lean();
    if (!target) return res.status(404).json({ error: 'לא נמצא משתמש עם האימייל הזה' });
    userIds = [target._id];
  } else {
    const users = await User.find({ approved: true }).select('_id').lean();
    userIds = users.map((u) => u._id);
  }

  await Message.insertMany(
    userIds.map((user) => ({ user, type: 'system', audience: email ? 'user' : 'all', title, body }))
  );
  res.json({ ok: true, sent: userIds.length });
}));

export default router;
