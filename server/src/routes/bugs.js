import { Router } from 'express';
import BugReport from '../models/BugReport.js';
import { requireAuth } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { sendBugReportNotice } from '../lib/mailer.js';
import { asyncHandler } from '../lib/http.js';

const router = Router();

// Screenshots arrive as data URLs the client already downscaled. Cap count and
// per-image size anyway — the client is not the only possible caller.
const MAX_IMAGES = 3;
// ~1.5MB of binary ≈ 2M base64 chars — far above what the client produces.
const MAX_IMAGE_CHARS = 2_000_000;
const IMAGE_PREFIX = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

// A handful of reports per hour per client is plenty; more is spam.
const reportLimiter = rateLimit({ name: 'bugs', windowMs: 60 * 60_000, max: 5 });

router.use(requireAuth);

// POST /api/bugs { description, images? } — file a bug report. The reporter's
// name/email are taken from the account (never from the body), and the admin
// is notified by email. Answers come back as in-app messages.
router.post('/', reportLimiter, asyncHandler(async (req, res) => {
  const description = (typeof req.body.description === 'string' ? req.body.description : '').trim();
  if (description.length < 5) {
    return res.status(400).json({ error: 'תיאור התקלה קצר מדי — ספרו לנו מה קרה' });
  }
  if (description.length > 4000) {
    return res.status(400).json({ error: 'תיאור התקלה ארוך מדי (עד 4000 תווים)' });
  }

  const raw = Array.isArray(req.body.images) ? req.body.images : [];
  if (raw.length > MAX_IMAGES) {
    return res.status(400).json({ error: `אפשר לצרף עד ${MAX_IMAGES} תמונות` });
  }
  const images = [];
  for (const img of raw) {
    if (typeof img !== 'string' || img.length > MAX_IMAGE_CHARS || !IMAGE_PREFIX.test(img)) {
      return res.status(400).json({ error: 'אחת התמונות אינה תקינה או גדולה מדי' });
    }
    images.push(img);
  }

  const report = await BugReport.create({
    user: req.userId,
    name: req.user.name || '',
    email: req.user.email,
    description,
    images,
    userAgent: String(req.headers['user-agent'] || '').slice(0, 300),
  });

  // Best-effort admin notification — the report is already saved either way.
  try {
    await sendBugReportNotice({
      email: report.email,
      name: report.name,
      description,
      imagesCount: images.length,
    });
  } catch (e) {
    console.error('[bugs] failed to email admin:', e.message);
  }

  res.status(201).json({ ok: true, id: report._id });
}));

// GET /api/bugs/mine — the user's own reports (status + reply), newest first,
// so the report dialog can show what happened to previous reports.
router.get('/mine', asyncHandler(async (req, res) => {
  const reports = await BugReport.find({ user: req.userId })
    .select('description status adminReply createdAt')
    .sort({ createdAt: -1 })
    .limit(20)
    .lean();
  res.json({ reports });
}));

export default router;
