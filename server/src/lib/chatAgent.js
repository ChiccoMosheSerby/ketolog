// The keto assistant: a multi-turn, tool-using chat layer over the user's log.
//
// READ tools (get_today_log / get_log / get_recent_days / list_products) run
// server-side against MongoDB scoped to the logged-in user, so the assistant
// always reasons over a fresh, real log.
//
// WRITE tools (propose_meal / propose_product) are NEVER executed here. They are
// recorded as "proposed actions" and surfaced to the UI as confirmation cards;
// the browser commits them via the existing /api/days and /api/products routes
// only after the user taps "add". The model is told it can only *propose*.
import { getClient, CHAT_MODEL } from './anthropic.js';
import Day from '../models/Day.js';
import Product from '../models/Product.js';
import User from '../models/User.js';

const MAX_TURNS = 6; // safety cap on the tool-use loop per user message
const DEFAULT_TARGET = 20;

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

async function getCarbTarget(userId) {
  const u = await User.findById(userId).select('dailyCarbTarget').lean();
  return u?.dailyCarbTarget ?? DEFAULT_TARGET;
}

const buildSystem = (target) => `אתה "קֶטוֹ", הדיאטן/ית הקטוגני/ת האישי/ת של המשתמש/ת באפליקציית KetoLog — יומן תזונה קטוגנית בעברית.

מי אתה: מומחה/ית ברמה הגבוהה ביותר לתזונה קטוגנית ולתזונה בכלל. אתה מבין/ה לעומק מטבוליזם, קטוזיס, אינסולין, מאקרו ומיקרו-נוטריינטים, סיבים, כוהלי סוכר וממתיקים, וגם את ההיבטים המעשיים — מוצרים בשוק הישראלי, מותגים, מסעדות, בישול ותחליפים. אתה חושב/ת כמו מומחה/ית אמיתי/ת: לא נותן/ת תשובה שטחית, אלא מנתח/ת לעומק, מסביר/ה את ה"למה", ומגיע/ה למסקנה ברורה ובטוחה. אל תהסס/י לתת דעה מקצועית חד-משמעית כשהיא מבוססת.

כללי חישוב פחמימות נטו (זהים ליומן):
- פחמימות נטו = סך הפחמימות, פחות סיבים תזונתיים, פחות אריתריטול ואלולוז.
- סטיביה/טרוביה = 0 פחמימות. מלטיטול/כוהל סוכר אחר — ספור כמחצית מערכו.
- בשר/דג/ביצים = 0 פחמימות; שמן וחמאה = 0 פחמ' וגם 0 חלבון; גבינות קשות מיושנות ≈ 0 פחמ'.
- כשאתה מעריך ערכים — הערך לפי הידע התזונתי הטוב ביותר שלך. אם יש אי-ודאות, ציין טווח קצר והנחה סבירה, אל תמציא דיוק מזויף.
- היעד היומי האישי של המשתמש/ת: מתחת ל-${target} גרם פחמימות נטו ביום. התייחס תמיד ליעד הזה (לא לערך כללי) כשאתה מחשב כמה נשאר או אם חרגו.

עבודה עם היומן:
- כדי לראות מה תועד — השתמש בכלים get_today_log, get_log, get_recent_days, list_products. תמיד בדוק בפועל לפני שאתה עונה על "מה אכלתי", "כמה נשאר לי היום", או שאלות על מגמות — אל תנחש מהזיכרון.
- אינך יכול לכתוב ליומן בעצמך. כדי להוסיף ארוחה השתמש ב-propose_meal, וכדי לשמור מוצר אישי השתמש ב-propose_product. הכלים האלה רק *מציעים* — מוצגת למשתמש/ת כרטיסיית אישור, והוא/היא מאשר/ת לפני השמירה.
- לעולם אל תאמר "הוספתי" או "שמרתי". אמור "הכנתי הצעה — אשר/י כדי לשמור ביומן".
- כשמציעים ארוחה, חשב את הפחמימות נטו (ואם אפשר שומן וחלבון) ומלא אותם בהצעה. אם לא צוין תאריך, השתמש בתאריך של היום.

סגנון: דבר/י עברית, בחום ובגובה העיניים, אבל בעומק מקצועי אמיתי. תן/י תשובה מלאה ומועילה ככל שצריך — הסבר/י את ההיגיון, הצע/י חלופות קונקרטיות, ופרק/י חישובים כשזה עוזר. אל תקצר/י על חשבון התועלת, אבל גם אל תמלא/י במלל מיותר — כל משפט צריך להוסיף ערך. השתמש/י ב-markdown (רשימות, **הדגשה**, טבלאות קצרות) כדי שהתשובה תהיה ברורה וקלה לקריאה.`;

const TOOLS = [
  {
    name: 'get_today_log',
    description: 'מחזיר את כל הארוחות והמדדים של היום הנוכחי, כולל סך הפחמימות נטו עד כה.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_log',
    description: 'מחזיר את היומן (ארוחות + מדדים) של תאריך מסוים.',
    input_schema: {
      type: 'object',
      properties: { date: { type: 'string', description: 'תאריך בפורמט YYYY-MM-DD' } },
      required: ['date'],
    },
  },
  {
    name: 'get_recent_days',
    description: 'מחזיר סיכום של הימים האחרונים (תאריך, תווית, וסך פחמימות נטו ליום). שימושי לשאלות על מגמות וממוצעים.',
    input_schema: {
      type: 'object',
      properties: { limit: { type: 'number', description: 'כמה ימים אחרונים להחזיר (ברירת מחדל 7)' } },
    },
  },
  {
    name: 'list_products',
    description: 'מחזיר את רשימת המוצרים האישיים השמורים של המשתמש/ת עם הערכים התזונתיים שלהם.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'propose_meal',
    description:
      'מציע להוסיף ארוחה ליומן. מציג למשתמש/ת כרטיסיית אישור. אינו שומר עד לאישור. מלא ערכים תזונתיים מחושבים.',
    input_schema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'YYYY-MM-DD. ברירת מחדל: היום' },
        time: { type: 'string', description: 'שעה HH:MM (אופציונלי)' },
        cat: { type: 'string', description: 'סוג הארוחה, למשל "ארוחת בוקר", "נשנוש / ביניים"' },
        desc: { type: 'string', description: 'תיאור מה נאכל' },
        net_carbs: { type: 'number', description: 'פחמימות נטו בגרמים' },
        fat: { type: 'number', description: 'שומן בגרמים (אופציונלי)' },
        protein: { type: 'number', description: 'חלבון בגרמים (אופציונלי)' },
      },
      required: ['desc', 'net_carbs'],
    },
  },
  {
    name: 'propose_product',
    description:
      'מציע לשמור מוצר אישי. מציג למשתמש/ת כרטיסיית אישור. אינו שומר עד לאישור.',
    input_schema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'שם קצר/כינוי למוצר' },
        label: { type: 'string', description: 'תיאור מלא (אופציונלי)' },
        unit: { type: 'string', description: 'יחידת מידה, למשל "מנה", "100 גרם", "כף"' },
        cat: { type: 'string', description: 'קטגוריה (אופציונלי)' },
        carbs: { type: 'number', description: 'פחמימות נטו ליחידה' },
        fat: { type: 'number', description: 'שומן ליחידה (אופציונלי)' },
        protein: { type: 'number', description: 'חלבון ליחידה (אופציונלי)' },
      },
      required: ['key', 'carbs'],
    },
  },
];

const sumCarbs = (meals = []) => meals.reduce((s, m) => s + (Number(m.carbs) || 0), 0);

// Run a READ tool against the DB; return a plain object fed back to the model.
async function runReadTool(name, input, userId, target) {
  if (name === 'get_today_log' || name === 'get_log') {
    const date = name === 'get_today_log' ? todayISO() : input.date;
    const day = await Day.findOne({ user: userId, date }).lean();
    if (!day) {
      return {
        date,
        exists: false,
        meals: [],
        net_carbs_total: 0,
        daily_target: target,
        net_carbs_remaining: target,
      };
    }
    const total = sumCarbs(day.meals);
    return {
      date,
      exists: true,
      label: day.label,
      meals: (day.meals || []).map((m) => ({
        time: m.time,
        cat: m.cat,
        desc: m.desc,
        net_carbs: m.carbs,
        fat: m.fat,
        protein: m.protein,
      })),
      net_carbs_total: total,
      daily_target: target,
      net_carbs_remaining: target - total,
      metrics: day.metrics,
    };
  }
  if (name === 'get_recent_days') {
    const limit = Math.min(Math.max(Number(input.limit) || 7, 1), 60);
    const days = await Day.find({ user: userId }).sort({ date: -1 }).limit(limit).lean();
    return {
      days: days.map((d) => ({
        date: d.date,
        label: d.label,
        net_carbs_total: sumCarbs(d.meals),
        meal_count: (d.meals || []).length,
      })),
    };
  }
  if (name === 'list_products') {
    const products = await Product.find({ user: userId }).sort({ createdAt: 1 }).lean();
    return {
      products: products.map((p) => ({
        key: p.key,
        label: p.label,
        unit: p.unit,
        cat: p.cat,
        net_carbs: p.carbs,
        fat: p.fat,
        protein: p.protein,
      })),
    };
  }
  return { error: 'unknown tool' };
}

// Normalize a proposal tool_use into the action card the client renders + commits.
function buildAction(toolUseId, name, input) {
  if (name === 'propose_meal') {
    return {
      id: toolUseId,
      type: 'meal',
      status: 'pending',
      payload: {
        date: input.date || todayISO(),
        time: input.time || '',
        cat: input.cat || 'נשנוש / ביניים',
        desc: input.desc || '',
        carbs: Number(input.net_carbs) || 0,
        fat: input.fat == null ? null : Number(input.fat),
        protein: input.protein == null ? null : Number(input.protein),
      },
    };
  }
  // propose_product
  return {
    id: toolUseId,
    type: 'product',
    status: 'pending',
    payload: {
      key: input.key || '',
      label: input.label || input.key || '',
      unit: input.unit || 'מנה',
      cat: input.cat || 'נשנוש / ביניים',
      carbs: Number(input.carbs) || 0,
      fat: Number(input.fat) || 0,
      protein: Number(input.protein) || 0,
    },
  };
}

/**
 * Run one user turn against the model, executing read tools and collecting
 * proposed write actions. Mutates `messages` in place (appends assistant +
 * tool_result turns) so the caller can persist the full thread.
 *
 * @returns {{ text: string, actions: object[] }}
 */
// Heal threads persisted before the minimize:false fix: a no-argument tool call
// was stored as a tool_use whose empty `input: {}` got stripped, and the API
// rejects a tool_use with no `input`. Backfill `{}` so old conversations replay.
function normalizeToolInputs(messages) {
  for (const msg of messages) {
    if (!Array.isArray(msg.content)) continue;
    for (const block of msg.content) {
      if (block && block.type === 'tool_use' && block.input == null) block.input = {};
    }
  }
}

export async function runChatTurn(messages, userId) {
  const client = getClient();
  const target = await getCarbTarget(userId);
  const system = buildSystem(target);
  const actions = [];
  let finalText = '';

  normalizeToolInputs(messages);

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const resp = await client.messages.create({
      model: CHAT_MODEL(),
      max_tokens: 8000,
      thinking: { type: 'adaptive' },
      system,
      tools: TOOLS,
      messages,
    });

    messages.push({ role: 'assistant', content: resp.content });

    const text = resp.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
    if (text) finalText = text;

    if (resp.stop_reason !== 'tool_use') break;

    const toolUses = resp.content.filter((b) => b.type === 'tool_use');
    const results = [];
    for (const tu of toolUses) {
      if (tu.name === 'propose_meal' || tu.name === 'propose_product') {
        actions.push(buildAction(tu.id, tu.name, tu.input || {}));
        results.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content:
            'הכרטיסייה הוצגה למשתמש/ת לאישור. ההצעה טרם נשמרה — אל תניח שהיא נשמרה. סכם בקצרה ובקש/י אישור.',
        });
      } else {
        let out;
        try {
          out = await runReadTool(tu.name, tu.input || {}, userId, target);
        } catch (err) {
          out = { error: err.message };
        }
        results.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: JSON.stringify(out),
        });
      }
    }
    messages.push({ role: 'user', content: results });
  }

  return { text: finalText, actions };
}
