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

export function zoneInfo(total) {
  const pct = Math.min((total / MAXR) * 100, 100);
  let color, cap;
  if (total <= TARGET - 4) {
    color = 'var(--olive)';
    cap = 'ביעד — נשארו ' + fmt(TARGET - total) + ' גרם עד הגבול (20)';
  } else if (total <= TARGET) {
    color = 'var(--olive)';
    cap = 'ביעד, אך מתקרב לגבול — נשארו ' + fmt(TARGET - total) + ' גרם עד 20';
  } else if (total <= 45) {
    color = 'var(--amber)';
    cap = 'מעל היעד (20) — אזור זהירות, עדיין בטווח קיטו';
  } else if (total <= MAXR) {
    color = mix(COL_RED1, COL_RED2, (total - 45) / 5);
    cap = 'אזור אדום — נשארו ' + fmt(MAXR - total) + ' גרם עד חריגה (50)';
  } else {
    color = hex(COL_REDX);
    cap = 'חריגה — מעל 50 גרם פחמימות נטו';
  }
  return { pct, color, cap };
}
