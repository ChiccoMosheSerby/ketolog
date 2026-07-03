import nodemailer from 'nodemailer';
import { ADMIN_EMAIL } from './approval.js';
import { escapeHtml } from './http.js';

// Build an SMTP transport from env, or null if SMTP isn't configured.
// Supported env: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM.
let _transport;
function transport() {
  if (_transport !== undefined) return _transport;
  const host = process.env.SMTP_HOST;
  if (!host) {
    _transport = null;
    return null;
  }
  const port = Number(process.env.SMTP_PORT || 465);
  _transport = nodemailer.createTransport({
    host,
    port,
    secure: port === 465, // 465 = implicit TLS, 587 = STARTTLS
    // Force IPv4. Render instances have no working IPv6 egress, but DNS returns
    // Gmail's AAAA (IPv6) record first, so the default connect fails with
    // ENETUNREACH / a connection timeout before auth is ever attempted.
    family: 4,
    connectionTimeout: 15_000, // fail in 15s instead of hanging the request
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });
  return _transport;
}

const from = () => process.env.SMTP_FROM || process.env.SMTP_USER || ADMIN_EMAIL;

// Notify the admin that a new user is awaiting approval, with a one-click link.
// Falls back to logging the link to the console when SMTP isn't configured, so
// the approval flow still works in development.
export async function sendApprovalRequest({ email, approveUrl }) {
  const subject = `KetoLog — בקשת הרשמה חדשה: ${email}`;
  const text =
    `המשתמש ${email} מבקש להירשם ל-KetoLog.\n\n` +
    `כדי לאשר את הגישה, לחץ על הקישור הבא:\n${approveUrl}\n\n` +
    `אם לא ביקשת זאת, אפשר להתעלם מהמייל.`;
  const html =
    `<p>המשתמש <strong>${escapeHtml(email)}</strong> מבקש להירשם ל-KetoLog.</p>` +
    `<p><a href="${escapeHtml(approveUrl)}">לחץ כאן כדי לאשר את הגישה</a></p>` +
    `<p style="color:#888;font-size:13px">אם לא ביקשת זאת, אפשר להתעלם מהמייל.</p>`;

  const t = transport();
  if (!t) {
    console.log('\n[approval] SMTP not configured — approval link for', email + ':');
    console.log('[approval]', approveUrl, '\n');
    return { delivered: false };
  }
  await t.sendMail({ from: from(), to: ADMIN_EMAIL, subject, text, html });
  console.log('[approval] approval request emailed to', ADMIN_EMAIL, 'for', email);
  return { delivered: true };
}

// Send a password-reset link to the account owner. Like sendApprovalRequest,
// falls back to logging the link when SMTP isn't configured so the flow still
// works in development.
export async function sendPasswordReset({ email, resetUrl }) {
  const subject = 'KetoLog — איפוס סיסמה';
  const text =
    `התקבלה בקשה לאיפוס הסיסמה של החשבון ${email} ב-KetoLog.\n\n` +
    `כדי לבחור סיסמה חדשה, לחץ על הקישור הבא (בתוקף לשעה אחת):\n${resetUrl}\n\n` +
    `אם לא ביקשת לאפס את הסיסמה, אפשר להתעלם מהמייל — הסיסמה לא תשתנה.`;
  const html =
    `<p>התקבלה בקשה לאיפוס הסיסמה של החשבון <strong>${escapeHtml(email)}</strong> ב-KetoLog.</p>` +
    `<p><a href="${escapeHtml(resetUrl)}">לחץ כאן כדי לבחור סיסמה חדשה</a> (הקישור בתוקף לשעה אחת).</p>` +
    `<p style="color:#888;font-size:13px">אם לא ביקשת לאפס את הסיסמה, אפשר להתעלם מהמייל — הסיסמה לא תשתנה.</p>`;

  const t = transport();
  if (!t) {
    console.log('\n[reset] SMTP not configured — password-reset link for', email + ':');
    console.log('[reset]', resetUrl, '\n');
    return { delivered: false };
  }
  await t.sendMail({ from: from(), to: email, subject, text, html });
  console.log('[reset] password-reset link emailed to', email);
  return { delivered: true };
}
