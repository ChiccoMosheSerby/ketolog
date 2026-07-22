// Per-user AI access. AI features run on one of two keys:
//   • the app's own ANTHROPIC_API_KEY (Render env) — reserved for the owner
//     accounts listed in AI_ENV_KEY_EMAILS (comma-separated env, defaults to
//     the owner's personal account), or
//   • the user's own Anthropic API key, pasted in the settings modal and
//     stored encrypted on their user document.
// A user with neither — or with the owner's preview toggle on — simply has the
// AI features off; everything else in the app keeps working.
import crypto from 'node:crypto';
import User from '../models/User.js';

const envKeyEmails = () =>
  new Set(
    (process.env.AI_ENV_KEY_EMAILS || 'chiccomoshe@gmail.com')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );

// Does this account ride on the app's env key (the owner)?
export const usesEnvKey = (user) => envKeyEmails().has((user?.email || '').toLowerCase());

// ---- at-rest encryption for stored user keys ------------------------------
// AES-256-GCM with a key derived from JWT_SECRET — so a DB dump alone doesn't
// leak users' Anthropic keys. Not a substitute for a real KMS, but strictly
// better than plaintext and adds no new secret to manage.
const encKey = () =>
  crypto.createHash('sha256').update(String(process.env.JWT_SECRET || '')).digest();

export function encryptKey(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encKey(), iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return [
    'v1',
    iv.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    enc.toString('base64'),
  ].join('.');
}

export function decryptKey(stored) {
  try {
    const [v, ivB64, tagB64, dataB64] = String(stored || '').split('.');
    if (v !== 'v1') return '';
    const decipher = crypto.createDecipheriv('aes-256-gcm', encKey(), Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return ''; // wrong JWT_SECRET / corrupt value → treat as "no key"
  }
}

// Which key (if any) powers AI for this user.
// → { enabled, source: 'env' | 'own' | null, apiKey: string | null }
export function resolveAi(user) {
  if (!user) return { enabled: false, source: null, apiKey: null };
  if (user.aiOptOut) return { enabled: false, source: null, apiKey: null };
  if (usesEnvKey(user) && process.env.ANTHROPIC_API_KEY) {
    return { enabled: true, source: 'env', apiKey: process.env.ANTHROPIC_API_KEY };
  }
  const own = user.anthropicApiKey ? decryptKey(user.anthropicApiKey) : '';
  if (own) return { enabled: true, source: 'own', apiKey: own };
  return { enabled: false, source: null, apiKey: null };
}

// Classify an Anthropic API error into why the key stopped working.
// 'auth' = invalid/revoked key; 'no_credit' = the key's account has no budget.
// null = a transient/service error that says nothing about the key.
export function keyErrorCode(err) {
  const status = err?.status;
  const m = (err?.message || '').toLowerCase();
  if (status === 401 || m.includes('invalid x-api-key') || m.includes('authentication')) {
    return 'auth';
  }
  if (
    status === 402 ||
    m.includes('credit balance') ||
    m.includes('billing') ||
    m.includes('purchase credits')
  ) {
    return 'no_credit';
  }
  return null;
}

export const KEY_ERROR_MSG = {
  auth: 'מפתח ה-API אינו תקין או בוטל — עדכנו אותו בהגדרות.',
  no_credit:
    'נגמר הקרדיט במפתח ה-API שלכם — הוסיפו קרדיט בחשבון Anthropic (console.anthropic.com) כדי שתכונות ה-AI יחזרו לפעול.',
};

// Persist / clear the "why AI stopped working" flag on the user, so the client
// can explain a background failure (e.g. insight generation) in the UI.
// Fire-and-forget: flagging must never break the AI call that triggered it.
export function flagKeyError(userId, code) {
  if (!userId || !code) return;
  User.updateOne({ _id: userId }, { aiKeyError: code }).catch(() => {});
}
export function clearKeyError(userId) {
  if (!userId) return;
  User.updateOne({ _id: userId, aiKeyError: { $ne: '' } }, { aiKeyError: '' }).catch(() => {});
}
