import nodemailer from 'nodemailer';
import { ADMIN_EMAIL } from './approval.js';

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
    `<p>המשתמש <strong>${email}</strong> מבקש להירשם ל-KetoLog.</p>` +
    `<p><a href="${approveUrl}">לחץ כאן כדי לאשר את הגישה</a></p>` +
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
