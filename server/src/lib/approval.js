import crypto from "node:crypto";
import jwt from "jsonwebtoken";

// Accounts on this list are approved automatically — they never need a human to
// let them in, and they can't be locked out by the approval gate.
export const AUTO_APPROVED_EMAILS = new Set([
  "chiccomoshe@gmail.com",
  "chicco@r2net.com",
  "tst3@gmail.com",
]);

// Where approval-request emails go (and who can approve).
export const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "chiccomoshe@gmail.com";

// A user may sign in only if explicitly approved OR on the auto-approve list.
export function isApproved(user) {
  if (!user) return false;
  if (user.approved === true) return true;
  return AUTO_APPROVED_EMAILS.has((user.email || "").toLowerCase());
}

// Admins get the in-app usage/cost dashboard and the /api/admin routes. The
// owner's accounts (the auto-approve list) are the admins for now.
export function isAdmin(user) {
  return (
    Boolean(user) && AUTO_APPROVED_EMAILS.has((user.email || "").toLowerCase())
  );
}

// Signed, single-purpose, time-limited token embedded in the approval link.
export function makeApprovalToken(user) {
  return jwt.sign(
    { sub: user._id.toString(), purpose: "approve" },
    process.env.JWT_SECRET,
    {
      expiresIn: "7d",
    },
  );
}

// Returns the userId to approve, or null if the token is invalid/expired/wrong purpose.
export function readApprovalToken(token) {
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    return payload.purpose === "approve" ? payload.sub : null;
  } catch {
    return null;
  }
}

// Short, non-reversible fingerprint of the current password hash. Embedding it
// in a reset token makes the token single-use: once the password changes the
// hash (and therefore this fingerprint) changes, so any previously issued reset
// link stops validating.
export function passwordFingerprint(user) {
  return crypto
    .createHash("sha256")
    .update(String(user?.passwordHash || ""))
    .digest("hex")
    .slice(0, 16);
}

// Signed, single-purpose, short-lived token embedded in the password-reset link.
// Bound to the current password so it can be used at most once (see fingerprint).
export function makeResetToken(user) {
  return jwt.sign(
    {
      sub: user._id.toString(),
      purpose: "reset",
      pv: passwordFingerprint(user),
    },
    process.env.JWT_SECRET,
    { expiresIn: "1h" },
  );
}

// Returns { userId, pv } from a valid reset token, or null if it's
// invalid/expired/wrong purpose. The caller must still confirm `pv` matches the
// user's current fingerprint to reject already-used links.
export function readResetToken(token) {
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (payload.purpose !== "reset") return null;
    return { userId: payload.sub, pv: payload.pv };
  } catch {
    return null;
  }
}
