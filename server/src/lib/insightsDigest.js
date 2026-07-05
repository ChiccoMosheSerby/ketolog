// Server-side digest builder for the AI insights feature. Pure functions, no
// Mongo, no network — turns the user's Day documents into a compact JSON summary
// that we hand to Claude. This is deliberately separate from the client
// `analytics.js` (which imports client helpers and can't cross the deploy
// boundary); it re-derives the handful of numbers the insight generator needs.
import { createHash } from 'crypto';

const round1 = (n) => Math.round(n * 10) / 10;
const asc = (days) => [...days].sort((a, b) => a.date.localeCompare(b.date));
const mealsOf = (d) => d.meals || [];
const pad2 = (n) => String(n).padStart(2, '0');

const dayTotal = (d) => mealsOf(d).reduce((s, m) => s + (Number(m.carbs) || 0), 0);

function dayMacroGrams(d) {
  return mealsOf(d).reduce(
    (a, m) => ({
      carb: a.carb + (Number(m.carbs) || 0),
      fat: a.fat + (Number(m.fat) || 0),
      protein: a.protein + (Number(m.protein) || 0),
    }),
    { carb: 0, fat: 0, protein: 0 }
  );
}
const hasMacros = (d) => mealsOf(d).some((m) => m.fat != null || m.protein != null);

// calorie-based macro split (fat 9 kcal/g, protein & carb 4)
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

// First number out of a free-text weight ("82.5", "82,4 ק\"ג"), or null.
function parseWeight(w) {
  if (w == null) return null;
  const m = String(w).replace(',', '.').match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = parseFloat(m[0]);
  return Number.isFinite(n) ? n : null;
}

function streaks(flags) {
  let longest = 0;
  let run = 0;
  for (const f of flags) {
    run = f ? run + 1 : 0;
    if (run > longest) longest = run;
  }
  let current = 0;
  for (let i = flags.length - 1; i >= 0 && flags[i]; i--) current++;
  return { longest, current };
}

// Sunday-of-the-week ISO date for a given ISO date (week starts Sunday, matching
// the app's Hebrew day ordering).
function weekStartISO(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() - dt.getDay());
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
}
function addDaysISO(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
}
function addMonthsISO(iso, months) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1 + months, d);
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
}
const diffDays = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

// Coffee detection covers both languages so the coffee insight works for English
// meals too ("coffee", "latte", "americano", …) as well as Hebrew.
const COFFEE = /קפה|אספרסו|espresso|קפוצ['׳]?ינו|cappuccino|לאטה|latte|מקיאטו|macchiato|אמריקנו|americano|\bcoffee\b|flat\s?white|mocha/i;
const ESPRESSO = /אספרסו|espresso/i;
const INSTANT = /נס[\s-]?קפה|נסקפה|נסטל[ה]?|\bנס\b|instant\s?coffee/iu;
const BLACK = /שחור|שחורה|\bblack\b/i;

// Aggregate a set of logged days into { loggedDays, avgNetCarbs, inTargetRate, weightDelta }.
function bucketStats(daysInBucket, target) {
  const logged = daysInBucket.filter((d) => mealsOf(d).length > 0);
  const totals = logged.map(dayTotal);
  const inTarget = totals.filter((t) => t <= target).length;
  const weights = daysInBucket
    .map((d) => parseWeight(d.metrics?.weight))
    .filter((w) => w != null);
  return {
    loggedDays: logged.length,
    avgNetCarbs: totals.length ? round1(totals.reduce((a, b) => a + b, 0) / totals.length) : null,
    inTargetRate: logged.length ? Math.round((inTarget / logged.length) * 100) : null,
    weightDelta: weights.length >= 2 ? round1(weights[weights.length - 1] - weights[0]) : null,
  };
}

// Keto-period progress (mirrors the client dashboard's buildKetoProgress).
function ketoProgress(days, ketoGoalMonths, today, target) {
  if (!ketoGoalMonths || !today) return null;
  const logged = days.filter((d) => mealsOf(d).length > 0).map((d) => d.date);
  if (!logged.length) return null;
  const start = logged.reduce((a, b) => (a < b ? a : b));
  const end = addMonthsISO(start, ketoGoalMonths);
  const totalDays = Math.max(1, diffDays(start, end));
  const elapsed = Math.min(Math.max(diffDays(start, today), 0), totalDays);
  const inWindow = days.filter(
    (d) => mealsOf(d).length > 0 && d.date >= start && d.date < today && d.date <= end
  );
  const inTarget = inWindow.filter((d) => dayTotal(d) <= target).length;
  return {
    start,
    end,
    months: ketoGoalMonths,
    pct: Math.round((elapsed / totalDays) * 100),
    remainingDays: Math.max(0, totalDays - elapsed),
    done: diffDays(start, today) >= totalDays,
    adherenceRate: inWindow.length ? Math.round((inTarget / inWindow.length) * 100) : 0,
  };
}

/**
 * Build the compact digest handed to the insight generator.
 * @param {Array} days  raw Day documents (lean) for one user
 * @param {{target:number, ketoGoalMonths:number, today:string}} opts
 */
export function buildDigest(days, { target = 20, ketoGoalMonths = 0, today, lang = 'he' } = {}) {
  const noCat = lang === 'en' ? 'Uncategorized' : 'ללא קטגוריה';
  const mealFallback = lang === 'en' ? 'meal' : 'ארוחה';
  // Only completed days count for stats — today is still in progress.
  const all = asc(days).filter((d) => !today || d.date < today);
  const logged = all.filter((d) => mealsOf(d).length > 0);

  const totals = logged.map(dayTotal);
  const avg = totals.length ? totals.reduce((a, b) => a + b, 0) / totals.length : 0;
  const last7 = totals.slice(-7);
  const last30 = totals.slice(-30);
  const avg7 = last7.length ? last7.reduce((a, b) => a + b, 0) / last7.length : 0;
  const avg30 = last30.length ? last30.reduce((a, b) => a + b, 0) / last30.length : 0;

  const inTargetFlags = logged.map((d) => dayTotal(d) <= target);
  const inTargetCount = inTargetFlags.filter(Boolean).length;
  const { longest: longestStreak, current: currentStreak } = streaks(inTargetFlags);

  let best = null;
  let worst = null;
  logged.forEach((d) => {
    const t = dayTotal(d);
    if (!best || t < best.total) best = { date: d.date, total: round1(t) };
    if (!worst || t > worst.total) worst = { date: d.date, total: round1(t) };
  });

  // macro average over days that carry fat/protein
  const macroDays = logged.filter(hasMacros);
  let macroAvg = null;
  if (macroDays.length) {
    const g = macroDays.reduce(
      (a, d) => {
        const mg = dayMacroGrams(d);
        return { carb: a.carb + mg.carb, fat: a.fat + mg.fat, protein: a.protein + mg.protein };
      },
      { carb: 0, fat: 0, protein: 0 }
    );
    const n = macroDays.length;
    const pct = macroPct({ carb: g.carb / n, fat: g.fat / n, protein: g.protein / n });
    if (pct) macroAvg = { days: n, ...pct };
  }

  // weight trend
  const weightPoints = all
    .map((d) => ({ date: d.date, w: parseWeight(d.metrics?.weight) }))
    .filter((p) => p.w != null);
  let weight = null;
  if (weightPoints.length >= 2) {
    const ws = weightPoints.map((p) => p.w);
    weight = {
      start: weightPoints[0].w,
      current: weightPoints[weightPoints.length - 1].w,
      delta: round1(weightPoints[weightPoints.length - 1].w - weightPoints[0].w),
      min: round1(Math.min(...ws)),
      max: round1(Math.max(...ws)),
      points: weightPoints.slice(-14),
    };
  }

  // activity
  const runDays = all.filter((d) => d.metrics?.run).length;
  const absDays = all.filter((d) => d.metrics?.abs).length;

  // weekly / monthly buckets
  const weekMap = new Map();
  const monthMap = new Map();
  for (const d of logged) {
    const wk = weekStartISO(d.date);
    (weekMap.get(wk) || weekMap.set(wk, []).get(wk)).push(d);
    const mo = d.date.slice(0, 7);
    (monthMap.get(mo) || monthMap.set(mo, []).get(mo)).push(d);
  }
  const weeklyBuckets = [...weekMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-8)
    .map(([wk, ds]) => ({ weekStart: wk, weekEnd: addDaysISO(wk, 6), ...bucketStats(ds, target) }));
  const monthlyBuckets = [...monthMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-6)
    .map(([mo, ds]) => ({ month: mo, ...bucketStats(ds, target) }));

  // categories + top meals + peak hours + coffee
  const allMeals = logged.flatMap((d) => mealsOf(d).map((m) => ({ ...m, date: d.date })));
  const catMap = new Map();
  allMeals.forEach((m) => {
    const key = (m.cat || '').trim() || noCat;
    const e = catMap.get(key) || { cat: key, count: 0, carbs: 0 };
    e.count += 1;
    e.carbs += Number(m.carbs) || 0;
    catMap.set(key, e);
  });
  const categories = [...catMap.values()]
    .map((e) => ({ cat: e.cat, count: e.count, avgCarbs: round1(e.carbs / e.count) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  const topMeals = [...allMeals]
    .filter((m) => (Number(m.carbs) || 0) > 0)
    .sort((a, b) => (Number(b.carbs) || 0) - (Number(a.carbs) || 0))
    .slice(0, 5)
    .map((m) => ({ date: m.date, carbs: round1(Number(m.carbs) || 0), label: (m.desc || m.cat || mealFallback).trim() }));

  const hourMap = new Map();
  allMeals.forEach((m) => {
    const t = String(m.time || '');
    if (!/^\d{1,2}:\d{2}$/.test(t)) return;
    const h = parseInt(t.slice(0, 2), 10);
    if (h < 0 || h > 23) return;
    const e = hourMap.get(h) || { hour: h, carbs: 0, count: 0 };
    e.carbs += Number(m.carbs) || 0;
    e.count += 1;
    hourMap.set(h, e);
  });
  const peakHours = [...hourMap.values()]
    .map((e) => ({ hour: e.hour, carbs: round1(e.carbs), count: e.count }))
    .sort((a, b) => b.carbs - a.carbs)
    .slice(0, 6);

  const coffeeTypes = { black: 0, espresso: 0, instant: 0, other: 0 };
  let coffeeTotal = 0;
  allMeals.forEach((m) => {
    const text = `${m.desc || ''} ${m.cat || ''}`;
    if (!COFFEE.test(text)) return;
    coffeeTotal += 1;
    if (ESPRESSO.test(text)) coffeeTypes.espresso += 1;
    else if (INSTANT.test(text)) coffeeTypes.instant += 1;
    else if (BLACK.test(text)) coffeeTypes.black += 1;
    else coffeeTypes.other += 1;
  });
  const coffee = {
    total: coffeeTotal,
    perDay: logged.length ? round1(coffeeTotal / logged.length) : 0,
    types: coffeeTypes,
  };

  // anomaly candidates: logged days notably above the personal average
  const anomalyCandidates = logged
    .map((d) => ({ date: d.date, netCarbs: round1(dayTotal(d)), deltaFromAvg: round1(dayTotal(d) - avg) }))
    .filter((x) => x.netCarbs > target && x.deltaFromAvg > Math.max(8, avg * 0.6))
    .sort((a, b) => b.deltaFromAvg - a.deltaFromAvg)
    .slice(0, 6)
    .map((x) => ({ ...x, kind: 'high_carb_day' }));

  // recent days with meal detail — gives the model concrete, "juicy" material
  const recentDays = logged.slice(-14).map((d) => ({
    date: d.date,
    label: d.label || '',
    netCarbs: round1(dayTotal(d)),
    inTarget: dayTotal(d) <= target,
    weight: parseWeight(d.metrics?.weight),
    run: !!d.metrics?.run,
    meals: mealsOf(d).map((m) => ({
      time: m.time || '',
      cat: m.cat || '',
      desc: m.desc || '',
      carbs: round1(Number(m.carbs) || 0),
    })),
  }));

  return {
    generatedForToday: today || null,
    target,
    span: logged.length ? { from: logged[0].date, to: logged[logged.length - 1].date } : null,
    loggedDays: logged.length,
    totalMeals: allMeals.length,
    totals: {
      avgNetCarbs: round1(avg),
      avgLast7: round1(avg7),
      avgLast30: round1(avg30),
      inTargetCount,
      inTargetRate: logged.length ? Math.round((inTargetCount / logged.length) * 100) : 0,
      currentStreak,
      longestStreak,
    },
    best,
    worst,
    macroAvg,
    weight,
    activity: {
      runDays,
      absDays,
      runRate: logged.length ? Math.round((runDays / logged.length) * 100) : 0,
    },
    weeklyBuckets,
    monthlyBuckets,
    categories,
    topMeals,
    peakHours,
    coffee,
    anomalyCandidates,
    recentDays,
    keto: ketoProgress(all, ketoGoalMonths, today, target),
  };
}

// ---- period windows (which completed week / month is due for a report) ------

const HE_MONTHS = [
  'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
];
const EN_MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const EN_MONTHS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

// The most recent fully-completed week (Sunday–Saturday) before `today`.
// `lang` picks the human label ('he' | 'en'); the ISO fields are unchanged.
export function lastCompletedWeek(today, lang = 'he') {
  const start = addDaysISO(weekStartISO(today), -7); // Sunday of the previous week
  const end = addDaysISO(start, 6);
  const [, sm, sd] = start.split('-').map(Number);
  const [, em, ed] = end.split('-').map(Number);
  const label =
    lang === 'en'
      ? sm === em
        ? `${EN_MONTHS_SHORT[em - 1]} ${sd}–${ed}`
        : `${EN_MONTHS_SHORT[sm - 1]} ${sd} – ${EN_MONTHS_SHORT[em - 1]} ${ed}`
      : sm === em
        ? `${sd}–${ed} ב${HE_MONTHS[em - 1]}`
        : `${sd} ב${HE_MONTHS[sm - 1]} – ${ed} ב${HE_MONTHS[em - 1]}`;
  return { period: 'weekly', key: start, start, end, label };
}

// The most recent fully-completed calendar month before `today`.
export function lastCompletedMonth(today, lang = 'he') {
  const firstOfThis = `${today.slice(0, 7)}-01`;
  const start = addMonthsISO(firstOfThis, -1); // first of previous month
  const end = addDaysISO(firstOfThis, -1); // last day of previous month
  const [y, m] = start.split('-').map(Number);
  const label = lang === 'en' ? `${EN_MONTHS[m - 1]} ${y}` : `${HE_MONTHS[m - 1]} ${y}`;
  return { period: 'monthly', key: start.slice(0, 7), start, end, label };
}

// Does the user have any logged meals within [start, end]?
export function periodHasData(days, start, end) {
  return days.some((d) => (d.meals || []).length > 0 && d.date >= start && d.date <= end);
}

// A cheap fingerprint of the inputs that materially change the digest.
export function digestFingerprint(days, { target = 20, ketoGoalMonths = 0, today } = {}) {
  const logged = days.filter((d) => (d.meals || []).length > 0);
  const lastLogged = logged.reduce((a, d) => (d.date > a ? d.date : a), '');
  const totalMeals = logged.reduce((s, d) => s + (d.meals || []).length, 0);
  const raw = `v1|${logged.length}|${lastLogged}|${totalMeals}|${target}|${ketoGoalMonths}|${today || ''}`;
  return createHash('sha1').update(raw).digest('hex');
}
