// Insight engine for the dashboard. Pure functions that crunch the *entire*
// day log (everything `GET /api/days` returns) into the numbers the Dashboard
// renders. No network, no state — just math over the days array, so it stays
// trivially testable and re-runs cheaply inside a useMemo.
import { dayTotal, dayMacroGrams, macroPct, hasMacros, TARGET } from './helpers.js';
import i18n from './i18n.js';

// A logged weight is free text ("82.5", "82,4 kg", "81"). Pull the first
// number out of it (comma or dot decimal), or null when there's nothing usable.
export function parseWeight(w) {
  if (w == null) return null;
  const m = String(w).replace(',', '.').match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = parseFloat(m[0]);
  return Number.isFinite(n) ? n : null;
}

const asc = (days) => [...days].sort((a, b) => a.date.localeCompare(b.date));
const round1 = (n) => Math.round(n * 10) / 10;
const mealsOf = (d) => d.meals || [];
const pad2 = (n) => String(n).padStart(2, '0');

// ISO date `months` after `iso` (calendar months — clamps day overflow the way
// the Date constructor does, e.g. Jan 31 + 1mo → Mar 3, which is fine here).
function addMonthsISO(iso, months) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1 + months, d);
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
}
// ISO date `n` days after `iso`.
function addDaysISO(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
}
// Whole days between two ISO dates (b - a). ISO strings parse as UTC midnight,
// so the difference is exact regardless of timezone.
const diffDays = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

// Progress through a keto goal: where today sits between the start date and
// start+months, plus in-target adherence over the (past) days of that window.
// The start is the first day of keto *according to the journal* — the earliest
// day that carries a logged meal — not a manually picked date. With no logged
// days yet there's no period to show.
export function buildKetoProgress(days, goal, today, target = TARGET) {
  if (!goal || !goal.months || !today) return null;
  const loggedDates = days.filter((d) => mealsOf(d).length > 0).map((d) => d.date);
  if (!loggedDates.length) return null;
  const start = loggedDates.reduce((a, b) => (a < b ? a : b));
  const end = addMonthsISO(start, goal.months);
  const totalDays = Math.max(1, diffDays(start, end));
  const elapsed = Math.min(Math.max(diffDays(start, today), 0), totalDays);
  // adherence: logged, completed (past) days inside the window
  const inWindow = days.filter(
    (d) => mealsOf(d).length > 0 && d.date >= start && d.date < today && d.date <= end
  );
  const inTarget = inWindow.filter((d) => dayTotal(d) <= target).length;

  // A cell per calendar day across the whole period (start … start+months),
  // each tagged with its status so the dashboard can paint a day-by-day strip:
  //   good   — logged, at/under target
  //   over   — logged, over target
  //   missed — a past day with no meals logged
  //   today  — the current (in-progress) day
  //   future — still ahead
  const totalByDate = new Map();
  days.forEach((d) => {
    if (mealsOf(d).length > 0) totalByDate.set(d.date, dayTotal(d));
  });
  const strip = [];
  for (let i = 0; i < totalDays; i++) {
    const date = addDaysISO(start, i);
    let status;
    if (date > today) status = 'future';
    else if (date === today) status = 'today';
    else if (totalByDate.has(date)) status = totalByDate.get(date) <= target ? 'good' : 'over';
    else status = 'missed';
    strip.push({
      date,
      status,
      total: totalByDate.has(date) ? round1(totalByDate.get(date)) : null,
    });
  }

  return {
    start,
    end,
    months: goal.months,
    totalDays,
    elapsed,
    remaining: Math.max(0, totalDays - elapsed),
    pct: Math.round((elapsed / totalDays) * 100),
    done: diffDays(start, today) >= totalDays,
    loggedInPeriod: inWindow.length,
    inTargetInPeriod: inTarget,
    adherence: inWindow.length ? Math.round((inTarget / inWindow.length) * 100) : 0,
    strip,
  };
}

// Longest run of consecutive `true`s in a boolean array, and the trailing run
// (the streak ending at the last element). Used for "in-target" streaks over
// the sequence of logged days, newest last.
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

// The single object the Dashboard consumes. Every section is null/empty-safe so
// the UI can simply hide a card when its data isn't there yet.
export function buildAnalytics(days, target = TARGET, opts = {}) {
  const { today, ketoGoal } = opts;
  // Statistics only count days that have already passed — today is still in
  // progress, so including it would skew records (a half-eaten day looks
  // "cleanest") and averages. Drop today (and any stray future date).
  const all = asc(days).filter((d) => !today || d.date < today);
  // A "logged" day is one with at least one meal — metric-only days (just a
  // weight, say) shouldn't drag the carb averages down to 0.
  const logged = all.filter((d) => mealsOf(d).length > 0);

  const totals = logged.map(dayTotal);
  const sum = totals.reduce((a, b) => a + b, 0);
  const avg = totals.length ? sum / totals.length : 0;

  // last 7 logged days vs all-time — a quick "am I trending the right way" read
  const last7 = totals.slice(-7);
  const avg7 = last7.length ? last7.reduce((a, b) => a + b, 0) / last7.length : 0;

  const inTargetFlags = logged.map((d) => dayTotal(d) <= target);
  const inTargetCount = inTargetFlags.filter(Boolean).length;
  const { longest: longestStreak, current: currentStreak } = streaks(inTargetFlags);

  // best = lowest net-carb logged day, worst = highest. Tie → earliest date.
  let best = null;
  let worst = null;
  logged.forEach((d) => {
    const t = dayTotal(d);
    if (!best || t < best.total) best = { date: d.date, total: t };
    if (!worst || t > worst.total) worst = { date: d.date, total: t };
  });

  // ---- daily series for the trend chart (chronological) ----
  const series = logged.map((d) => ({ date: d.date, total: round1(dayTotal(d)) }));

  // ---- macro balance (only days that carry fat/protein data) ----
  const macroDays = logged.filter(hasMacros);
  let macroAvg = null;
  if (macroDays.length) {
    const grams = macroDays.reduce(
      (a, d) => {
        const g = dayMacroGrams(d);
        return { carb: a.carb + g.carb, fat: a.fat + g.fat, protein: a.protein + g.protein };
      },
      { carb: 0, fat: 0, protein: 0 }
    );
    const n = macroDays.length;
    const pct = macroPct({ carb: grams.carb / n, fat: grams.fat / n, protein: grams.protein / n });
    // pct is null only if every macro is 0 kcal — then there's nothing to show.
    if (pct) macroAvg = { days: n, ...pct };
  }

  // ---- weight trend (any day with a parseable weight metric) ----
  const weightPoints = all
    .map((d) => ({ date: d.date, w: parseWeight(d.metrics?.weight) }))
    .filter((p) => p.w != null);
  let weight = null;
  if (weightPoints.length >= 2) {
    const first = weightPoints[0];
    const lastW = weightPoints[weightPoints.length - 1];
    const ws = weightPoints.map((p) => p.w);
    weight = {
      points: weightPoints,
      start: first.w,
      current: lastW.w,
      delta: round1(lastW.w - first.w),
      min: round1(Math.min(...ws)),
      max: round1(Math.max(...ws)),
    };
  }

  // ---- activity (run / abs flags live on the day metrics) ----
  const runDays = all.filter((d) => d.metrics?.run).length;
  const absDays = all.filter((d) => d.metrics?.abs).length;

  // ---- meals: totals + category breakdown + carb-heaviest single meals ----
  const allMeals = logged.flatMap((d) => mealsOf(d).map((m) => ({ ...m, date: d.date })));
  const totalMeals = allMeals.length;

  const catMap = new Map();
  allMeals.forEach((m) => {
    const key = (m.cat || '').trim() || i18n.t('analytics.uncategorized');
    const e = catMap.get(key) || { cat: key, count: 0, carbs: 0 };
    e.count += 1;
    e.carbs += Number(m.carbs) || 0;
    catMap.set(key, e);
  });
  const categories = [...catMap.values()]
    .map((e) => ({ ...e, avg: round1(e.carbs / e.count) }))
    .sort((a, b) => b.count - a.count);

  const topMeals = [...allMeals]
    .filter((m) => (Number(m.carbs) || 0) > 0)
    .sort((a, b) => (Number(b.carbs) || 0) - (Number(a.carbs) || 0))
    .slice(0, 5)
    .map((m) => ({
      date: m.date,
      carbs: round1(Number(m.carbs) || 0),
      label: (m.desc || m.cat || i18n.t('analytics.meal')).trim(),
    }));

  // ---- carb load by hour-of-day (only meals that carry a HH:MM time) ----
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
    .map((e) => ({ ...e, carbs: round1(e.carbs), avg: round1(e.carbs / e.count) }))
    .sort((a, b) => b.carbs - a.carbs);

  // ---- coffee/day — detect coffee meals and bucket by type ----
  // A meal only counts as coffee when it actually mentions coffee, so a stray
  // Hebrew "nes" fragment elsewhere never registers. Order: espresso → instant →
  // black. Patterns cover both Hebrew and English wording.
  const COFFEE = /קפה|אספרסו|espresso|קפוצ['׳]?ינו|cappuccino|לאטה|latte|מקיאטו|macchiato|אמריקנו|americano|\bcoffee\b|flat\s?white|mocha/i;
  const ESPRESSO = /אספרסו|espresso/i;
  const INSTANT = /נס[\s-]?קפה|נסקפה|נסטל[ה]?|\bנס\b|instant\s?coffee/iu;
  const BLACK = /שחור|שחורה|\bblack\b/i;
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

  return {
    hasData: logged.length > 0,
    loggedDays: logged.length,
    span: logged.length ? { from: logged[0].date, to: logged[logged.length - 1].date } : null,
    target,
    avg: round1(avg),
    avg7: round1(avg7),
    totalNetCarbs: round1(sum),
    inTargetCount,
    inTargetRate: logged.length ? Math.round((inTargetCount / logged.length) * 100) : 0,
    currentStreak,
    longestStreak,
    best,
    worst,
    series,
    macroAvg,
    weight,
    activity: {
      runDays,
      absDays,
      runRate: logged.length ? Math.round((runDays / logged.length) * 100) : 0,
    },
    totalMeals,
    avgMeals: logged.length ? round1(totalMeals / logged.length) : 0,
    categories,
    topMeals,
    peakHours,
    coffee,
    keto: buildKetoProgress(days, ketoGoal, today, target),
  };
}
