import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { isApproved } from '../lib/approval.js';
import { msg } from '../lib/i18n.js';

// Verifies the Bearer token, loads the user, and enforces the approval gate.
// Attaches req.userId + req.user. Sends 401 if the token is bad OR the account
// is no longer approved — so revoking approval effectively logs the user out.
// Messages here localize off the `X-App-Lang` header (req.user isn't set yet).
export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: msg(req, 'לא מחובר', 'Not signed in') });
  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return res
      .status(401)
      .json({ error: msg(req, 'ההתחברות פגה — התחבר שוב', 'Session expired — please sign in again') });
  }
  let user;
  try {
    user = await User.findById(payload.sub);
  } catch (e) {
    return res.status(500).json({ error: msg(req, 'שגיאת שרת', 'Server error') });
  }
  if (!user)
    return res
      .status(401)
      .json({ error: msg(req, 'ההתחברות פגה — התחבר שוב', 'Session expired — please sign in again') });
  if (!isApproved(user)) {
    return res
      .status(401)
      .json({ error: msg(req, 'החשבון ממתין לאישור מנהל', 'Your account is awaiting admin approval') });
  }
  req.userId = user._id.toString();
  req.user = user;
  next();
}
