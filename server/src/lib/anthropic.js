import Anthropic from '@anthropic-ai/sdk';
import { recordAnthropicUsage } from './usage.js';

let client = null;
export function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not set');
  }
  if (!client) {
    // The SDK retries transient failures (429 rate-limit, 408/409, and 5xx
    // including 529 "overloaded") with exponential backoff + jitter, honoring
    // any retry-after header. Bumping past the default of 2 makes brief API
    // overloads self-heal instead of surfacing as a hard error mid-chat.
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 4 });
  }
  return client;
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
// and explicit. Ported from keto-log.html; products injected as context.
// `lang` ('he' | 'en') selects the language of the prompt AND of any free-text
// the model returns (the JSON *keys* are always English — see the format specs).
export function ketoRules(products = [], lang = 'he') {
  let base =
    lang === 'en'
      ? 'You are the world’s best ketogenic-nutrition expert — a clinical dietitian with lab-grade precision. ' +
        'Estimate as accurately as possible for the described amounts: (1) net carbs in grams, (2) fat in grams, (3) protein in grams. ' +
        'Base it on deep nutritional knowledge (e.g. USDA and manufacturer labels), compute from the actual ingredients and amounts, and account for the preparation method. ' +
        'If the amount is unclear, assume a reasonable medium portion — better a sensible estimate than fake precision. ' +
        'Net carbs = total carbohydrates, minus dietary fiber (does not turn into glucose), minus erythritol and allulose (do not raise blood sugar). ' +
        'Stevia/truvia sweeteners = 0 carbs. Maltitol or other sugar alcohols that partially raise blood sugar — count as half their value. ' +
        'Meat/fish/eggs = 0 carbs; oil and butter = 0 carbs and 0 protein; aged hard cheeses ≈ 0 carbs; ' +
        'if no amount is given, assume a reasonable medium portion. ' +
        'Consistency is required: for the same base food always use the same fixed per-whole-unit reference (e.g. a medium cucumber, a large egg), ' +
        'regardless of the meal or the wording. Quantity and size words scale that value linearly from the same base: ' +
        '"half" = half the value, "quarter" = a quarter, "whole" = a full unit, "large"/"small" relative to a medium portion. ' +
        'So a partial portion of a food can never be larger than a whole portion of the same food — verify this before answering.'
      : 'אתה מומחה/ית התזונה הקטוגנית הטוב/ה בעולם — דיאטן/ית קליני/ת עם דיוק של מעבדה. ' +
        'העריך/י בדיוק הגבוה ביותר האפשרי עבור הכמויות המתוארות: (1) פחמימות נטו בגרמים, (2) שומן בגרמים, (3) חלבון בגרמים. ' +
        'בסס/י על ידע תזונתי מעמיק (כמו USDA ותוויות יצרן ישראליות), חשב/י לפי המרכיבים והכמויות בפועל, ושקלל/י את שיטת ההכנה. ' +
        'אם הכמות לא ברורה — הנח/י מנה בינונית סבירה, ועדיף לדייק בהיגיון מאשר להמציא דיוק מזויף. ' +
        'פחמימות נטו = סך הפחמימות, פחות סיבים תזונתיים (אינם הופכים לגלוקוז), פחות אריתריטול ואלולוז (אינם מעלים סוכר בדם). ' +
        'ממתיקים סטיביה/טרוביה = 0 פחמימות. מלטיטול או כוהל סוכר אחר שמעלה סוכר חלקית — ספור כמחצית מערכו. ' +
        'בשר/דג/ביצים = 0 פחמימות; שמן וחמאה = 0 פחמימות וגם 0 חלבון; גבינות קשות מיושנות ≈ 0 פחמימות; ' +
        'אם כמות לא צוינה, הנח מנה בינונית סבירה. ' +
        // Consistency + portion scaling: the same base food must always map to the same
        // per-unit reference, and size/fraction words scale it linearly — so "half" can
        // never come out larger than the "whole" of the same food.
        'עקביות מחייבת: לאותו מאכל בסיסי השתמש/י תמיד באותו ערך ייחוס קבוע ליחידה שלמה (למשל מלפפון בינוני, ביצה L), ' +
        'ללא תלות בארוחה או בניסוח. מילות כמות וגודל משנות את הערך באופן ליניארי מתוך אותו ערך בסיס: ' +
        '"חצי" = מחצית הערך, "רבע" = רבע, "שלם"/"שלמה" = יחידה מלאה, "גדול" / "קטן" ביחס למנה בינונית. ' +
        'לכן מנה חלקית של מאכל לעולם אינה יכולה להיות גדולה ממנה שלמה של אותו מאכל — בדוק/י זאת לפני התשובה.';

  if (products.length) {
    base +=
      lang === 'en'
        ? ' Important: the user has saved products. If any appear — even by an abbreviation or nickname — use these exact per-unit values and do not assume a generic product: ' +
          products
            .map((p) => `"${p.key}" = ${p.label}, per ${p.unit}: ${p.carbs} net carbs / ${p.fat} fat / ${p.protein} protein`)
            .join('; ') +
          '.'
        : ' חשוב: למשתמש יש מוצרים קבועים. אם הם מופיעים — גם בקיצור או בשם הכינוי — השתמש בדיוק בערכים האלה לכל יחידה, ואל תניח מוצר גנרי: ' +
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
// The JSON keys are identical in both languages (so parseJsonReply / normalize*
// never depend on language); only the instruction text and the free-text
// `breakdown`/`name`/`label` VALUES switch to the requested language.
function mealFormat(lang = 'he') {
  if (lang === 'en') {
    return (
      ' Break the meal into separate items exactly as written — do not merge identical items. ' +
      'If an item is written several times (e.g. "sausage, sausage, sausage"), return a separate row for each occurrence, not one item with a quantity. ' +
      'For each item give the values for ONE unit, and set the unit count (qty) only when the user explicitly stated a quantity for that row ' +
      '(e.g. "3 eggs" = qty=3); otherwise qty=1. The unit must be singular and short ' +
      '(e.g. "sausage", "slice", "tbsp", "egg", "serving"). net_carbs/fat/protein are the totals for the whole meal, ' +
      'and must equal the sum of qty×per-unit-value across all items. ' +
      ' Respond only with valid JSON in the format: ' +
      '{"items": [{"name": "<item name>", "qty": <unit count>, "unit": "<singular unit>", ' +
      '"carbs": <net carbs per unit>, "fat": <fat per unit>, "protein": <protein per unit>}], ' +
      '"net_carbs": <total net carbs>, "fat": <total fat>, "protein": <total protein>}' +
      ' with no extra text and no markdown. Write all names and units in English.'
    );
  }
  return (
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
    ' ללא שום טקסט נוסף וללא סימוני markdown. כתוב/י את שמות הפריטים והיחידות בעברית.'
  );
}

function imageFormat(unit, lang = 'he') {
  if (lang === 'en') {
    const unitRule = unit ? ` The requested unit is "${unit}".` : '';
    return (
      ' Identify the product in the image and read the nutrition-facts table if present.' +
      ' Return the values for the whole package/product in the image (not per 100 g), and separately state how many units of the requested type you estimate are in the package' +
      ' (if the image shows a division into rows/squares — count them; otherwise estimate by the size and type of product).' +
      unitRule +
      ' Respond only with valid JSON: {"name": "<short nickname>", "label": "<full description>", "unit": "<the unit>", ' +
      '"pack_net_carbs": <for the whole package>, "pack_fat": <for the whole package>, "pack_protein": <for the whole package>, ' +
      '"units_per_pack": <estimated units per package>, "breakdown": "<short breakdown including package size>"} ' +
      'with no extra text and no markdown. Write name/label/breakdown in English.'
    );
  }
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

function barcodeFormat(unit, fiberNote, lang = 'he') {
  if (lang === 'en') {
    const unitRule = unit ? ` The requested unit is "${unit}".` : '';
    return (
      ' Below is data for a packaged product scanned by barcode, from the Open Food Facts database.' +
      ' Compute net carbs per the keto rules above (subtract fiber; erythritol/allulose = 0; maltitol = half).' +
      fiberNote +
      ' Return values per 100 g unless the user requested a different unit.' +
      unitRule +
      ' Respond only with valid JSON: {"name": "<short nickname>", "label": "<full description including brand>", ' +
      '"unit": "<the unit, default \\"100 g\\">", "net_carbs": <number>, "fat": <number>, ' +
      '"protein": <number>, "breakdown": "<short breakdown in English>"} with no extra text and no markdown.'
    );
  }
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
  const lang = ctx.lang === 'en' ? 'en' : 'he';
  const message = await getClient().messages.create({
    model: MODEL(),
    max_tokens: 5000,
    system: ketoRules(products, lang) + mealFormat(lang),
    messages: [{ role: 'user', content: desc }],
  });
  recordAnthropicUsage({ userId: ctx.userId, kind: 'estimate_meal', model: MODEL(), usage: message.usage });
  return normalizeMeal(parseJsonReply(message));
}

export async function estimateImage(b64, mediaType, unit, products = [], ctx = {}) {
  const lang = ctx.lang === 'en' ? 'en' : 'he';
  const userText =
    lang === 'en'
      ? 'Identify the product. If a label or nutrition-facts table is visible — read it and base the whole-package calculation on it.'
      : 'זהה את המוצר. אם מופיעה תווית או טבלת ערכים תזונתיים — קרא אותה ובסס עליה את החישוב לאריזה השלמה.';
  const message = await getClient().messages.create({
    model: MODEL(),
    max_tokens: 5000,
    system: ketoRules(products, lang) + imageFormat(unit, lang),
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: b64 } },
          { type: 'text', text: userText },
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
  const lang = ctx.lang === 'en' ? 'en' : 'he';
  const fmtNum = (v) => (v == null ? (lang === 'en' ? 'unknown' : 'לא ידוע') : String(v));
  const facts =
    lang === 'en'
      ? [
          off.name && `Name: ${off.name}`,
          off.brands && `Brand: ${off.brands}`,
          off.quantity && `Package size: ${off.quantity}`,
          off.servingSize && `Serving size: ${off.servingSize}`,
          `Per 100 g — carbs: ${fmtNum(off.per100.carbs)}, fiber: ${fmtNum(off.per100.fiber)}, sugars: ${fmtNum(
            off.per100.sugars
          )}, sugar alcohols (polyols): ${fmtNum(off.per100.polyols)}, fat: ${fmtNum(
            off.per100.fat
          )}, protein: ${fmtNum(off.per100.protein)}`,
        ]
          .filter(Boolean)
          .join('\n')
      : [
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
      ? lang === 'en'
        ? ' Note: the fiber value is missing from the database — estimate it by the known product type, and note in the breakdown that fiber was estimated.'
        : ' שים לב: ערך הסיבים חסר במסד הנתונים — הערך אותו לפי סוג המוצר הידוע, וציין בפירוט שהסיבים הוערכו.'
      : '';
  const message = await getClient().messages.create({
    model: MODEL(),
    max_tokens: 5000,
    system: ketoRules(products, lang) + barcodeFormat(unit, fiberNote, lang),
    messages: [{ role: 'user', content: facts }],
  });
  recordAnthropicUsage({ userId: ctx.userId, kind: 'barcode', model: MODEL(), usage: message.usage });
  return normalizeBarcode(parseJsonReply(message));
}

export function aiConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}
