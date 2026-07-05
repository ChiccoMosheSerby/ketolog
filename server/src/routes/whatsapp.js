import { Router } from 'express';
import User from '../models/User.js';
import {
  whatsappConfigured,
  verifyWebhook,
  normalizePhone,
  sendWhatsApp,
  formatMealReceipt,
} from '../lib/whatsapp.js';
import { logMealFromDesc } from '../lib/logMeal.js';
import { recordTwilioUsage } from '../lib/usage.js';

const router = Router();

// Per-sender throttle. The IP-based limiter can't be used here: every webhook
// arrives from Twilio's IPs, so it would throttle all users as one. Instead cap
// how many meals a single phone can log per window.
const hits = new Map();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 10;
function tooMany(phone) {
  const now = Date.now();
  const e = hits.get(phone);
  if (!e || now >= e.reset) {
    hits.set(phone, { count: 1, reset: now + WINDOW_MS });
    return false;
  }
  e.count++;
  return e.count > MAX_PER_WINDOW;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, e] of hits) if (now >= e.reset) hits.delete(k);
}, WINDOW_MS).unref?.();

// The public URL Twilio signed. Prefer an explicit env value (removes any doubt
// about proxy-rewritten host/proto); otherwise reconstruct from the request.
// trust proxy=1 makes req.protocol honor X-Forwarded-Proto behind Render.
function webhookUrl(req) {
  if (process.env.WHATSAPP_WEBHOOK_URL) return process.env.WHATSAPP_WEBHOOK_URL;
  return `${req.protocol}://${req.get('host')}${req.originalUrl}`;
}

// POST /api/whatsapp/inbound — Twilio's inbound-message webhook.
// No bearer auth: authenticity is proven by the Twilio request signature, and
// the sender is mapped to an account by their WhatsApp phone number. We always
// answer Twilio with a fast, empty 200 and do the (slow) AI estimate + reply
// out-of-band via the REST API, so an Opus estimate can't trip Twilio's ~15s
// webhook timeout.
router.post('/inbound', async (req, res) => {
  if (!whatsappConfigured()) {
    console.error('[whatsapp] inbound received but Twilio is not configured');
    return res.status(200).type('text/xml').send('<Response></Response>');
  }

  const signature = req.get('X-Twilio-Signature');
  const ok = verifyWebhook({ signature, url: webhookUrl(req), params: req.body });
  if (!ok) {
    console.warn('[whatsapp] rejected inbound with bad/absent signature');
    return res.status(403).send('invalid signature');
  }

  // Acknowledge immediately; everything below runs after the response is sent.
  res.status(200).type('text/xml').send('<Response></Response>');

  const from = req.body.From || '';
  const phone = normalizePhone(from);
  const text = String(req.body.Body || '').trim();
  if (!phone) return;

  let userId = null; // set once the sender is mapped to a linked account
  try {
    const user = await User.findOne({ whatsappPhone: phone }).lean();
    if (!user) {
      // Unlinked sender — language unknown, so answer bilingually.
      await sendWhatsApp(
        from,
        'המספר הזה עדיין לא מקושר לחשבון KetoLog. היכנס/י לאפליקציה → הגדרות ← "מספר WhatsApp" והוסף/י את המספר הזה כדי להתחיל לרשום ארוחות בהודעה.\n\n' +
          'This number isn’t linked to a KetoLog account yet. Open the app → Settings → "WhatsApp number" and add this number to start logging meals by message.'
      );
      return;
    }
    userId = user._id.toString();
    const lang = user.language === 'en' ? 'en' : 'he';
    // Count the inbound WhatsApp message against this user (Twilio cost).
    recordTwilioUsage({ userId, kind: 'whatsapp_in' });

    if (!text) {
      await sendWhatsApp(
        from,
        lang === 'en'
          ? 'Send a free-text description of the meal and I’ll calculate and save it to your journal. Example: "omelette with 3 eggs, a slice of gouda, cucumber".'
          : 'שלח/י תיאור חופשי של הארוחה ואחשב ואשמור אותה ביומן. לדוגמה: "חביתה מ-3 ביצים, פרוסת גאודה, מלפפון".',
        { userId }
      );
      return;
    }

    if (tooMany(phone)) {
      await sendWhatsApp(
        from,
        lang === 'en' ? 'Too many messages in a row — try again in a moment.' : 'יותר מדי הודעות ברצף — נסה/י שוב בעוד רגע.',
        { userId }
      );
      return;
    }

    const logged = await logMealFromDesc({ userId, desc: text, lang });
    await sendWhatsApp(from, formatMealReceipt(logged, lang), { userId });
  } catch (err) {
    // Surface Twilio's real error code/status/moreInfo — 'Authenticate' alone
    // hides whether it's a bad SID, bad token, or a wrong From number.
    console.error(
      '[whatsapp] processing failed:',
      'status=', err.status ?? '-',
      'code=', err.code ?? '-',
      'msg=', err.message,
      err.moreInfo ? 'moreInfo=' + err.moreInfo : ''
    );
    try {
      // `lang` may be out of scope if the failure happened before we resolved
      // the user, so answer bilingually here.
      await sendWhatsApp(
        from,
        'החישוב נכשל כרגע — נסה/י שוב בעוד רגע, או רשום/רשמי דרך האפליקציה.\n' +
          'The calculation failed right now — try again in a moment, or log it via the app.',
        { userId }
      );
    } catch {
      /* nothing more we can do */
    }
  }
});

export default router;
