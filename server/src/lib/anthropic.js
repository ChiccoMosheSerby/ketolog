import Anthropic from '@anthropic-ai/sdk';

let client = null;
export function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not set');
  }
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}
export const MODEL = () => process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';

// ---- system prompt (ported from keto-log.html, products injected as context) ----
function buildSys(products = [], withName = false) {
  let base =
    'אתה מחשבון תזונה קטוגנית מדויק. העריך עבור הכמויות המתוארות: (1) פחמימות נטו בגרמים, (2) שומן בגרמים, (3) חלבון בגרמים. ' +
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

  const fmtJson = withName
    ? '{"name": "<שם המוצר/המאכל בעברית>", "net_carbs": <מספר>, "fat": <מספר>, "protein": <מספר>, "breakdown": "<פירוט קצר בעברית>"}'
    : '{"net_carbs": <מספר>, "fat": <מספר>, "protein": <מספר>, "breakdown": "<פירוט קצר בעברית, כל פריט בשורה>"}';

  return (
    base +
    ' השב אך ורק ב-JSON תקין בפורמט: ' +
    fmtJson +
    ' ללא שום טקסט נוסף וללא סימוני markdown.'
  );
}

function parseJsonReply(message) {
  const text = (message.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
  return JSON.parse(text.replace(/```json/g, '').replace(/```/g, '').trim());
}

export async function estimateMeal(desc, products = []) {
  const message = await getClient().messages.create({
    model: MODEL(),
    max_tokens: 1000,
    system: buildSys(products, false),
    messages: [{ role: 'user', content: desc }],
  });
  return parseJsonReply(message);
}

export async function estimateImage(b64, mediaType, unit, products = []) {
  const unitRule = unit ? ` היחידה המבוקשת היא "${unit}".` : '';
  const sys =
    buildSys(products, false).replace(/ השב אך ורק.*$/, '') +
    ' זהה את המוצר בתמונה וקרא את טבלת הערכים התזונתיים אם קיימת.' +
    ' החזר את הערכים עבור האריזה/המוצר השלם שבתמונה (לא ל-100 גרם), ובנפרד ציין מהי כמות היחידות מהסוג המבוקש שניתן להעריך שיש באריזה' +
    ' (אם ניתן לראות חלוקה לשורות/ריבועים בתמונה — ספור אותם; אחרת הערך לפי גודל וסוג המוצר).' +
    unitRule +
    ' השב אך ורק ב-JSON תקין: {"name": "<כינוי קצר>", "label": "<תיאור מלא>", "unit": "<היחידה>", ' +
    '"pack_net_carbs": <לכל האריזה>, "pack_fat": <לכל האריזה>, "pack_protein": <לכל האריזה>, ' +
    '"units_per_pack": <מספר היחידות המשוער באריזה>, "breakdown": "<פירוט קצר כולל גודל האריזה>"} ' +
    'ללא טקסט נוסף וללא markdown.';

  const message = await getClient().messages.create({
    model: MODEL(),
    max_tokens: 1000,
    system: sys,
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
  return parseJsonReply(message);
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
  const unitRule = unit ? ` היחידה המבוקשת היא "${unit}".` : '';

  const sys =
    buildSys(products, false).replace(/ השב אך ורק.*$/, '') +
    ' להלן נתוני מוצר ארוז שנסרק לפי ברקוד, מתוך מסד הנתונים Open Food Facts.' +
    ' חשב פחמימות נטו לפי הכללים הקטוגניים שלמעלה (החסר סיבים; אריתריטול/אלולוז = 0; מלטיטול = חצי).' +
    fiberNote +
    ' החזר ערכים ל-100 גרם אלא אם המשתמש ביקש יחידה אחרת.' +
    unitRule +
    ' השב אך ורק ב-JSON תקין: {"name": "<כינוי קצר>", "label": "<תיאור מלא כולל מותג>", ' +
    '"unit": "<היחידה, ברירת מחדל \\"100 גרם\\">", "net_carbs": <מספר>, "fat": <מספר>, ' +
    '"protein": <מספר>, "breakdown": "<פירוט קצר בעברית>"} ללא טקסט נוסף וללא markdown.';

  const message = await getClient().messages.create({
    model: MODEL(),
    max_tokens: 700,
    system: sys,
    messages: [{ role: 'user', content: facts }],
  });
  return parseJsonReply(message);
}

export function aiConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}
