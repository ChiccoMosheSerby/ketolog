// Keto math + date helpers, ported from keto-log.html.
import i18n from './i18n.js';

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

// ISO date of the day after `iso` (YYYY-MM-DD).
export function nextISO(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d + 1);
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

// Long human date for a diary header, in the active UI language.
// he: (localized long date)  ·  en: "Sunday, July 5, 2026"
export function heDate(iso) {
  const [y, m, dd] = iso.split('-');
  const dt = new Date(y, m - 1, dd);
  return new Intl.DateTimeFormat(i18n.language, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(dt);
}

// Weekday name for an ISO date, in the active UI language. In Hebrew, Intl
// returns "יום ראשון"; the diary label already prefixes "יום {{num}}", so strip
// the leading "יום " here to avoid the doubled word ("יום 5 · ראשון", not
// "יום 5 · יום ראשון"). English is returned unchanged ("Sunday").
export function dayHebrewName(iso) {
  const [y, m, dd] = iso.split('-');
  const dt = new Date(y, m - 1, dd);
  const name = new Intl.DateTimeFormat(i18n.language, { weekday: 'long' }).format(dt);
  return name.replace(/^יום\s+/, '');
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
  const t = i18n.t;
  let color, cap;
  if (total <= target - 4) {
    color = 'var(--olive)';
    cap = t('meter.onTarget', { left: fmt(target - total), target: fmt(target) });
  } else if (total <= target) {
    color = 'var(--olive)';
    cap = t('meter.nearLimit', { left: fmt(target - total), target: fmt(target) });
  } else if (total <= redStart) {
    color = 'var(--amber)';
    cap = t('meter.overTarget', { target: fmt(target) });
  } else if (total <= maxr) {
    color = mix(COL_RED1, COL_RED2, (total - redStart) / (maxr - redStart));
    cap = t('meter.redZone', { left: fmt(maxr - total), max: fmt(maxr) });
  } else {
    color = hex(COL_REDX);
    cap = t('meter.exceeded', { max: fmt(maxr) });
  }
  return { pct, color, cap };
}
