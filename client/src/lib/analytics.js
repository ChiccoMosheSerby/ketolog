// Insight engine for the dashboard. Pure functions that crunch the *entire*
// day log (everything `GET /api/days` returns) into the numbers the Dashboard
// renders. No network, no state — just math over the days array, so it stays
// trivially testable and re-runs cheaply inside a useMemo.
import { dayTotal, dayMacroGrams, macroPct, hasMacros, TARGET } from './helpers.js';

// A logged weight is free text ("82.5", "82,4 ק\"ג", "‎81"). Pull the first
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
export function buildAnalytics(days, target = TARGET) {
  const all = asc(days);
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
    const key = (m.cat || '').trim() || 'ללא קטגוריה';
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
      label: (m.desc || m.cat || 'ארוחה').trim(),
    }));

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
  };
}
