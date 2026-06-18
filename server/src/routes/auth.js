import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

function signToken(user) {
  return jwt.sign({ sub: user._id.toString() }, process.env.JWT_SECRET, { expiresIn: '30d' });
}

router.post('/register', async (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  const password = req.body.password || '';
  if (!email || !password) return res.status(400).json({ error: 'אימייל וסיסמה נדרשים' });
  if (password.length < 6) return res.status(400).json({ error: 'הסיסמה חייבת להכיל לפחות 6 תווים' });

  const exists = await User.findOne({ email });
  if (exists) return res.status(409).json({ error: 'משתמש עם אימייל זה כבר קיים' });

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await User.create({ email, passwordHash });
  res.status(201).json({ token: signToken(user), user: { id: user._id, email: user.email } });
});

router.post('/login', async (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  const password = req.body.password || '';
  const user = await User.findOne({ email });
  if (!user) return res.status(401).json({ error: 'אימייל או סיסמה שגויים' });
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'אימייל או סיסמה שגויים' });
  res.json({ token: signToken(user), user: { id: user._id, email: user.email } });
});

router.get('/me', requireAuth, async (req, res) => {
  const user = await User.findById(req.userId).select('email');
  if (!user) return res.status(404).json({ error: 'משתמש לא נמצא' });
  res.json({ user: { id: user._id, email: user.email } });
});

export default router;
