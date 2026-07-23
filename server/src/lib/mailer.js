import nodemailer from 'nodemailer';
import { ADMIN_EMAIL } from './approval.js';
import { escapeHtml } from './http.js';

// Email delivery. Two backends, chosen at send time:
//   1. Brevo HTTP API (BREVO_API_KEY set) — sends over HTTPS, so it works on
//      hosts that block outbound SMTP ports (e.g. Render's free tier blocks
//      25/465/587). This is the production path.
//   2. SMTP (SMTP_HOST set) — plain nodemailer, used for local development
//      where SMTP isn't blocked.
// If neither is configured, callers log the link to the console instead so the
// flows still work with no email backend at all.

// Sender identity. Brevo requires the "from" address to be a verified sender
// (single-sender verification is enough — no custom domain needed).
const senderEmail = () =>
  process.env.BREVO_SENDER_EMAIL || process.env.SMTP_FROM || process.env.SMTP_USER || ADMIN_EMAIL;
const senderName = () => process.env.BREVO_SENDER_NAME || 'KetoLog';

// --- Brevo HTTP API -------------------------------------------------------
async function sendViaBrevo({ to, subject, text, html }) {
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': process.env.BREVO_API_KEY,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      sender: { email: senderEmail(), name: senderName() },
      to: [{ email: to }],
      subject,
      textContent: text,
      htmlContent: html,
    }),
  });
  if (!res.ok) {
    // Surface Brevo's error body so a bad key / unverified sender is diagnosable.
    const body = await res.text().catch(() => '');
    throw new Error(`Brevo API ${res.status}: ${body.slice(0, 300)}`);
  }
}

// --- SMTP (local/dev fallback) --------------------------------------------
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
    // Force IPv4 — some hosts resolve the SMTP host's IPv6 (AAAA) record first
    // but have no IPv6 egress, which fails with ENETUNREACH before auth.
    family: 4,
    connectionTimeout: 15_000, // fail in 15s instead of hanging the request
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });
  return _transport;
}

// Deliver one message via whichever backend is configured. Returns
// { delivered: true, via } on success, or { delivered: false } when no backend
// is configured (so the caller can log the link instead). Throws if a
// configured backend fails, so the route can log the real cause.
async function deliver({ to, subject, text, html }) {
  if (process.env.BREVO_API_KEY) {
    await sendViaBrevo({ to, subject, text, html });
    return { delivered: true, via: 'brevo' };
  }
  const t = transport();
  if (t) {
    await t.sendMail({ from: senderEmail(), to, subject, text, html });
    return { delivered: true, via: 'smtp' };
  }
  return { delivered: false };
}

// Notify the admin that a new user is awaiting approval, with a one-click link.
// Falls back to logging the link to the console when no email backend is
// configured, so the approval flow still works in development.
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

  const r = await deliver({ to: ADMIN_EMAIL, subject, text, html });
  if (!r.delivered) {
    console.log('\n[approval] no email backend configured — approval link for', email + ':');
    console.log('[approval]', approveUrl, '\n');
    return r;
  }
  console.log(`[approval] approval request emailed to ${ADMIN_EMAIL} for ${email} (via ${r.via})`);
  return r;
}

// Notify the admin that a user filed a bug report. The report itself (including
// screenshots) lives in the app's admin panel — the email is just the ping.
// Falls back to a console log when no email backend is configured.
export async function sendBugReportNotice({ email, name, description, imagesCount }) {
  const who = name ? `${name} (${email})` : email;
  const subject = `KetoLog — דיווח תקלה חדש מ-${who}`;
  const attach = imagesCount ? `\n\nמצורפות ${imagesCount} תמונות — זמינות בפאנל הדיווחים באפליקציה.` : '';
  const text =
    `התקבל דיווח תקלה חדש מ-${who}:\n\n${description}${attach}\n\n` +
    `לצפייה ולמענה: פתחו את KetoLog → תפריט המשתמש → דיווחי תקלות.`;
  const html =
    `<p>התקבל דיווח תקלה חדש מ-<strong>${escapeHtml(who)}</strong>:</p>` +
    `<blockquote style="border-inline-start:3px solid #ccc;margin:8px 0;padding:4px 12px;white-space:pre-wrap">${escapeHtml(description)}</blockquote>` +
    (imagesCount ? `<p>מצורפות ${imagesCount} תמונות — זמינות בפאנל הדיווחים באפליקציה.</p>` : '') +
    `<p style="color:#888;font-size:13px">לצפייה ולמענה: KetoLog → תפריט המשתמש → דיווחי תקלות.</p>`;

  const r = await deliver({ to: ADMIN_EMAIL, subject, text, html });
  if (!r.delivered) {
    console.log(`\n[bugs] no email backend configured — new bug report from ${who}:`);
    console.log('[bugs]', description.slice(0, 200), '\n');
    return r;
  }
  console.log(`[bugs] bug-report notice emailed to ${ADMIN_EMAIL} (via ${r.via})`);
  return r;
}

// Send a password-reset link to the account owner. Like sendApprovalRequest,
// falls back to logging the link when no email backend is configured so the
// flow still works in development.
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

  const r = await deliver({ to: email, subject, text, html });
  if (!r.delivered) {
    console.log('\n[reset] no email backend configured — password-reset link for', email + ':');
    console.log('[reset]', resetUrl, '\n');
    return r;
  }
  console.log(`[reset] password-reset link emailed to ${email} (via ${r.via})`);
  return r;
}
