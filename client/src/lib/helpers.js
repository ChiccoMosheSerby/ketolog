// Keto math + date helpers, ported from keto-log.html.
export const CEIL = 20;
export const TARGET = 20;
export const MAXR = 50;

export function dayTotal(d) {
  return (d.meals || []).reduce((s, m) => s + (Number(m.carbs) || 0), 0);
}

export function dayMacroGrams(d) {
  return (d.meals || []).reduce(
    (a, m) => ({
      carb: a.carb + (Number(m.carbs) || 0),
      fat: a.fat + (Number(m.fat) || 0),
      protein: a.protein + (Number(m.protein) || 0),
    }),
    { carb: 0, fat: 0, protein: 0 }
  );
}

// calorie-based macro split (fat 9 kcal/g, protein & carb 4)
export function macroPct(g) {
  const fK = g.fat * 9,
    pK = g.protein * 4,
    cK = g.carb * 4;
  const tot = fK + pK + cK;
  if (tot <= 0) return null;
  return {
    fat: Math.round((fK / tot) * 100),
    protein: Math.round((pK / tot) * 100),
    carb: Math.round((cK / tot) * 100),
    kcal: Math.round(tot),
  };
}

export function hasMacros(d) {
  return (d.meals || []).some((m) => m.fat != null || m.protein != null);
}

// Calories *eaten* that day, derived from the logged macros (same fat 9 /
// protein 4 / carb 4 split as macroPct). null when no macros were logged.
export function dayKcal(d) {
  const mp = macroPct(dayMacroGrams(d));
  return mp ? mp.kcal : null;
}

// ---- activity calorie burn (rough estimates) ------------------------------
// Calories burned are estimated from logged activity with the standard MET
// formula: kcal = MET × 3.5 × bodyWeightKg / 200 × minutes. Body weight is read
// from the day's morning-weight metric when present, otherwise a default. These
// figures are deliberately rough (±15%) — a motivational tag, not a medical
// number.
export const BURN_DEFAULT_KG = 80;

// Logged exercises — match the metric checkboxes shown on the day card.
const BURN_RUN = { min: 10, met: 9.8 }; // ריצה 10 דק'
const BURN_ABS = { min: 5, met: 4.0 }; // תרגילי בטן 5 דק'

// Incidental daily movement that happens almost every day and is never logged
// as a meal or an exercise: two ~10-min dog walks, the walk to work, and a few
// trips up/down the stairs at home. Counted as one flat daily baseline.
const BURN_BASELINE = [
  { min: 35, met: 3.5 }, // walking: 2×10-min dog walks + ~15 min to work
  { min: 3, met: 8.0 }, // stairs: a few flights, 2–3× a day
];

const metKcal = (min, met, kg) => ((met * 3.5 * kg) / 200) * min;

// Body weight used for the burn estimate: the day's morning weight if it parses
// to a sane number, otherwise the default.
export function burnWeight(d) {
  const w = parseFloat(String(d?.metrics?.weight || '').replace(',', '.'));
  return Number.isFinite(w) && w > 30 && w < 400 ? w : BURN_DEFAULT_KG;
}

// Breakdown of estimated calories burned for a day: the daily-movement baseline
// plus any logged run / abs session. Values are rounded kcal.
export function activityBurn(d) {
  const kg = burnWeight(d);
  const mt = d?.metrics || {};
  const base = BURN_BASELINE.reduce((s, b) => s + metKcal(b.min, b.met, kg), 0);
  const run = mt.run ? metKcal(BURN_RUN.min, BURN_RUN.met, kg) : 0;
  const abs = mt.abs ? metKcal(BURN_ABS.min, BURN_ABS.met, kg) : 0;
  return {
    base: Math.round(base),
    run: Math.round(run),
    abs: Math.round(abs),
    total: Math.round(base + run + abs),
  };
}

export function fmt(n) {
  return (Math.round(n * 100) / 100).toString();
}

export function todayISO() {
  const t = new Date();
  return (
    t.getFullYear() +
    '-' +
    String(t.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(t.getDate()).padStart(2, '0')
  );
}

// ISO date of the day before `iso` (YYYY-MM-DD).
export function prevISO(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d - 1);
  return (
    dt.getFullYear() +
    '-' +
    String(dt.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(dt.getDate()).padStart(2, '0')
  );
}

export function nowHM() {
  const now = new Date();
  return String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
}

export function heDate(iso) {
  const [y, m, dd] = iso.split('-');
  const dt = new Date(y, m - 1, dd);
  const days = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
  const mon = [
    'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
    'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
  ];
  return 'יום ' + days[dt.getDay()] + ', ' + Number(dd) + ' ב' + mon[m - 1] + ' ' + y;
}

export function dayHebrewName(iso) {
  const [y, m, dd] = iso.split('-');
  const dt = new Date(y, m - 1, dd);
  const days = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
  return days[dt.getDay()];
}

// gradual red transition for the carb meter
function hex(c) {
  return '#' + c.map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('');
}
function mix(c1, c2, t) {
  return hex([0, 1, 2].map((i) => c1[i] + (c2[i] - c1[i]) * t));
}
const COL_RED1 = [192, 73, 47],
  COL_RED2 = [126, 42, 32],
  COL_REDX = [96, 28, 20];

// Upper bound of the meter for a given target. At target=20 this is 50, keeping
// the original zones (green ≤20, amber ≤45, red ≤50) exactly. The target line
// always sits at 1/2.5 = 40% of the bar, so the scale scales cleanly.
export function maxRange(target = TARGET) {
  return target * 2.5;
}

export function zoneInfo(total, target = TARGET) {
  const maxr = maxRange(target);
  const redStart = maxr * 0.9; // 45 when target=20
  const pct = Math.min((total / maxr) * 100, 100);
  let color, cap;
  if (total <= target - 4) {
    color = 'var(--olive)';
    cap = 'ביעד — נשארו ' + fmt(target - total) + ' גרם עד הגבול (' + fmt(target) + ')';
  } else if (total <= target) {
    color = 'var(--olive)';
    cap = 'ביעד, אך מתקרב לגבול — נשארו ' + fmt(target - total) + ' גרם עד ' + fmt(target);
  } else if (total <= redStart) {
    color = 'var(--amber)';
    cap = 'מעל היעד (' + fmt(target) + ') — אזור זהירות, עדיין בטווח קיטו';
  } else if (total <= maxr) {
    color = mix(COL_RED1, COL_RED2, (total - redStart) / (maxr - redStart));
    cap = 'אזור אדום — נשארו ' + fmt(maxr - total) + ' גרם עד חריגה (' + fmt(maxr) + ')';
  } else {
    color = hex(COL_REDX);
    cap = 'חריגה — מעל ' + fmt(maxr) + ' גרם פחמימות נטו';
  }
  return { pct, color, cap };
}
