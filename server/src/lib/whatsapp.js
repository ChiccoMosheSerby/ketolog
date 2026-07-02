import twilio from 'twilio';

// Round to at most 2 decimals for display (mirrors the client's helpers.fmt).
const fmt = (n) => (Math.round(n * 100) / 100).toString();

// Calorie-based macro split — fat 9 kcal/g, protein & carb 4 (mirrors the
// client's helpers.macroPct). Returns null when there are no calories.
function macroPct(g) {
  const fK = g.fat * 9;
  const pK = g.protein * 4;
  const cK = g.carb * 4;
  const tot = fK + pK + cK;
  if (tot <= 0) return null;
  return {
    fat: Math.round((fK / tot) * 100),
    protein: Math.round((pK / tot) * 100),
    carb: Math.round((cK / tot) * 100),
    kcal: Math.round(tot),
  };
}

// Twilio config. TWILIO_WHATSAPP_FROM is the bot's WhatsApp sender, e.g.
// 'whatsapp:+14155238886' (the sandbox number) or your approved business number.
const ACCOUNT_SID = () => process.env.TWILIO_ACCOUNT_SID || '';
const AUTH_TOKEN = () => process.env.TWILIO_AUTH_TOKEN || '';
const FROM = () => process.env.TWILIO_WHATSAPP_FROM || '';

export function whatsappConfigured() {
  return Boolean(ACCOUNT_SID() && AUTH_TOKEN() && FROM());
}

// Optional API-key credentials (recommended). Unlike the account Auth Token —
// which Twilio auto-resets after inactivity, silently breaking REST auth — an
// API key is stable until you revoke it. When present, REST calls authenticate
// with the key (user=KeySid, password=KeySecret) against ACCOUNT_SID's account.
const API_KEY_SID = () => process.env.TWILIO_API_KEY_SID || '';
const API_KEY_SECRET = () => process.env.TWILIO_API_KEY_SECRET || '';

let _client = null;
function client() {
  if (!_client) {
    // Masked one-time diagnostic (never logs the secret): confirms which auth
    // mode is active and that the identifiers have the expected shape.
    if (API_KEY_SID() && API_KEY_SECRET()) {
      console.log(
        `[whatsapp] Twilio client init (API key): key "${API_KEY_SID().slice(0, 4)}…" startsSK=${API_KEY_SID().startsWith('SK')}, accountSid startsAC=${ACCOUNT_SID().startsWith('AC')}, from="${FROM()}"`
      );
      _client = twilio(API_KEY_SID(), API_KEY_SECRET(), { accountSid: ACCOUNT_SID() });
    } else {
      const sid = ACCOUNT_SID();
      console.log(
        `[whatsapp] Twilio client init (auth token): SID "${sid.slice(0, 4)}…${sid.slice(-2)}" len=${sid.length} startsAC=${sid.startsWith('AC')}, token len=${AUTH_TOKEN().length}, from="${FROM()}"`
      );
      _client = twilio(sid, AUTH_TOKEN());
    }
  }
  return _client;
}

// Reduce a phone number to bare E.164 digits (no '+', spaces, or 'whatsapp:'
// prefix) so the value Twilio sends in `From` and the value stored on the user
// compare equal regardless of formatting.
export function normalizePhone(raw) {
  return String(raw || '')
    .replace(/^whatsapp:/i, '')
    .replace(/\D/g, '');
}

// Validate that a webhook request genuinely came from Twilio (not a forged POST
// to our public endpoint). Twilio signs the exact URL + sorted params with the
// account auth token; we recompute and compare. Returns false when unconfigured
// so an unset auth token can't accidentally accept unsigned traffic.
export function verifyWebhook({ signature, url, params }) {
  if (!AUTH_TOKEN() || !signature) return false;
  return twilio.validateRequest(AUTH_TOKEN(), signature, url, params || {});
}

// Send a WhatsApp text back to `toPhone` (bare digits or full 'whatsapp:+…').
export async function sendWhatsApp(toPhone, body) {
  const to = String(toPhone).startsWith('whatsapp:')
    ? String(toPhone)
    : `whatsapp:+${normalizePhone(toPhone)}`;
  return client().messages.create({ from: FROM(), to, body });
}

// Build the Hebrew receipt the user gets back after a meal is logged — mirrors
// the app's calc-note: total macros, calorie split, the per-item breakdown, and
// where it landed (which day + the running day total).
export function formatMealReceipt({ meal, day, date }) {
  const n = Number(meal.carbs) || 0;
  const fat = meal.fat == null ? null : Number(meal.fat);
  const prot = meal.protein == null ? null : Number(meal.protein);

  const lines = [];
  lines.push('✅ נרשם ליומן');
  lines.push(`🍽️ ${meal.desc}`);

  let head = `📊 ${fmt(n)} ג' פחמימות נטו`;
  if (fat != null) head += ` · ${fmt(fat)} ג' שומן`;
  if (prot != null) head += ` · ${fmt(prot)} ג' חלבון`;
  lines.push(head);

  if (fat != null && prot != null) {
    const mp = macroPct({ carb: n, fat, protein: prot });
    if (mp) lines.push(`   חלוקה קלורית: שומן ${mp.fat}% · חלבון ${mp.protein}% · פחמ' ${mp.carb}% (~${mp.kcal} קק"ל)`);
  }

  const items = Array.isArray(meal.items) ? meal.items : [];
  if (items.length) {
    lines.push('');
    for (const it of items) {
      const qty = Number(it.qty) || 1;
      const carbs = (Number(it.carbs) || 0) * qty;
      const q = qty > 1 ? `${fmt(qty)}× ` : '';
      lines.push(`• ${q}${it.name} — ${fmt(carbs)} ג' פחמ'`);
    }
  }

  const dayTotal = (day?.meals || []).reduce((s, m) => s + (Number(m.carbs) || 0), 0);
  lines.push('');
  lines.push(`🗓️ ${date} · ${meal.time} — סה"כ היום: ${fmt(dayTotal)} ג' פחמימות`);

  return lines.join('\n');
}
