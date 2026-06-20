import jwt from 'jsonwebtoken';

// Accounts on this list are approved automatically — they never need a human to
// let them in, and they can't be locked out by the approval gate.
export const AUTO_APPROVED_EMAILS = new Set([
  'chiccomoshe@gmail.com',
  'chicco@r2net.com',
]);

// Where approval-request emails go (and who can approve).
export const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'chiccomoshe@gmail.com';

// A user may sign in only if explicitly approved OR on the auto-approve list.
export function isApproved(user) {
  if (!user) return false;
  if (user.approved === true) return true;
  return AUTO_APPROVED_EMAILS.has((user.email || '').toLowerCase());
}

// Signed, single-purpose, time-limited token embedded in the approval link.
export function makeApprovalToken(user) {
  return jwt.sign({ sub: user._id.toString(), purpose: 'approve' }, process.env.JWT_SECRET, {
    expiresIn: '7d',
  });
}

// Returns the userId to approve, or null if the token is invalid/expired/wrong purpose.
export function readApprovalToken(token) {
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    return payload.purpose === 'approve' ? payload.sub : null;
  } catch {
    return null;
  }
}
