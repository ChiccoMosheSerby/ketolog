import Anthropic from '@anthropic-ai/sdk';

let client = null;
export function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not set');
  }
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}
// Estimators (meal/image/barcode → JSON) run on the strongest model with
// adaptive thinking, so the logged numbers are at expert level.
export const MODEL = () => process.env.CLAUDE_MODEL || 'claude-opus-4-8';
// The conversational keto assistant runs on the strongest model with thinking,
// so it reasons at the level of the general Claude chat.
export const CHAT_MODEL = () => process.env.CHAT_MODEL || 'claude-opus-4-8';

// ---- shared keto nutrition rules (the "brain"; no output format) ----------
// ketoRules is the one nutrition prompt every estimator shares. Each estimator
// appends its own output-format instruction (below), so there is no need to
// strip a baked-in format back off — the meal/image/barcode shapes stay distinct
// and explicit. Ported from keto-log.html; products injected as context.
function ketoRules(products = []) {
  let base =
    'אתה מומחה/ית התזונה הקטוגנית הטוב/ה בעולם — דיאטן/ית קליני/ת עם דיוק של מעבדה. ' +
    'העריך/י בדיוק הגבוה ביותר האפשרי עבור הכמויות המתוארות: (1) פחמימות נטו בגרמים, (2) שומן בגרמים, (3) חלבון בגרמים. ' +
    'בסס/י על ידע תזונתי מעמיק (כמו USDA ותוויות יצרן ישראליות), חשב/י לפי המרכיבים והכמויות בפועל, ושקלל/י את שיטת ההכנה. ' +
    'אם הכמות לא ברורה — הנח/י מנה בינונית סבירה, ועדיף לדייק בהיגיון מאשר להמציא דיוק מזויף. ' +
    'פחמימות נטו = סך הפחמימות, פחות סיבים תזונתיים (אינם הופכים לגלוקוז), פחות אריתריטול ואלולוז (אינם מעלים סוכר בדם). ' +
    'ממתיקים סטיביה/טרוביה = 0 פחמימות. מלטיטול או כוהל סוכר אחר שמעלה סוכר חלקית — ספור כמחצית מערכו. ' +
    'בשר/דג/ביצים = 0 פחמימות; שמן וחמאה = 0 פחמימות וגם 0 חלבון; גבינות קשות מיושנות ≈ 0 פחמימות; ' +
    'אם כמות לא צוינה, הנח מנה בינונית סבירה.';

  if (products.length) {
    base +=
      ' חשוב: למשתמש יש מוצרים קבועים. אם הם מופיעים — גם בקיצור או בשם הכינוי — השתמש בדיוק בערכים האלה לכל יחידה, ואל תניח מוצר גנרי: ' +
      products
        .map(
          (p) =>
            `"${p.key}" = ${p.label}, ל${p.unit}: ${p.carbs} פחמ' נטו / ${p.fat} שומן / ${p.protein} חלבון`
        )
        .join('; ') +
      '.';
  }

  return base;
}

// ---- per-task output-format instructions (appended after ketoRules) --------
const MEAL_FORMAT =
  ' השב אך ורק ב-JSON תקין בפורמט: ' +
  '{"net_carbs": <מספר>, "fat": <מספר>, "protein": <מספר>, "breakdown": "<פירוט קצר בעברית, כל פריט בשורה>"}' +
  ' ללא שום טקסט נוסף וללא סימוני markdown.';

function imageFormat(unit) {
  const unitRule = unit ? ` היחידה המבוקשת היא "${unit}".` : '';
  return (
    ' זהה את המוצר בתמונה וקרא את טבלת הערכים התזונתיים אם קיימת.' +
    ' החזר את הערכים עבור האריזה/המוצר השלם שבתמונה (לא ל-100 גרם), ובנפרד ציין מהי כמות היחידות מהסוג המבוקש שניתן להעריך שיש באריזה' +
    ' (אם ניתן לראות חלוקה לשורות/ריבועים בתמונה — ספור אותם; אחרת הערך לפי גודל וסוג המוצר).' +
    unitRule +
    ' השב אך ורק ב-JSON תקין: {"name": "<כינוי קצר>", "label": "<תיאור מלא>", "unit": "<היחידה>", ' +
    '"pack_net_carbs": <לכל האריזה>, "pack_fat": <לכל האריזה>, "pack_protein": <לכל האריזה>, ' +
    '"units_per_pack": <מספר היחידות המשוער באריזה>, "breakdown": "<פירוט קצר כולל גודל האריזה>"} ' +
    'ללא טקסט נוסף וללא markdown.'
  );
}

function barcodeFormat(unit, fiberNote) {
  const unitRule = unit ? ` היחידה המבוקשת היא "${unit}".` : '';
  return (
    ' להלן נתוני מוצר ארוז שנסרק לפי ברקוד, מתוך מסד הנתונים Open Food Facts.' +
    ' חשב פחמימות נטו לפי הכללים הקטוגניים שלמעלה (החסר סיבים; אריתריטול/אלולוז = 0; מלטיטול = חצי).' +
    fiberNote +
    ' החזר ערכים ל-100 גרם אלא אם המשתמש ביקש יחידה אחרת.' +
    unitRule +
    ' השב אך ורק ב-JSON תקין: {"name": "<כינוי קצר>", "label": "<תיאור מלא כולל מותג>", ' +
    '"unit": "<היחידה, ברירת מחדל \\"100 גרם\\">", "net_carbs": <מספר>, "fat": <מספר>, ' +
    '"protein": <מספר>, "breakdown": "<פירוט קצר בעברית>"} ללא טקסט נוסף וללא markdown.'
  );
}

function parseJsonReply(message) {
  // Only the visible text blocks carry the JSON; thinking blocks are ignored.
  const text = (message.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .replace(/```json/g, '')
    .replace(/```/g, '')
    .trim();
  try {
    return JSON.parse(text);
  } catch {
    // A strong model may wrap the JSON in a sentence — grab the outermost object.
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start !== -1 && end > start) return JSON.parse(text.slice(start, end + 1));
    throw new Error('Model did not return parseable JSON');
  }
}

// ---- output validation -----------------------------------------------------
// Coerce a model-emitted value to a non-negative number, or `undefined` when it
// is missing/invalid/negative. Returning undefined (rather than 0) is deliberate:
// the fields drop out of the JSON response, so the clients' existing
// Number()/isNaN()/!= null guards keep rendering "?" for a missing value instead
// of silently logging a wrong 0.
const cleanNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};
const cleanStr = (v) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

// Each estimator runs its parsed reply through one of these so callers always
// get a known shape with trustworthy types.
const normalizeMeal = (r) => ({
  net_carbs: cleanNum(r.net_carbs),
  fat: cleanNum(r.fat),
  protein: cleanNum(r.protein),
  breakdown: cleanStr(r.breakdown),
});

const normalizeImage = (r) => ({
  name: cleanStr(r.name),
  label: cleanStr(r.label),
  unit: cleanStr(r.unit),
  pack_net_carbs: cleanNum(r.pack_net_carbs),
  pack_fat: cleanNum(r.pack_fat),
  pack_protein: cleanNum(r.pack_protein),
  units_per_pack: cleanNum(r.units_per_pack),
  breakdown: cleanStr(r.breakdown),
});

const normalizeBarcode = (r) => ({
  name: cleanStr(r.name),
  label: cleanStr(r.label),
  unit: cleanStr(r.unit),
  net_carbs: cleanNum(r.net_carbs),
  fat: cleanNum(r.fat),
  protein: cleanNum(r.protein),
  breakdown: cleanStr(r.breakdown),
});

export async function estimateMeal(desc, products = []) {
  const message = await getClient().messages.create({
    model: MODEL(),
    max_tokens: 5000,
    thinking: { type: 'adaptive' },
    system: ketoRules(products) + MEAL_FORMAT,
    messages: [{ role: 'user', content: desc }],
  });
  return normalizeMeal(parseJsonReply(message));
}

export async function estimateImage(b64, mediaType, unit, products = []) {
  const message = await getClient().messages.create({
    model: MODEL(),
    max_tokens: 5000,
    thinking: { type: 'adaptive' },
    system: ketoRules(products) + imageFormat(unit),
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: b64 } },
          {
            type: 'text',
            text: 'זהה את המוצר. אם מופיעה תווית או טבלת ערכים תזונתיים — קרא אותה ובסס עליה את החישוב לאריזה השלמה.',
          },
        ],
      },
    ],
  });
  return normalizeImage(parseJsonReply(message));
}

// Turn raw Open Food Facts numbers into keto net carbs. OFF gives total carbs +
// (sometimes) fiber/polyols per 100g; Claude applies the app's keto rules and
// normalizes the messy entry into our product shape. When fiber is missing it
// estimates it from the known product, so the scan still produces a usable value.
export async function interpretBarcode(off, unit, products = []) {
  const fmtNum = (v) => (v == null ? 'לא ידוע' : String(v));
  const facts = [
    off.name && `שם: ${off.name}`,
    off.brands && `מותג: ${off.brands}`,
    off.quantity && `גודל אריזה: ${off.quantity}`,
    off.servingSize && `גודל מנה: ${off.servingSize}`,
    `ערכים ל-100 גרם — פחמימות: ${fmtNum(off.per100.carbs)}, סיבים: ${fmtNum(
      off.per100.fiber
    )}, סוכרים: ${fmtNum(off.per100.sugars)}, כוהלי סוכר (פוליאולים): ${fmtNum(
      off.per100.polyols
    )}, שומן: ${fmtNum(off.per100.fat)}, חלבון: ${fmtNum(off.per100.protein)}`,
  ]
    .filter(Boolean)
    .join('\n');

  const fiberNote =
    off.per100.fiber == null
      ? ' שים לב: ערך הסיבים חסר במסד הנתונים — הערך אותו לפי סוג המוצר הידוע, וציין בפירוט שהסיבים הוערכו.'
      : '';
  const message = await getClient().messages.create({
    model: MODEL(),
    max_tokens: 5000,
    thinking: { type: 'adaptive' },
    system: ketoRules(products) + barcodeFormat(unit, fiberNote),
    messages: [{ role: 'user', content: facts }],
  });
  return normalizeBarcode(parseJsonReply(message));
}

export function aiConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}
