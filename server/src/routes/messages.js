import { Router } from 'express';
import Message from '../models/Message.js';
import BugReport from '../models/BugReport.js';
import { requireAuth } from '../middleware/auth.js';
import { isAdmin } from '../lib/approval.js';
import { asyncHandler } from '../lib/http.js';

const router = Router();

router.use(requireAuth);

// One-time "what's new" announcement, lazily seeded into the inbox of every
// account that predates the new header menu (2026-07-23). The title doubles as
// the dedup key — it's inserted at most once per user. New sign-ups skip it:
// their onboarding tour already covers everything listed here.
const WHATS_NEW_SHIPPED = new Date('2026-07-23T00:00:00Z');
const WHATS_NEW_TITLE = 'מה חדש: תפריט משתמש, הודעות ודיווח תקלות 🎉';
const WHATS_NEW_BODY =
  'עדכנו את האפליקציה — הנה מה שהתווסף:\n\n' +
  '👤 תפריט משתמש חדש בכותרת — השם שלך, הגדרות, מצב בהיר/כהה והתנתקות במקום אחד.\n' +
  '📬 הודעות — ההודעה הזו הגיעה לכאן! כאן יגיעו גם תשובות לדיווחים, עדכונים והודעות מערכת. נקודה אדומה על התפריט = משהו חדש.\n' +
  '🐞 דיווח על תקלה — נתקלתם בבעיה? מדווחים מהתפריט, עם עד 3 צילומי מסך (אפשר גם להדביק מהלוח). התשובה תחזור לכאן.\n' +
  '🔑 קיצור להזנת מפתח API — ישר מהתפריט.\n' +
  '✏️ שם תצוגה — אפשר להגדיר בהגדרות איך נציג אתכם.\n\n' +
  'רוצים רענון מלא? הגדרות ← סיור מודרך.';

async function seedWhatsNew(user) {
  if (!user.createdAt || user.createdAt >= WHATS_NEW_SHIPPED) return;
  const exists = await Message.findOne({ user: user._id, type: 'update', title: WHATS_NEW_TITLE })
    .select('_id')
    .lean();
  if (exists) return;
  await Message.create({ user: user._id, type: 'update', title: WHATS_NEW_TITLE, body: WHATS_NEW_BODY });
}

// GET /api/messages — the user's inbox, newest first, plus the unread count
// (drives the badge in the header). For admins the same poll also reports how
// many bug reports are still open, so new reports light up the menu too.
router.get('/', asyncHandler(async (req, res) => {
  await seedWhatsNew(req.user);
  const [messages, unread, openBugs] = await Promise.all([
    Message.find({ user: req.userId }).sort({ createdAt: -1 }).limit(100).lean(),
    Message.countDocuments({ user: req.userId, read: false }),
    isAdmin(req.user) ? BugReport.countDocuments({ status: 'open' }) : 0,
  ]);
  res.json({ messages, unread, openBugs });
}));

// POST /api/messages/read-all — clear the badge once the panel has been opened.
router.post('/read-all', asyncHandler(async (req, res) => {
  await Message.updateMany({ user: req.userId, read: false }, { read: true });
  res.json({ ok: true });
}));

export default router;
