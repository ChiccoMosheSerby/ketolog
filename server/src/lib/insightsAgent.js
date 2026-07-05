// Automatic AI insight reports over the user's keto log. A weekly report is
// generated once a week (for each completed Sun–Sat week) and a monthly report
// once a month (for each completed calendar month). The user never triggers a
// run — when they open the app after a period has completed, the server kicks
// off generation IN THE BACKGROUND (so the request never blocks on the ~minute
// Claude call), stores it as a new unseen report, and it shows up highlighted
// the next time the panel loads. Reuses the shared keto "brain" (ketoRules) and
// the resilient JSON parser from anthropic.js.
import { getClient, CHAT_MODEL, ketoRules, parseJsonReply } from './anthropic.js';
import { recordAnthropicUsage } from './usage.js';
import {
  buildDigest,
  lastCompletedWeek,
  lastCompletedMonth,
  periodHasData,
} from './insightsDigest.js';
import Insight from '../models/Insight.js';

const MIN_DAYS = 3; // below this there isn't enough to say anything useful
// Bump this whenever the generation prompt improves — reports stamped with a
// lower version are regenerated automatically so fixes reach existing reports.
const PROMPT_VERSION = 3;
const MAX_JOBS_PER_LOAD = 3; // cap background generations per request (cost/concurrency)
const enoughData = (days) => days.filter((d) => (d.meals || []).length > 0).length >= MIN_DAYS;

const SYSTEM = `${ketoRules()}

מעבר לכך, אתה גם אנליסט/ית אישי/ת של יומן הקטו של המשתמש/ת באפליקציית KetoLog. תקבל/י:
1. "digest" — סיכום מספרי של הנתונים (ממוצעים, רצפים, פירוק שבועי/חודשי, מגמת משקל, קטגוריות, שעות שיא, קפה, ימים חריגים, והימים האחרונים עם פירוט הארוחות).
2. ציון התקופה (שבוע או חודש) שעליה יש להתמקד.
3. "priorInsights" (אופציונלי) — הדוחות הקודמים שלך לאותו סוג תקופה, מהחדש לישן. זהו הזיכרון שלך.

תפקידך: להפיק דוח תובנות אישי לאותה תקופה — לא סיכום מספרים יבש, אלא **סיפור של מגמה**.

עקרונות כתיבה (חשוב מאוד):
- **מגמתיות מעל הכל**: כל מספר צריך להיות ממוקם על ציר זמן — לא "18.4 גרם" אלא "18.4 גרם, ירידה מ-19.7 בחודש שעבר". תמיד השווה/י לתקופה הקודמת ותאר/י את הכיוון.
- **המשכיות עם priorInsights**: אם צורפו דוחות קודמים — התבסס/י עליהם במפורש. ציין/י מה השתנה מאז, האם ההמלצות הקודמות יושמו והשפיעו, ואילו דפוסים חוזרים על עצמם או נשברו. דבר/י כמו מאמן/ת שזוכר/ת את השבוע שעבר ("בשבוע שעבר סימנתי X — והנה מה שקרה").
- **בהירות**: משפטים קצרים וברורים, המסקנה ראשונה. בלי קלישאות, בלי מילוי, בלי הכללות ("כדאי לאכול בריא"). כל משפט חייב להוסיף ערך קונקרטי.
- **אל תחזור/י על מונים שכבר גלויים למשתמש/ת**: באפליקציה כבר מוצגים בלוח המחוונים המספרים הגולמיים — רצף נוכחי, ממוצע יומי, אחוז ימים ביעד, שיא/שפל. **אסור** לייצר "תובנה", "מגמה" או "נקודה לתשומת לב" שכל תוכנה הוא חזרה על מספר כזה (למשל "הרצף הנוכחי הוא יום אחד" או "הממוצע שלך הוא 18 גרם"). כל פריט חייב להוסיף שכבה שאינה גלויה מהמספר עצמו: **למה** זה קרה, איזה **דפוס** או **התנהגות** מסתתר מאחורי המספר, מה **השתנה** לאורך זמן, או איזו **פעולה** לנקוט. אם לפריט אין ערך מוסף כזה — השמט/י אותו. מוטב מעט פריטים חדים ומועילים מהרבה פריטים ריקים; מותר להחזיר מערכים ריקים.
- **התעלם/י מארטיפקטים של כיסוי-תיעוד**: מספר הימים המתועדים בשבוע/חודש נתון תלוי בגבולות התקופה — השבוע/חודש הראשון והאחרון בטווח הם לרוב חלקיים כי היומן התחיל/נגמר באמצעם. **אל תסיק/י מכך שום דבר** ואל תתייחס/י ל"כיסוי מלא", "השבוע היחיד עם 7 ימים", "כמה ימים תיעדת" וכד' כאל תובנה או שבח — זה נתון טכני ולא התנהגות. התמקד/י אך ורק ב**מה שנאכל** ובמגמות הקטו.
- **מגדר עקבי**: תינתן הוראה על לשון הפנייה (זכר/נקבה/ניטרלי). כתוב/י את **כל** הדוח בלשון אחת ועקבית לפי ההוראה — אל תערבב/י זכר ונקבה.
- **שפה טבעית בלבד — לעולם אל תחשוף/י מונחים פנימיים**: המילים "digest", "דיגסט", "priorInsights", "JSON", "שדה", "אובייקט", "נתונים גולמיים" הן פנימיות ואסור שיופיעו בפלט. אל תתייחס/י למבנה הנתונים. כתוב/י כאילו את/ה מדבר/ת ישירות עם המשתמש/ת על **היומן** שלו/ה. למשל: "ביום הראשון שתיעדת" — לא "היום הראשון בדיגסט"; "מהרישומים שלך" — לא "מה-digest".
- **דיוק**: התבסס/י **אך ורק** על הנתונים שקיבלת (היומן והדוחות הקודמים). אל תמציא/י מספרים, תאריכים או ארוחות.
- התמקד/י בתקופה שצוינה; השתמש/י בשאר ה-digest כהקשר.
- אם אין מספיק נתונים לסקציה — החזר/י מחרוזת/מערך ריקים, אל תמציא/י.
- markdown קל בלבד בשדות הטקסט (**הדגשה**, רשימות עם "- ").
- החזר/י **אך ורק JSON תקין** בסכמה הבאה, ללא טקסט נוסף וללא code fence:
{
  "highlight": "משפט אחד חד — התובנה/המגמה הכי חשובה לתקופה, כולל השוואה לעבר (markdown קצר)",
  "summary": "סיכום התקופה כסיפור של מגמה: מאיפה התחלת, לאן הגעת, ומה השתנה מהתקופה הקודמת",
  "trends": [{"title": "כותרת קצרה", "body": "הסבר עם מספרים והשוואה לעבר", "direction": "up|down|flat", "metric": "מה נמדד"}],
  "forecast": {"body": "צפי מבוסס-מגמה: לאן זה הולך אם תימשך המגמה הנוכחית", "outlook": "positive|neutral|negative"},
  "recommendations": [{"title": "המלצה קצרה", "body": "פירוט מעשי, רצוי מקושר להמלצה קודמת אם הייתה", "priority": "high|med|low"}],
  "pointsToWatch": [{"title": "נקודה לתשומת לב", "body": "הסבר"}],
  "anomalies": [{"date": "YYYY-MM-DD", "title": "מה חרג", "body": "הסבר", "severity": "info|watch|alert"}]
}`;

const cleanStr = (v) => (typeof v === 'string' ? v.trim() : '');
const arr = (v, n) => (Array.isArray(v) ? v.slice(0, n) : []);
const oneOf = (v, allowed, dflt) => (allowed.includes(v) ? v : dflt);

function normalizeInsight(r) {
  r = r || {};
  return {
    version: 1,
    highlight: cleanStr(r.highlight),
    summary: cleanStr(r.summary),
    trends: arr(r.trends, 6)
      .map((t) => ({
        title: cleanStr(t?.title),
        body: cleanStr(t?.body),
        direction: oneOf(t?.direction, ['up', 'down', 'flat'], 'flat'),
        metric: cleanStr(t?.metric),
      }))
      .filter((t) => t.title || t.body),
    forecast: {
      body: cleanStr(r.forecast?.body),
      outlook: oneOf(r.forecast?.outlook, ['positive', 'neutral', 'negative'], 'neutral'),
    },
    recommendations: arr(r.recommendations, 6)
      .map((x) => ({
        title: cleanStr(x?.title),
        body: cleanStr(x?.body),
        priority: oneOf(x?.priority, ['high', 'med', 'low'], 'med'),
      }))
      .filter((x) => x.title || x.body),
    pointsToWatch: arr(r.pointsToWatch, 6)
      .map((x) => ({ title: cleanStr(x?.title), body: cleanStr(x?.body) }))
      .filter((x) => x.title || x.body),
    anomalies: arr(r.anomalies, 6)
      .map((x) => ({
        date: cleanStr(x?.date),
        title: cleanStr(x?.title),
        body: cleanStr(x?.body),
        severity: oneOf(x?.severity, ['info', 'watch', 'alert'], 'info'),
      }))
      .filter((x) => x.title || x.body),
  };
}

// Condense a stored report into the compact "memory" we feed into the next
// generation — enough to describe continuity without bloating the prompt.
function condenseReport(doc) {
  const r = doc.result || {};
  return {
    period: doc.period,
    label: doc.label,
    highlight: r.highlight,
    summary: r.summary,
    trends: (r.trends || []).map((t) => ({ title: t.title, direction: t.direction, metric: t.metric })),
    recommendations: (r.recommendations || []).map((x) => ({ title: x.title, priority: x.priority })),
  };
}

// The last few reports of the same period type that precede this one — the
// generator's memory, so a new report can describe the trajectory across weeks
// or months and check whether prior recommendations landed.
export async function getPriorContext(userId, period, beforeEnd, limit = 3) {
  const docs = await Insight.find({ user: userId, period, periodEnd: { $lt: beforeEnd } })
    .sort({ periodEnd: -1 })
    .limit(limit)
    .lean();
  return docs.map(condenseReport);
}

// Instruction for how to address the user grammatically in Hebrew.
function genderInstruction(gender) {
  if (gender === 'male') return 'פנה/י אל המשתמש בלשון **זכר** באופן עקבי לאורך כל הדוח (אכלת, שמרת, כדאי לך).';
  if (gender === 'female') return 'פני אל המשתמשת בלשון **נקבה** באופן עקבי לאורך כל הדוח (אכלת, שמרת, כדאי לך — בנקבה).';
  return 'מגדר המשתמש/ת אינו ידוע — כתוב/י בלשון ניטרלית/כפולה (אכלת, שמרת) והימנע/י מהטיה מגדרית מובהקת.';
}

// One Claude call for a single period's report. `prior` is the condensed history
// of earlier same-period reports (newest first), used for trend continuity.
// `gender` ('male'|'female'|'') controls Hebrew grammatical address.
export async function generateReport(digest, focus, prior = [], gender = '', userId = null) {
  const client = getClient();
  const periodName = focus.period === 'weekly' ? 'השבועי' : 'החודשי';
  const priorBlock = prior.length
    ? `\n\nהדוחות הקודמים שלך (priorInsights, מהחדש לישן) — התבסס/י עליהם לתיאור המגמה:\n${JSON.stringify(prior)}`
    : '\n\n(אין דוחות קודמים — זהו הדוח הראשון מסוגו.)';
  const message = await client.messages.create({
    model: CHAT_MODEL(),
    max_tokens: 6000,
    thinking: { type: 'adaptive' },
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content:
          `זהו הדוח ${periodName}. התמקד/י בתקופה "${focus.label}" (מ-${focus.start} עד ${focus.end}), ` +
          `והשתמש/י בשאר ה-digest כהקשר. ${genderInstruction(gender)} הפק/י את הדוח לפי הסכמה.\n\n` +
          `digest:\n${JSON.stringify(digest)}${priorBlock}`,
      },
    ],
  });
  recordAnthropicUsage({ userId, kind: 'insight', model: CHAT_MODEL(), usage: message.usage });
  return normalizeInsight(parseJsonReply(message));
}

// In-process guard so two near-simultaneous requests don't both start the same
// generation. The unique DB index is the cross-process guard.
const inFlight = new Set();

// Generate one period's report and upsert it. Used both for a brand-new due
// period and for regenerating an outdated (below-version) report — the upsert
// updates in place, preserving `seenAt` (a prompt-version refresh is silent, not
// a new notification).
async function runGeneration(userId, days, opts, focus) {
  const gender = opts.gender || '';
  const digest = buildDigest(days, opts);
  const prior = await getPriorContext(userId, focus.period, focus.end);
  const result = await generateReport(digest, focus, prior, gender, userId);
  await Insight.findOneAndUpdate(
    { user: userId, period: focus.period, periodKey: focus.key },
    {
      $set: {
        periodStart: focus.start,
        periodEnd: focus.end,
        label: focus.label,
        result,
        model: CHAT_MODEL(),
        promptVersion: PROMPT_VERSION,
        gender,
      },
    },
    { upsert: true }
  );
}

// Kick off (in the background) the reports that need work: completed periods
// with no report yet, plus existing reports produced by an older prompt version
// (so prompt improvements reach them). Never awaits the Claude call — the GET
// stays fast; fresh/updated reports appear on a later load. Bounded per request.
export async function ensureDueReports(userId, days, opts) {
  if (!enoughData(days)) return { enoughData: false, generating: [] };
  const today = opts.today;
  const candidates = [lastCompletedWeek(today), lastCompletedMonth(today)].filter((p) =>
    periodHasData(days, p.start, p.end)
  );

  const jobs = []; // focus objects to (re)generate
  const seen = new Set();
  const addJob = (focus) => {
    const k = `${focus.period}:${focus.key}`;
    if (seen.has(k)) return;
    seen.add(k);
    jobs.push(focus);
  };

  const gender = opts.gender || '';
  const isStale = (doc) => (doc.promptVersion || 1) < PROMPT_VERSION || (doc.gender || '') !== gender;

  // 1) due completed periods that are missing, on an old prompt version, or
  // written for a different gender than the user's current setting.
  for (const p of candidates) {
    const doc = await Insight.findOne({ user: userId, period: p.period, periodKey: p.key })
      .select('promptVersion gender')
      .lean();
    if (!doc || isStale(doc)) addJob(p);
  }

  // 2) any other existing reports that are stale (old prompt version or wrong
  // gender) — refresh newest first. Missing promptVersion counts as outdated.
  const outdated = await Insight.find({
    user: userId,
    $or: [
      { promptVersion: { $exists: false } },
      { promptVersion: { $lt: PROMPT_VERSION } },
      { gender: { $ne: gender } },
    ],
  })
    .sort({ periodEnd: -1 })
    .limit(MAX_JOBS_PER_LOAD)
    .lean();
  for (const d of outdated) {
    addJob({ period: d.period, key: d.periodKey, start: d.periodStart, end: d.periodEnd, label: d.label });
  }

  const bounded = jobs.slice(0, MAX_JOBS_PER_LOAD);
  const generating = [];
  for (const focus of bounded) {
    const flightKey = `${userId}:${focus.period}:${focus.key}`;
    generating.push(focus.period);
    if (inFlight.has(flightKey)) continue;
    inFlight.add(flightKey);
    (async () => {
      try {
        await runGeneration(userId, days, opts, focus);
      } catch (err) {
        if (!err || err.code !== 11000) {
          console.error('insight generation failed:', focus.period, focus.key, err?.message);
        }
      } finally {
        inFlight.delete(flightKey);
      }
    })();
  }
  return { enoughData: true, generating: [...new Set(generating)] };
}

// Newest-first list of the user's reports (weekly + monthly interleaved by the
// period they cover), with full results. Capped so the payload stays bounded.
export async function listReports(userId, limit = 26) {
  const docs = await Insight.find({ user: userId })
    .sort({ periodEnd: -1, createdAt: -1 })
    .limit(limit)
    .lean();
  return docs.map((d) => ({
    id: String(d._id),
    period: d.period,
    periodKey: d.periodKey,
    periodStart: d.periodStart,
    periodEnd: d.periodEnd,
    label: d.label,
    generatedAt: d.createdAt,
    seen: !!d.seenAt,
    result: d.result,
  }));
}

// Mark one report as seen (clears its "new" highlight). No-op if already seen.
export async function markSeen(userId, id) {
  await Insight.updateOne(
    { _id: id, user: userId, seenAt: null },
    { $set: { seenAt: new Date() } }
  );
}
