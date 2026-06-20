import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { isApproved } from '../lib/approval.js';

// Verifies the Bearer token, loads the user, and enforces the approval gate.
// Attaches req.userId + req.user. Sends 401 if the token is bad OR the account
// is no longer approved — so revoking approval effectively logs the user out.
export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'לא מחובר' });
  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'ההתחברות פגה — התחבר שוב' });
  }
  let user;
  try {
    user = await User.findById(payload.sub);
  } catch (e) {
    return res.status(500).json({ error: 'שגיאת שרת' });
  }
  if (!user) return res.status(401).json({ error: 'ההתחברות פגה — התחבר שוב' });
  if (!isApproved(user)) {
    return res.status(401).json({ error: 'החשבון ממתין לאישור מנהל' });
  }
  req.userId = user._id.toString();
  req.user = user;
  next();
}
