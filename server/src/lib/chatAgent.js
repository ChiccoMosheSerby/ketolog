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
import { recordAnthropicUsage } from './usage.js';
import { defaultCat, defaultUnit } from './i18n.js';
import Day from '../models/Day.js';
import Product from '../models/Product.js';
import User from '../models/User.js';

const MAX_TURNS = 6; // safety cap on the tool-use loop per user message
const DEFAULT_TARGET = 20;

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// Fetch both the carb target and the account language in one query — the chat
// loop needs the language to pick the system prompt + proposal defaults.
async function getChatContext(userId) {
  const u = await User.findById(userId).select('dailyCarbTarget language').lean();
  return {
    target: u?.dailyCarbTarget ?? DEFAULT_TARGET,
    lang: u?.language === 'en' ? 'en' : 'he',
  };
}

const buildSystemEn = (target) => `You are "Keto", the user's personal ketogenic dietitian in the KetoLog app — a ketogenic food journal.

Who you are: a top-tier expert in ketogenic nutrition and nutrition in general. You deeply understand metabolism, ketosis, insulin, macro- and micronutrients, fiber, sugar alcohols and sweeteners, as well as the practical side — products on the market, brands, restaurants, cooking and substitutes. You think like a real expert: not a shallow answer, but a deep analysis, explaining the "why" and reaching a clear, confident conclusion. Don't hesitate to give a decisive professional opinion when it's well-founded.

Net-carb calculation rules (identical to the journal):
- Net carbs = total carbohydrates, minus dietary fiber, minus erythritol and allulose.
- Stevia/truvia = 0 carbs. Maltitol/other sugar alcohols — count as half their value.
- Meat/fish/eggs = 0 carbs; oil and butter = 0 carbs and 0 protein; aged hard cheeses ≈ 0 carbs.
- When you estimate values, use your best nutritional knowledge. If there's uncertainty, give a short range and a reasonable assumption — don't invent fake precision.
- The user's personal daily target: under ${target} g net carbs per day. Always refer to this target (not a generic value) when computing how much is left or whether they've exceeded it.

Working with the journal:
- To see what's been logged — use the tools get_today_log, get_log, get_recent_days, list_products. Always check the actual data before answering "what did I eat", "how much do I have left today", or questions about trends — don't guess from memory.
- You cannot write to the journal yourself. To add a meal use propose_meal, and to save a personal product use propose_product. These tools only *propose* — the user is shown a confirmation card and approves before it's saved.
- Never say "I added" or "I saved". Say "I've prepared a proposal — approve it to save it to the journal".
- When proposing a meal, compute the net carbs (and fat/protein if possible) and fill them into the proposal. If no date is given, use today's date.

Style: speak English, warm and down-to-earth, but with real professional depth. Give as full and useful an answer as needed — explain the reasoning, offer concrete alternatives, and break down calculations when it helps. Don't cut short at the expense of usefulness, but don't pad with fluff either — every sentence should add value. Use markdown (lists, **bold**, short tables) to keep answers clear and easy to read.`;

const buildSystemHe = (target) => `אתה "קֶטוֹ", הדיאטן/ית הקטוגני/ת האישי/ת של המשתמש/ת באפליקציית KetoLog — יומן תזונה קטוגנית בעברית.

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

const buildSystem = (target, lang) => (lang === 'en' ? buildSystemEn(target) : buildSystemHe(target));

// Tool schema is localized so the model's understanding + example values match
// the user's language (a Hebrew `cat` example would nudge English chats to emit
// Hebrew categories). Tool *names* and property *keys* are language-independent.
const T = (lang, he, en) => (lang === 'en' ? en : he);
const buildTools = (lang) => [
  {
    name: 'get_today_log',
    description: T(
      lang,
      'מחזיר את כל הארוחות והמדדים של היום הנוכחי, כולל סך הפחמימות נטו עד כה.',
      "Returns today's meals and metrics, including the net-carb total so far."
    ),
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_log',
    description: T(lang, 'מחזיר את היומן (ארוחות + מדדים) של תאריך מסוים.', 'Returns the journal (meals + metrics) for a given date.'),
    input_schema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: T(lang, 'תאריך בפורמט YYYY-MM-DD', 'Date in YYYY-MM-DD format') },
      },
      required: ['date'],
    },
  },
  {
    name: 'get_recent_days',
    description: T(
      lang,
      'מחזיר סיכום של הימים האחרונים (תאריך, תווית, וסך פחמימות נטו ליום). שימושי לשאלות על מגמות וממוצעים.',
      'Returns a summary of recent days (date, label, and net-carb total per day). Useful for questions about trends and averages.'
    ),
    input_schema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: T(lang, 'כמה ימים אחרונים להחזיר (ברירת מחדל 7)', 'How many recent days to return (default 7)') },
      },
    },
  },
  {
    name: 'list_products',
    description: T(
      lang,
      'מחזיר את רשימת המוצרים האישיים השמורים של המשתמש/ת עם הערכים התזונתיים שלהם.',
      "Returns the user's saved personal products with their nutrition values."
    ),
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'propose_meal',
    description: T(
      lang,
      'מציע להוסיף ארוחה ליומן. מציג למשתמש/ת כרטיסיית אישור. אינו שומר עד לאישור. מלא ערכים תזונתיים מחושבים.',
      'Proposes adding a meal to the journal. Shows the user a confirmation card. Does not save until approved. Fill in computed nutrition values.'
    ),
    input_schema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: T(lang, 'YYYY-MM-DD. ברירת מחדל: היום', 'YYYY-MM-DD. Default: today') },
        time: { type: 'string', description: T(lang, 'שעה HH:MM (אופציונלי)', 'Time HH:MM (optional)') },
        cat: {
          type: 'string',
          description: T(
            lang,
            'סוג הארוחה, למשל "ארוחת בוקר", "נשנוש / ביניים"',
            'Meal type, e.g. "Breakfast", "Snack / other"'
          ),
        },
        desc: { type: 'string', description: T(lang, 'תיאור מה נאכל', 'Description of what was eaten') },
        net_carbs: { type: 'number', description: T(lang, 'פחמימות נטו בגרמים', 'Net carbs in grams') },
        fat: { type: 'number', description: T(lang, 'שומן בגרמים (אופציונלי)', 'Fat in grams (optional)') },
        protein: { type: 'number', description: T(lang, 'חלבון בגרמים (אופציונלי)', 'Protein in grams (optional)') },
      },
      required: ['desc', 'net_carbs'],
    },
  },
  {
    name: 'propose_product',
    description: T(
      lang,
      'מציע לשמור מוצר אישי. מציג למשתמש/ת כרטיסיית אישור. אינו שומר עד לאישור.',
      'Proposes saving a personal product. Shows the user a confirmation card. Does not save until approved.'
    ),
    input_schema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: T(lang, 'שם קצר/כינוי למוצר', 'Short name/nickname for the product') },
        label: { type: 'string', description: T(lang, 'תיאור מלא (אופציונלי)', 'Full description (optional)') },
        unit: {
          type: 'string',
          description: T(lang, 'יחידת מידה, למשל "מנה", "100 גרם", "כף"', 'Unit of measure, e.g. "serving", "100 g", "tbsp"'),
        },
        cat: { type: 'string', description: T(lang, 'קטגוריה (אופציונלי)', 'Category (optional)') },
        carbs: { type: 'number', description: T(lang, 'פחמימות נטו ליחידה', 'Net carbs per unit') },
        fat: { type: 'number', description: T(lang, 'שומן ליחידה (אופציונלי)', 'Fat per unit (optional)') },
        protein: { type: 'number', description: T(lang, 'חלבון ליחידה (אופציונלי)', 'Protein per unit (optional)') },
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
function buildAction(toolUseId, name, input, lang = 'he') {
  if (name === 'propose_meal') {
    return {
      id: toolUseId,
      type: 'meal',
      status: 'pending',
      payload: {
        date: input.date || todayISO(),
        time: input.time || '',
        cat: input.cat || defaultCat(lang),
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
      unit: input.unit || defaultUnit(lang),
      cat: input.cat || defaultCat(lang),
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

// Prompt caching. The chat loop re-sends the whole growing transcript on every
// tool-use round (up to MAX_TURNS) and on every follow-up turn, at full input
// price. Placing one `cache_control` breakpoint on the LAST content block caches
// the entire prefix before it (render order tools → system → messages), so
// subsequent calls read it at ~0.1× instead of paying full price again. The
// tools+system prefix alone is ~2.9K tokens — below Opus 4.8's 4096-token cache
// minimum — so caching only kicks in once the conversation grows past that,
// which is exactly the long/expensive conversations. We mark a shallow copy so
// no `cache_control` marker is ever persisted into the stored conversation
// (which would risk exceeding the 4-breakpoint limit as the thread grows).
function withCacheBreakpoint(messages) {
  if (!messages.length) return messages;
  const out = messages.slice();
  const last = out[out.length - 1];
  const content = Array.isArray(last.content)
    ? last.content.map((b) => ({ ...b }))
    : [{ type: 'text', text: String(last.content) }];
  content[content.length - 1] = {
    ...content[content.length - 1],
    cache_control: { type: 'ephemeral' },
  };
  out[out.length - 1] = { ...last, content };
  return out;
}

export async function runChatTurn(messages, userId) {
  const client = getClient();
  const { target, lang } = await getChatContext(userId);
  const system = buildSystem(target, lang);
  const tools = buildTools(lang);
  const actions = [];
  let finalText = '';

  normalizeToolInputs(messages);

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const resp = await client.messages.create({
      model: CHAT_MODEL(),
      max_tokens: 8000,
      thinking: { type: 'adaptive' },
      system,
      tools,
      messages: withCacheBreakpoint(messages),
    });

    recordAnthropicUsage({ userId, kind: 'chat', model: CHAT_MODEL(), usage: resp.usage });

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
        actions.push(buildAction(tu.id, tu.name, tu.input || {}, lang));
        results.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content:
            lang === 'en'
              ? 'The confirmation card was shown to the user. The proposal has NOT been saved yet — do not assume it was. Summarize briefly and ask for approval.'
              : 'הכרטיסייה הוצגה למשתמש/ת לאישור. ההצעה טרם נשמרה — אל תניח שהיא נשמרה. סכם בקצרה ובקש/י אישור.',
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
