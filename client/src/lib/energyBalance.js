// Energy-balance math: estimate the user's real daily calorie burn (TDEE) from
// their own data — morning weigh-ins vs. the calories they logged eating — and
// grade each day as surplus / even / deficit against it.
//
// The physics: 1 kg of body fat ≈ 7,700 kcal. Over a period of N days,
//   Δweight(kg) = (avg intake − TDEE) × N / 7700
// so, solved for the burn:
//   TDEE = avg intake − (Δweight × 7700) / N
// Weight lost (negative Δ) pushes TDEE above intake; weight gained pulls it
// below. The estimate needs a real stretch of data — day-to-day weight is
// mostly water noise — hence the two-week minimum and the regression below.
import { dayKcal } from './helpers.js';
import { parseWeight } from './analytics.js';

export const KCAL_PER_KG = 7700;
export const MIN_SPAN_DAYS = 14; // first→last weigh-in must span at least this
export const MIN_WEIGHINS = 3; // weekly cadence: two weeks ≈ 3 weigh-ins
export const MIN_KCAL_DAYS = 10; // food-logged days inside the span
export const DEFAULT_LOSS_TARGET = 2; // kg per month
const EVEN_BAND = 75; // ± kcal around TDEE that still counts as "balanced"

const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

// Weigh-in points {date, kg} parsed out of the day docs, oldest first.
export function weightSeries(days) {
  return (days || [])
    .map((d) => ({ date: d.date, kg: parseWeight(d.metrics?.weight) }))
    .filter((p) => Number.isFinite(p.kg) && p.kg > 20 && p.kg < 400)
    .sort((a, b) => a.date.localeCompare(b.date));
}

// Least-squares slope (kg per day) through the weigh-ins — far steadier than
// first-minus-last, which rides on two arbitrary water-weight readings.
function weightSlope(pts) {
  const n = pts.length;
  const x0 = pts[0].date;
  const xs = pts.map((p) => daysBetween(x0, p.date));
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = pts.reduce((a, p) => a + p.kg, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (pts[i].kg - my);
    den += (xs[i] - mx) ** 2;
  }
  return den ? num / den : 0;
}

// The daily deficit a monthly loss goal demands, e.g. 2 kg/month ≈ 513 kcal/day.
export const goalDeficit = (kgPerMonth) => Math.round((kgPerMonth * KCAL_PER_KG) / 30);

// Grade one day's intake against the burn estimate:
//   'goal'    — deficit big enough for the monthly loss target
//   'deficit' — eating under the burn, but slower than the target pace
//   'even'    — within ±EVEN_BAND of the burn
//   'surplus' — eating over the burn (gaining)
export function balanceStatus(kcal, tdee, recommendedIntake) {
  if (kcal <= recommendedIntake) return 'goal';
  if (kcal < tdee - EVEN_BAND) return 'deficit';
  if (kcal <= tdee + EVEN_BAND) return 'even';
  return 'surplus';
}

// The whole picture in one call. Returns { ready:false, progress } until there
// is enough data (the user's "two weeks of weigh-ins"), then the full estimate.
// lossTarget = desired kg lost per month.
export function energyBalance(days, { lossTarget = DEFAULT_LOSS_TARGET, today } = {}) {
  const weights = weightSeries(days);
  const spanDays = weights.length >= 2 ? daysBetween(weights[0].date, weights[weights.length - 1].date) : 0;

  // Food-logged days (with macro detail) inside the weigh-in span.
  const kcalDays = (days || [])
    .map((d) => ({ date: d.date, kcal: dayKcal(d) }))
    .filter(
      (p) =>
        p.kcal != null &&
        weights.length >= 2 &&
        p.date >= weights[0].date &&
        p.date <= weights[weights.length - 1].date
    )
    .sort((a, b) => a.date.localeCompare(b.date));

  const progress = {
    weighIns: weights.length,
    needWeighIns: MIN_WEIGHINS,
    spanDays,
    needSpanDays: MIN_SPAN_DAYS,
    kcalDays: kcalDays.length,
    needKcalDays: MIN_KCAL_DAYS,
  };
  if (weights.length < MIN_WEIGHINS || spanDays < MIN_SPAN_DAYS || kcalDays.length < MIN_KCAL_DAYS) {
    return { ready: false, progress, weights };
  }

  const slope = weightSlope(weights); // kg/day, negative = losing
  const deltaKg = slope * spanDays; // trend-based change over the span
  const avgIntake = Math.round(kcalDays.reduce((s, p) => s + p.kcal, 0) / kcalDays.length);
  const tdee = Math.round(avgIntake - slope * KCAL_PER_KG);
  // Share of span days with food logged. Un-logged days silently read as "ate
  // nothing", biasing intake (and so TDEE) low — surfaced as a warning.
  const coverage = kcalDays.length / (spanDays + 1);

  const requiredDeficit = goalDeficit(lossTarget);
  const recommendedIntake = tdee - requiredDeficit;

  // Recent pace: average balance over the last 14 food-logged days (today is
  // excluded — it's still in progress) → projected kg lost per month.
  const past = today ? kcalDays.filter((p) => p.date < today) : kcalDays;
  const recent = past.slice(-14);
  const recentBalance = recent.length
    ? Math.round(recent.reduce((s, p) => s + (p.kcal - tdee), 0) / recent.length)
    : null;
  const projectedKgPerMonth =
    recentBalance != null ? Math.round(((-recentBalance * 30) / KCAL_PER_KG) * 10) / 10 : null;

  // Per-day grading for the recent strip, newest last.
  const graded = recent.map((p) => ({
    ...p,
    balance: Math.round(p.kcal - tdee),
    status: balanceStatus(p.kcal, tdee, recommendedIntake),
  }));

  return {
    ready: true,
    progress,
    weights,
    spanDays,
    deltaKg: Math.round(deltaKg * 10) / 10,
    slopeKgPerWeek: Math.round(slope * 7 * 100) / 100,
    avgIntake,
    intakeDays: kcalDays.length,
    coverage,
    tdee,
    lossTarget,
    requiredDeficit,
    recommendedIntake,
    recentBalance,
    projectedKgPerMonth,
    graded,
  };
}
