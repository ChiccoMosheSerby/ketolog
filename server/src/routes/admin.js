import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { isAdmin } from '../lib/approval.js';
import { usageSummary } from '../lib/usage.js';
import { asyncHandler, isValidEmail } from '../lib/http.js';
import BugReport from '../models/BugReport.js';
import Message from '../models/Message.js';
import User from '../models/User.js';

const router = Router();

// All admin routes require a logged-in admin. requireAuth attaches req.user;
// non-admins get a 403 so the client hides the dashboard rather than erroring.
router.use(requireAuth);
router.use((req, res, next) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'למנהלים בלבד' });
  next();
});

// GET /api/admin/usage -> per-user AI cost breakdown (what each user costs me).
router.get('/usage', asyncHandler(async (req, res) => {
  res.json(await usageSummary());
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
    userIds.map((user) => ({ user, type: 'system', title, body }))
  );
  res.json({ ok: true, sent: userIds.length });
}));

export default router;
