import Anthropic from '@anthropic-ai/sdk';
import { recordAnthropicUsage } from './usage.js';
import { KETO_CORE_RULES } from '../../../shared/ketoCore.js';

// One client per API key: the app's env key (owner accounts) and each user's
// own key (BYO-key accounts, see lib/aiAccess.js) all get their own cached SDK
// instance. Callers pass the resolved key; omitting it falls back to the env key.
const clients = new Map();
export function getClient(apiKey) {
  const key = apiKey || process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new Error('ANTHROPIC_API_KEY is not set');
  }
  if (!clients.has(key)) {
    // The SDK retries transient failures (429 rate-limit, 408/409, and 5xx
    // including 529 "overloaded") with exponential backoff + jitter, honoring
    // any retry-after header. Bumping past the default of 2 makes brief API
    // overloads self-heal instead of surfacing as a hard error mid-chat.
    clients.set(key, new Anthropic({ apiKey: key, maxRetries: 4 }));
  }
  return clients.get(key);
}
// Estimators (meal/image/barcode → JSON) run on the strongest model. Note this
// model rejects the `temperature` param entirely (it's deprecated there), so we
// can't force greedy decoding — consistency comes from the keto reference values
// and portion-scaling rules in the prompt, plus deriving the meal total from the
// per-item breakdown (see normalizeMeal) so the numbers always reconcile.
export const MODEL = () => process.env.CLAUDE_MODEL || 'claude-opus-4-8';
// The conversational keto assistant runs on the strongest model with thinking,
// so it reasons at the level of the general Claude chat.
export const CHAT_MODEL = () => process.env.CHAT_MODEL || 'claude-opus-4-8';

// ---- shared keto nutrition rules (the "brain"; no output format) ----------
// ketoRules is the one nutrition prompt every estimator shares. Each estimator
// appends its own output-format instruction (below), so there is no need to
// strip a baked-in format back off — the meal/image/barcode shapes stay distinct
// and explicit. The nutrition core lives in shared/ketoCore.js so the client's
// claude.ai redirect prompt (ClaudeCalcModal) computes with the exact same rules;
// only the persona/task framing and the products context are added here.
export function ketoRules(products = []) {
  let base =
    'אתה מומחה/ית התזונה הקטוגנית הטוב/ה בעולם — דיאטן/ית קליני/ת עם דיוק של מעבדה. ' +
    'העריך/י בדיוק הגבוה ביותר האפשרי עבור הכמויות המתוארות: (1) פחמימות נטו בגרמים, (2) שומן בגרמים, (3) חלבון בגרמים. ' +
    KETO_CORE_RULES;

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
  ' פרק/י את הארוחה לפריטים נפרדים בדיוק כפי שנרשמו — אל תאחד/י פריטים זהים. ' +
  'אם הפריט נכתב כמה פעמים (למשל "נקניקיה, נקניקיה, נקניקיה"), החזר/י שורה נפרדת לכל מופע, ולא פריט אחד עם כמות. ' +
  'לכל פריט ציין/י את הערכים ל‏יחידה אחת, ואת מספר היחידות (qty) רק כאשר המשתמש ציין במפורש כמות לאותה שורה ' +
  '(למשל "3 ביצים" = qty=3); אחרת qty=1. היחידה (unit) תהיה בלשון יחיד וקצרה ' +
  '(למשל "נקניקיה", "פרוסה", "כף", "ביצה", "מנה"). net_carbs/fat/protein הם סך הכל לכל הארוחה, ' +
  'וחייבים להיות שווים לסכום של qty×ערך-ליחידה על פני כל הפריטים. ' +
  ' השב/י אך ורק ב-JSON תקין בפורמט: ' +
  '{"items": [{"name": "<שם הפריט>", "qty": <מספר היחידות>, "unit": "<יחידה ביחיד>", ' +
  '"carbs": <פחמ\' נטו ליחידה>, "fat": <שומן ליחידה>, "protein": <חלבון ליחידה>}], ' +
  '"net_carbs": <סך פחמ\' נטו>, "fat": <סך שומן>, "protein": <סך חלבון>}' +
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
    // OFF mirrors whatever the physical label said, so the carbs field follows
    // the label convention of the product's origin — the core rules' label
    // note applies here too, judged by brand/origin.
    ' חשב פחמימות נטו לפי הכללים הקטוגניים שלמעלה. ערך הפחמימות משקף את התווית המקורית: ' +
    'במוצר ישראלי/אירופי הוא בדרך כלל כבר ללא סיבים (אל תחסיר סיבים שוב), במוצר אמריקאי הוא כולל סיבים (החסר אותם). ' +
    'שפוט לפי המותג ומקור המוצר, וציין בפירוט מה הנחת. רב-כוהליים החסר לפי הכללים (אריתריטול/מניטול = 0; קסיליטול = 60%; מלטיטול = חצי).' +
    fiberNote +
    ' החזר ערכים ל-100 גרם אלא אם המשתמש ביקש יחידה אחרת.' +
    unitRule +
    ' השב אך ורק ב-JSON תקין: {"name": "<כינוי קצר>", "label": "<תיאור מלא כולל מותג>", ' +
    '"unit": "<היחידה, ברירת מחדל \\"100 גרם\\">", "net_carbs": <מספר>, "fat": <מספר>, ' +
    '"protein": <מספר>, "breakdown": "<פירוט קצר בעברית>"} ללא טקסט נוסף וללא markdown.'
  );
}

export function parseJsonReply(message) {
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

// Normalize the model's per-item array into clean meal items (macros per single
// unit). Items are kept exactly as listed — repeated parts stay as separate
// lines, not folded into one entry with a quantity.
const cleanItems = (arr) => {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((raw) => {
      const name = cleanStr(raw?.name);
      if (!name) return null;
      const q = cleanNum(raw?.qty);
      return {
        name,
        qty: q && q > 0 ? q : 1,
        unit: cleanStr(raw?.unit) || '',
        carbs: cleanNum(raw?.carbs) ?? 0,
        fat: cleanNum(raw?.fat) ?? null,
        protein: cleanNum(raw?.protein) ?? null,
      };
    })
    .filter(Boolean);
};

// Each estimator runs its parsed reply through one of these so callers always
// get a known shape with trustworthy types.
const normalizeMeal = (r) => {
  const items = cleanItems(r.items);
  let net_carbs = cleanNum(r.net_carbs);
  let fat = cleanNum(r.fat);
  let protein = cleanNum(r.protein);

  // The meal card renders each item as qty×(per-unit value) next to the meal
  // total. The model is supposed to keep net_carbs == Σ qty×per-unit, but it
  // sometimes breaks the contract — e.g. for "חצי מלפפון" it emits
  // {qty: 0.5, carbs: 1.9} (the whole-unit value) yet reports net_carbs: 1.9,
  // so the visible item (0.5×1.9 = 0.95) disagrees with the total (1.9). The
  // breakdown is what the user reads and sums by eye, so treat it as the source
  // of truth and derive the totals from it — the card then always reconciles.
  // (fat/protein per item are nullable; only derive when every item carries one.)
  if (items.length) {
    const round2 = (n) => Math.round(n * 100) / 100;
    const sum = (key) => items.reduce((a, it) => a + (Number(it[key]) || 0) * (it.qty || 1), 0);
    net_carbs = round2(sum('carbs'));
    if (items.every((it) => it.fat != null)) fat = round2(sum('fat'));
    if (items.every((it) => it.protein != null)) protein = round2(sum('protein'));
  }

  return { net_carbs, fat, protein, items };
};

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

export async function estimateMeal(desc, products = [], ctx = {}) {
  const message = await getClient(ctx.apiKey).messages.create({
    model: MODEL(),
    max_tokens: 5000,
    system: ketoRules(products) + MEAL_FORMAT,
    messages: [{ role: 'user', content: desc }],
  });
  recordAnthropicUsage({ userId: ctx.userId, kind: 'estimate_meal', model: MODEL(), usage: message.usage });
  return normalizeMeal(parseJsonReply(message));
}

export async function estimateImage(b64, mediaType, unit, products = [], ctx = {}) {
  const message = await getClient(ctx.apiKey).messages.create({
    model: MODEL(),
    max_tokens: 5000,
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
  recordAnthropicUsage({ userId: ctx.userId, kind: 'estimate_image', model: MODEL(), usage: message.usage });
  return normalizeImage(parseJsonReply(message));
}

// Turn raw Open Food Facts numbers into keto net carbs. OFF gives total carbs +
// (sometimes) fiber/polyols per 100g; Claude applies the app's keto rules and
// normalizes the messy entry into our product shape. When fiber is missing it
// estimates it from the known product, so the scan still produces a usable value.
export async function interpretBarcode(off, unit, products = [], ctx = {}) {
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
  const message = await getClient(ctx.apiKey).messages.create({
    model: MODEL(),
    max_tokens: 5000,
    system: ketoRules(products) + barcodeFormat(unit, fiberNote),
    messages: [{ role: 'user', content: facts }],
  });
  recordAnthropicUsage({ userId: ctx.userId, kind: 'barcode', model: MODEL(), usage: message.usage });
  return normalizeBarcode(parseJsonReply(message));
}

export function aiConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}
