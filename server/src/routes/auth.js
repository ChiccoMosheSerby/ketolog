import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { requireAuth } from '../middleware/auth.js';
import {
  AUTO_APPROVED_EMAILS,
  isApproved,
  isAdmin,
  makeApprovalToken,
  readApprovalToken,
  makeResetToken,
  readResetToken,
  passwordFingerprint,
} from '../lib/approval.js';
import { sendApprovalRequest, sendPasswordReset } from '../lib/mailer.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { asyncHandler, escapeHtml, isValidEmail } from '../lib/http.js';
import { msg } from '../lib/i18n.js';

const router = Router();

// Throttle credential + sign-up endpoints: slows password brute-forcing on
// /login and stops /register being used to spam the admin with approval emails.
const loginLimiter = rateLimit({ name: 'login', windowMs: 15 * 60_000, max: 10 });
const registerLimiter = rateLimit({ name: 'register', windowMs: 60 * 60_000, max: 5 });
// Throttle the reset endpoints: /forgot-password by how often we'll email a
// given client, /reset-password by how fast tokens can be submitted.
const forgotLimiter = rateLimit({ name: 'forgot', windowMs: 60 * 60_000, max: 5 });
const resetLimiter = rateLimit({ name: 'reset', windowMs: 15 * 60_000, max: 10 });

function signToken(user) {
  return jwt.sign({ sub: user._id.toString() }, process.env.JWT_SECRET, { expiresIn: '30d' });
}

const userPayload = (u) => ({
  id: u._id,
  email: u.email,
  language: u.language || 'he',
  gender: u.gender || '',
  dailyCarbTarget: u.dailyCarbTarget,
  ketoStartDate: u.ketoStartDate || '',
  ketoGoalMonths: u.ketoGoalMonths || 0,
  whatsappPhone: u.whatsappPhone || '',
  isAdmin: isAdmin(u),
});

const PROFILE_FIELDS = 'email language gender dailyCarbTarget ketoStartDate ketoGoalMonths whatsappPhone';
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

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

const pendingMsg = (req) =>
  msg(
    req,
    'החשבון שלך נוצר וממתין לאישור מנהל. תקבל גישה לאחר האישור.',
    'Your account was created and is awaiting admin approval. You’ll get access once approved.'
  );
const MIN_PASSWORD = 6;

router.post('/register', registerLimiter, asyncHandler(async (req, res) => {
  const email = (typeof req.body.email === 'string' ? req.body.email : '').trim().toLowerCase();
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  // Language is chosen at sign-up. Default to Hebrew when absent/invalid.
  const language = req.body.language === 'en' ? 'en' : 'he';
  if (!email || !password)
    return res.status(400).json({ error: msg(req, 'אימייל וסיסמה נדרשים', 'Email and password are required') });
  if (!isValidEmail(email))
    return res.status(400).json({ error: msg(req, 'כתובת אימייל לא תקינה', 'Invalid email address') });
  if (password.length < MIN_PASSWORD) {
    return res.status(400).json({
      error: msg(
        req,
        `הסיסמה חייבת להכיל לפחות ${MIN_PASSWORD} תווים`,
        `Password must be at least ${MIN_PASSWORD} characters`
      ),
    });
  }

  const exists = await User.findOne({ email });
  if (exists)
    return res.status(409).json({ error: msg(req, 'משתמש עם אימייל זה כבר קיים', 'An account with this email already exists') });

  const passwordHash = await bcrypt.hash(password, 10);
  const autoApproved = AUTO_APPROVED_EMAILS.has(email);
  const user = await User.create({ email, passwordHash, language, approved: autoApproved });

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
  res.status(202).json({ pending: true, message: pendingMsg(req) });
}));

router.post('/login', loginLimiter, asyncHandler(async (req, res) => {
  const email = (typeof req.body.email === 'string' ? req.body.email : '').trim().toLowerCase();
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const user = await User.findOne({ email });
  if (!user) return res.status(401).json({ error: msg(req, 'אימייל או סיסמה שגויים', 'Wrong email or password') });
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: msg(req, 'אימייל או סיסמה שגויים', 'Wrong email or password') });

  // Auto-approve list takes effect even for accounts created before the gate existed.
  if (!isApproved(user)) return res.status(403).json({ pending: true, error: pendingMsg(req) });
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

// POST /forgot-password — the user asks for a reset link. We always return the
// same response whether or not an account exists, so the endpoint can't be used
// to probe which email addresses are registered.
router.post('/forgot-password', forgotLimiter, asyncHandler(async (req, res) => {
  const email = (typeof req.body.email === 'string' ? req.body.email : '').trim().toLowerCase();
  const generic = {
    message: msg(
      req,
      'אם קיים חשבון עם האימייל הזה, ישלח אליו קישור לאיפוס הסיסמה.',
      'If an account exists for this email, a password-reset link has been sent to it.'
    ),
  };
  if (!isValidEmail(email)) return res.json(generic);

  const user = await User.findOne({ email });
  if (user) {
    const resetUrl = `${baseUrl()}/api/auth/reset-password?token=${makeResetToken(user)}`;
    try {
      await sendPasswordReset({ email, resetUrl, lang: user.language || 'he' });
    } catch (e) {
      console.error('[reset] failed to send reset email:', e.message);
    }
  }
  res.json(generic);
}));

// Server-rendered "choose a new password" form, reached from the emailed link.
// Mirrors the approval page's shell. `error` re-renders the form with a message.
const resetForm = (token, error = '') =>
  approvePage(
    (error ? `<p style="color:#dc2626">${escapeHtml(error)}</p>` : '<p>בחר/י סיסמה חדשה ל-KetoLog.</p>') +
      `<form method="POST" action="/api/auth/reset-password" style="display:inline-block;direction:rtl;text-align:right">` +
      `<input type="hidden" name="token" value="${escapeHtml(token)}">` +
      `<div style="margin:12px 0"><label>סיסמה חדשה<br>` +
      `<input type="password" name="password" minlength="${MIN_PASSWORD}" required autocomplete="new-password" style="font-size:16px;padding:8px;width:260px;box-sizing:border-box"></label></div>` +
      `<div style="margin:12px 0"><label>אימות סיסמה<br>` +
      `<input type="password" name="confirm" minlength="${MIN_PASSWORD}" required autocomplete="new-password" style="font-size:16px;padding:8px;width:260px;box-sizing:border-box"></label></div>` +
      `<button type="submit" style="font-size:16px;padding:10px 28px;border:0;border-radius:8px;background:#2563eb;color:#fff;cursor:pointer">אפס/י סיסמה</button>` +
      `</form>`
  );

const RESET_BAD_LINK = '<p>קישור האיפוס אינו תקין, שפג תוקפו, או שכבר נעשה בו שימוש.</p>';

// Load the user a reset token points at, but only if the token's fingerprint
// still matches the current password — i.e. the link hasn't already been used.
async function userForResetToken(token) {
  const parsed = readResetToken(token);
  if (!parsed) return null;
  const user = await User.findById(parsed.userId);
  if (!user || parsed.pv !== passwordFingerprint(user)) return null;
  return user;
}

// GET /reset-password — show the form (validating the link first).
router.get('/reset-password', resetLimiter, asyncHandler(async (req, res) => {
  const token = typeof req.query.token === 'string' ? req.query.token : '';
  const user = await userForResetToken(token);
  if (!user) return res.status(400).send(approvePage(RESET_BAD_LINK));
  res.send(resetForm(token));
}));

// POST /reset-password — set the new password. Changing the hash invalidates the
// token (its fingerprint no longer matches), so each link works at most once.
router.post('/reset-password', resetLimiter, asyncHandler(async (req, res) => {
  const token = typeof req.body.token === 'string' ? req.body.token : '';
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const confirm = typeof req.body.confirm === 'string' ? req.body.confirm : '';

  const user = await userForResetToken(token);
  if (!user) return res.status(400).send(approvePage(RESET_BAD_LINK));
  if (password.length < MIN_PASSWORD) {
    return res.status(400).send(resetForm(token, `הסיסמה חייבת להכיל לפחות ${MIN_PASSWORD} תווים.`));
  }
  if (password !== confirm) {
    return res.status(400).send(resetForm(token, 'הסיסמאות אינן תואמות.'));
  }

  user.passwordHash = await bcrypt.hash(password, 10);
  await user.save();
  res.send(
    approvePage(
      '<p>הסיסמה עודכנה בהצלחה. אפשר להתחבר עכשיו עם הסיסמה החדשה.</p>' +
        '<p><a href="/">חזרה ל-KetoLog</a></p>'
    )
  );
}));

router.get('/me', requireAuth, asyncHandler(async (req, res) => {
  const user = await User.findById(req.userId).select(PROFILE_FIELDS);
  if (!user) return res.status(404).json({ error: msg(req, 'משתמש לא נמצא', 'User not found') });
  res.json({ user: userPayload(user) });
}));

// PATCH /me -> update profile settings (daily carb target + keto-period goal)
router.patch('/me', requireAuth, asyncHandler(async (req, res) => {
  const update = {};
  if (req.body.gender != null) {
    const g = String(req.body.gender);
    if (!['male', 'female', ''].includes(g)) {
      return res.status(400).json({ error: msg(req, 'מגדר לא תקין', 'Invalid gender') });
    }
    update.gender = g;
  }
  if (req.body.dailyCarbTarget != null) {
    const t = Number(req.body.dailyCarbTarget);
    if (!Number.isFinite(t) || t < 5 || t > 200) {
      return res
        .status(400)
        .json({ error: msg(req, 'יעד יומי לא תקין (5–200 גרם)', 'Invalid daily target (5–200 g)') });
    }
    update.dailyCarbTarget = t;
  }
  if (req.body.ketoGoalMonths != null) {
    const m = Number(req.body.ketoGoalMonths);
    if (!Number.isInteger(m) || m < 0 || m > 60) {
      return res.status(400).json({
        error: msg(req, 'יעד תקופת קיטו לא תקין (0–60 חודשים)', 'Invalid keto-period goal (0–60 months)'),
      });
    }
    update.ketoGoalMonths = m;
  }
  if (req.body.ketoStartDate != null) {
    const d = String(req.body.ketoStartDate);
    if (d !== '' && !ISO_DATE.test(d)) {
      return res.status(400).json({ error: msg(req, 'תאריך התחלה לא תקין', 'Invalid start date') });
    }
    update.ketoStartDate = d;
  }
  if (req.body.whatsappPhone != null) {
    // Normalize to bare E.164 digits so it compares equal to what Twilio sends.
    // Empty string unlinks. Otherwise require a plausible international number.
    const phone = String(req.body.whatsappPhone).replace(/\D/g, '');
    if (phone && (phone.length < 8 || phone.length > 15)) {
      return res.status(400).json({
        error: msg(
          req,
          'מספר WhatsApp לא תקין (כולל קידומת מדינה, ללא +)',
          'Invalid WhatsApp number (include country code, no +)'
        ),
      });
    }
    if (phone) {
      const other = await User.findOne({ whatsappPhone: phone, _id: { $ne: req.userId } })
        .select('_id')
        .lean();
      if (other)
        return res.status(409).json({
          error: msg(req, 'מספר WhatsApp זה כבר מקושר לחשבון אחר', 'This WhatsApp number is already linked to another account'),
        });
    }
    update.whatsappPhone = phone;
  }
  const user = await User.findByIdAndUpdate(req.userId, update, { new: true }).select(PROFILE_FIELDS);
  if (!user) return res.status(404).json({ error: msg(req, 'משתמש לא נמצא', 'User not found') });
  res.json({ user: userPayload(user) });
}));

export default router;
