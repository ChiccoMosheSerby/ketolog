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
import { rateLimit } from '../middleware/rateLimit.js';
import { asyncHandler, escapeHtml, isValidEmail } from '../lib/http.js';

const router = Router();

// Throttle credential + sign-up endpoints: slows password brute-forcing on
// /login and stops /register being used to spam the admin with approval emails.
const loginLimiter = rateLimit({ name: 'login', windowMs: 15 * 60_000, max: 10 });
const registerLimiter = rateLimit({ name: 'register', windowMs: 60 * 60_000, max: 5 });

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

router.post('/register', registerLimiter, asyncHandler(async (req, res) => {
  const email = (typeof req.body.email === 'string' ? req.body.email : '').trim().toLowerCase();
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  if (!email || !password) return res.status(400).json({ error: 'אימייל וסיסמה נדרשים' });
  if (!isValidEmail(email)) return res.status(400).json({ error: 'כתובת אימייל לא תקינה' });
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
}));

router.post('/login', loginLimiter, asyncHandler(async (req, res) => {
  const email = (typeof req.body.email === 'string' ? req.body.email : '').trim().toLowerCase();
  const password = typeof req.body.password === 'string' ? req.body.password : '';
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
}));

const approvePage = (body) =>
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
  `<body style="font-family:system-ui;direction:rtl;text-align:center;padding:48px;color:#222">` +
  `<h2>KetoLog</h2>${body}</body>`;

// GET /approve — the admin opens this from the email. It does NOT approve on its
// own (email clients and link scanners routinely pre-fetch URLs, which would
// silently approve everyone). Instead it shows a confirmation button that POSTs
// back. The token is validated here only to fail fast on bad/expired links.
router.get('/approve', asyncHandler(async (req, res) => {
  const token = typeof req.query.token === 'string' ? req.query.token : '';
  const userId = readApprovalToken(token);
  if (!userId) return res.status(400).send(approvePage('<p>הקישור אינו תקין או שפג תוקפו.</p>'));
  const user = await User.findById(userId);
  if (!user) return res.status(404).send(approvePage('<p>המשתמש לא נמצא.</p>'));
  if (user.approved) {
    return res.send(approvePage(`<p>הגישה של ${escapeHtml(user.email)} כבר אושרה.</p>`));
  }
  res.send(
    approvePage(
      `<p>לאשר את הגישה של <strong>${escapeHtml(user.email)}</strong>?</p>` +
        `<form method="POST" action="/api/auth/approve">` +
        `<input type="hidden" name="token" value="${escapeHtml(token)}">` +
        `<button type="submit" style="font-size:16px;padding:10px 28px;border:0;border-radius:8px;background:#2563eb;color:#fff;cursor:pointer">אשר/י גישה</button>` +
        `</form>`
    )
  );
}));

// POST /approve — the actual state change, reached only by clicking the button.
router.post('/approve', asyncHandler(async (req, res) => {
  const token = typeof req.body.token === 'string' ? req.body.token : '';
  const userId = readApprovalToken(token);
  if (!userId) return res.status(400).send(approvePage('<p>הקישור אינו תקין או שפג תוקפו.</p>'));
  const user = await User.findById(userId);
  if (!user) return res.status(404).send(approvePage('<p>המשתמש לא נמצא.</p>'));
  if (!user.approved) {
    user.approved = true;
    await user.save();
  }
  res.send(approvePage(`<p>הגישה של ${escapeHtml(user.email)} אושרה. המשתמש יכול להתחבר עכשיו.</p>`));
}));

router.get('/me', requireAuth, asyncHandler(async (req, res) => {
  const user = await User.findById(req.userId).select('email dailyCarbTarget');
  if (!user) return res.status(404).json({ error: 'משתמש לא נמצא' });
  res.json({ user: userPayload(user) });
}));

// PATCH /me -> update profile settings (currently the daily carb target)
router.patch('/me', requireAuth, asyncHandler(async (req, res) => {
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
}));

export default router;
