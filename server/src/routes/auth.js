import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { requireAuth } from '../middleware/auth.js';
import {
  AUTO_APPROVED_EMAILS,
  isApproved,
  makeApprovalToken,
  readApprovalToken,
} from '../lib/approval.js';
import { sendApprovalRequest } from '../lib/mailer.js';

const router = Router();

function signToken(user) {
  return jwt.sign({ sub: user._id.toString() }, process.env.JWT_SECRET, { expiresIn: '30d' });
}

const userPayload = (u) => ({ id: u._id, email: u.email, dailyCarbTarget: u.dailyCarbTarget });

// Base URL for the approval link in the email.
//   1. APP_URL env wins if set (explicit override, trailing slash trimmed)
//   2. production  → the deployed origin
//   3. development → local API server
const PROD_URL = 'https://ketolog.onrender.com';
const baseUrl = () => {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/+$/, '');
  if (process.env.NODE_ENV === 'production') return PROD_URL;
  return `http://localhost:${process.env.PORT || 4000}`;
};

const PENDING_MSG = 'החשבון שלך נוצר וממתין לאישור מנהל. תקבל גישה לאחר האישור.';

router.post('/register', async (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  const password = req.body.password || '';
  if (!email || !password) return res.status(400).json({ error: 'אימייל וסיסמה נדרשים' });
  if (password.length < 6) return res.status(400).json({ error: 'הסיסמה חייבת להכיל לפחות 6 תווים' });

  const exists = await User.findOne({ email });
  if (exists) return res.status(409).json({ error: 'משתמש עם אימייל זה כבר קיים' });

  const passwordHash = await bcrypt.hash(password, 10);
  const autoApproved = AUTO_APPROVED_EMAILS.has(email);
  const user = await User.create({ email, passwordHash, approved: autoApproved });

  // Admins are let straight in; everyone else waits for the admin to click the
  // approval link we email out now.
  if (autoApproved) {
    return res.status(201).json({ token: signToken(user), user: userPayload(user) });
  }

  const approveUrl = `${baseUrl()}/api/auth/approve?token=${makeApprovalToken(user)}`;
  try {
    await sendApprovalRequest({ email, approveUrl });
  } catch (e) {
    console.error('[approval] failed to send approval email:', e.message);
  }
  res.status(202).json({ pending: true, message: PENDING_MSG });
});

router.post('/login', async (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  const password = req.body.password || '';
  const user = await User.findOne({ email });
  if (!user) return res.status(401).json({ error: 'אימייל או סיסמה שגויים' });
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'אימייל או סיסמה שגויים' });

  // Auto-approve list takes effect even for accounts created before the gate existed.
  if (!isApproved(user)) return res.status(403).json({ pending: true, error: PENDING_MSG });
  if (AUTO_APPROVED_EMAILS.has(email) && !user.approved) {
    user.approved = true;
    await user.save();
  }
  res.json({ token: signToken(user), user: userPayload(user) });
});

// Admin clicks the link from the approval email — flips the account to approved.
// GET so it works straight from an email client; returns a tiny HTML confirmation.
router.get('/approve', async (req, res) => {
  const page = (msg) =>
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<body style="font-family:system-ui;direction:rtl;text-align:center;padding:48px;color:#222">` +
    `<h2>KetoLog</h2><p>${msg}</p></body>`;
  const userId = readApprovalToken(req.query.token || '');
  if (!userId) return res.status(400).send(page('הקישור אינו תקין או שפג תוקפו.'));
  const user = await User.findById(userId);
  if (!user) return res.status(404).send(page('המשתמש לא נמצא.'));
  if (!user.approved) {
    user.approved = true;
    await user.save();
  }
  res.send(page(`הגישה של ${user.email} אושרה. המשתמש יכול להתחבר עכשיו.`));
});

router.get('/me', requireAuth, async (req, res) => {
  const user = await User.findById(req.userId).select('email dailyCarbTarget');
  if (!user) return res.status(404).json({ error: 'משתמש לא נמצא' });
  res.json({ user: userPayload(user) });
});

// PATCH /me -> update profile settings (currently the daily carb target)
router.patch('/me', requireAuth, async (req, res) => {
  const update = {};
  if (req.body.dailyCarbTarget != null) {
    const t = Number(req.body.dailyCarbTarget);
    if (!Number.isFinite(t) || t < 5 || t > 200) {
      return res.status(400).json({ error: 'יעד יומי לא תקין (5–200 גרם)' });
    }
    update.dailyCarbTarget = t;
  }
  const user = await User.findByIdAndUpdate(req.userId, update, { new: true }).select(
    'email dailyCarbTarget'
  );
  if (!user) return res.status(404).json({ error: 'משתמש לא נמצא' });
  res.json({ user: userPayload(user) });
});

export default router;
