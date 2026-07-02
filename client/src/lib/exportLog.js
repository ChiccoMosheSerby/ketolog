// Full-log export: turns the entire journal (days + meals), the saved products,
// and the computed insights into a single self-contained, print-friendly HTML
// report and triggers a download. Everything is inlined so the file opens
// anywhere (browser, print-to-PDF, sharing with a dietitian) with no network.
import { buildAnalytics } from './analytics.js';
import { dayTotal, dayMacroGrams, fmt, heDate } from './helpers.js';

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const pad2 = (n) => String(n).padStart(2, '0');
const hourRange = (h) => `${pad2(h)}:00–${pad2((h + 1) % 24)}:00`;
const num = (v) => (v == null || v === '' || isNaN(Number(v)) ? '–' : fmt(Number(v)));

// A stat "chip" for the summary grid.
const stat = (val, lab, sub = '') =>
  `<div class="stat"><div class="stat-num">${esc(val)}${
    sub ? `<span class="stat-sub">${esc(sub)}</span>` : ''
  }</div><div class="stat-lab">${esc(lab)}</div></div>`;

// A labelled section wrapper — only rendered when it has body content.
const section = (title, body) =>
  body ? `<section><h2>${esc(title)}</h2>${body}</section>` : '';

function insightsBlock(a, target) {
  if (!a.hasData) return '<p class="muted">אין עדיין נתונים מתועדים לניתוח.</p>';
  const grid = [
    stat(num(a.avg), 'ממוצע יומי (גרם נטו)', `יעד ${num(target)}`),
    stat(a.loggedDays, 'ימים מתועדים'),
    stat(`${a.inTargetRate}%`, 'ימים ביעד', `${a.inTargetCount}/${a.loggedDays}`),
    stat(a.currentStreak, 'רצף נוכחי ביעד', 'ימים'),
    stat(a.longestStreak, 'רצף ארוך ביותר', 'ימים'),
    stat(num(a.avg7), 'ממוצע 7 ימים אחרונים'),
    stat(num(a.totalNetCarbs), 'סה"כ פחמימות נטו'),
    stat(a.totalMeals, 'סה"כ ארוחות', `~${num(a.avgMeals)}/יום`),
  ].join('');
  return `<div class="stats-grid">${grid}</div>`;
}

function macroBlock(a) {
  if (!a.macroAvg) return '';
  const m = a.macroAvg;
  const seg = (pct, cls) => `<i class="${cls}" style="width:${pct}%"></i>`;
  return `
    <div class="bar">
      ${seg(m.fat, 'seg-fat')}${seg(m.protein, 'seg-prot')}${seg(m.carb, 'seg-carb')}
    </div>
    <div class="legend">
      <span><i class="dot seg-fat"></i>שומן <b>${m.fat}%</b></span>
      <span><i class="dot seg-prot"></i>חלבון <b>${m.protein}%</b></span>
      <span><i class="dot seg-carb"></i>פחמ׳ <b>${m.carb}%</b></span>
    </div>
    <p class="muted">ממוצע מתוך ${m.days} ימים עם פירוט מאקרו · ~${m.kcal} קק"ל ליום · היעד הקטוגני: שומן 70–75% · חלבון 20–25% · פחמ׳ 5–10%</p>`;
}

function recordsBlock(a) {
  if (!a.best && !a.worst) return '';
  const row = (r, cls, cap) =>
    r
      ? `<div class="rec ${cls}"><span class="rec-cap">${esc(cap)}</span><span class="rec-val">${num(
          r.total
        )} ג'</span><span class="rec-date">${esc(heDate(r.date))}</span></div>`
      : '';
  return `<div class="records">${row(a.best, 'good', 'היום הנקי ביותר')}${row(
    a.worst,
    'bad',
    'היום הגבוה ביותר'
  )}</div>`;
}

function ketoBlock(a) {
  if (!a.keto) return '';
  const k = a.keto;
  return `
    <div class="bar"><i class="seg-fat" style="width:${k.pct}%"></i></div>
    <p>${
      k.done
        ? `יעד ${k.months} חודשי הקיטו הושלם! ✓`
        : `${k.elapsed} מתוך ${k.totalDays} ימים (${k.pct}%) · יעד ${k.months} חודשים · נותרו ${k.remaining} ימים`
    }</p>
    <p class="muted">${esc(heDate(k.start))} – ${esc(heDate(k.end))}${
      k.loggedInPeriod > 0
        ? ` · ${k.inTargetInPeriod}/${k.loggedInPeriod} ימים ביעד בתקופה (${k.adherence}%)`
        : ''
    }</p>`;
}

function hoursBlock(a) {
  if (!a.peakHours.length) return '';
  const max = Math.max(...a.peakHours.map((h) => h.carbs)) || 1;
  const rows = a.peakHours
    .slice(0, 8)
    .map(
      (h) =>
        `<div class="track-row"><span class="track-name mono">${hourRange(
          h.hour
        )}</span><span class="track"><i style="width:${(h.carbs / max) * 100}%"></i></span><span class="track-meta">${num(
          h.carbs
        )} ג' · ${h.count} ארוחות</span></div>`
    )
    .join('');
  return `<div class="tracks">${rows}</div>`;
}

function coffeeBlock(a) {
  if (!a.coffee.total) return '';
  const c = a.coffee;
  const chips = [
    ['שחור', c.types.black],
    ['אספרסו', c.types.espresso],
    ['נס', c.types.instant],
    ...(c.types.other ? [['אחר', c.types.other]] : []),
  ]
    .map(([lab, n]) => `<span class="chip">${esc(lab)} <b>${n}</b></span>`)
    .join('');
  return `<p><b>${num(c.perDay)}</b> כוסות ליום בממוצע · ${c.total} סה"כ ☕</p><div class="chips">${chips}</div>`;
}

function weightBlock(a) {
  if (!a.weight) return '';
  const w = a.weight;
  const arrow = w.delta < 0 ? '↓' : w.delta > 0 ? '↑' : '→';
  return `<p><b>${num(w.current)}</b> ק"ג נוכחי · התחלה ${num(w.start)} · שינוי ${arrow} ${num(
    Math.abs(w.delta)
  )} · טווח ${num(w.min)}–${num(w.max)}</p>`;
}

function activityBlock(a) {
  const { runDays, absDays, runRate } = a.activity;
  if (!runDays && !absDays) return '';
  return `<p>ריצה: <b>${runDays}</b> ימים (${runRate}%) · בטן: <b>${absDays}</b> ימים</p>`;
}

function categoriesBlock(a) {
  if (!a.categories.length) return '';
  const rows = a.categories
    .map(
      (c) =>
        `<tr><td>${esc(c.cat)}</td><td class="n">${c.count}</td><td class="n">${num(
          c.carbs
        )}</td><td class="n">${num(c.avg)}</td></tr>`
    )
    .join('');
  return `<table><thead><tr><th>קטגוריה</th><th class="n">ארוחות</th><th class="n">סה"כ פחמ'</th><th class="n">ממוצע</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function productsBlock(products) {
  if (!products.length) return '<p class="muted">אין מוצרים שמורים.</p>';
  const rows = products
    .map(
      (p) =>
        `<tr><td class="thumb-cell">${
          p.image ? `<img class="thumb" src="${esc(p.image)}" alt="">` : '<span class="thumb ph">🍽️</span>'
        }</td><td><b>${esc(p.key)}</b>${
          p.label && p.label !== p.key ? `<br><span class="muted">${esc(p.label)}</span>` : ''
        }</td><td>${esc(p.unit)}</td><td class="n">${num(p.carbs)}</td><td class="n">${num(
          p.fat
        )}</td><td class="n">${num(p.protein)}</td></tr>`
    )
    .join('');
  return `<table><thead><tr><th></th><th>מוצר</th><th>יחידה</th><th class="n">פחמ'</th><th class="n">שומן</th><th class="n">חלבון</th></tr></thead><tbody>${rows}</tbody></table>`;
}

// One day = a heading with its net-carb total + metrics, then a meals table.
function dayBlock(d, target) {
  const meals = d.meals || [];
  const total = dayTotal(d);
  const g = dayMacroGrams(d);
  const over = total > target;
  const metrics = [];
  if (d.metrics?.weight) metrics.push(`משקל ${esc(d.metrics.weight)}`);
  if (d.metrics?.run) metrics.push('ריצה ✓');
  if (d.metrics?.abs) metrics.push('בטן ✓');
  if (d.metrics?.status) metrics.push(esc(d.metrics.status));

  const mealRows = meals.length
    ? meals
        .map((m) => {
          const items =
            (m.items || []).length > 0
              ? `<div class="items">${m.items
                  .map(
                    (it) =>
                      `<span class="item">${it.qty > 1 ? `${num(it.qty)}× ` : ''}${esc(
                        it.name
                      )} <em>(${num((Number(it.carbs) || 0) * (it.qty || 1))} פחמ')</em></span>`
                  )
                  .join('')}</div>`
              : '';
          return `<tr><td class="mono">${esc(m.time || '–')}</td><td>${esc(
            m.cat || ''
          )}</td><td>${esc(m.desc || '')}${items}</td><td class="n">${num(
            m.carbs
          )}</td><td class="n">${num(m.fat)}</td><td class="n">${num(m.protein)}</td></tr>`;
        })
        .join('')
    : `<tr><td colspan="6" class="muted">אין ארוחות מתועדות ליום זה.</td></tr>`;

  return `
    <div class="day">
      <div class="day-head">
        <span class="day-date">${esc(heDate(d.date))}</span>
        <span class="day-total ${over ? 'over' : 'ok'}">${num(total)} ג' נטו</span>
        <span class="day-macros mono">שומן ${num(g.fat)} · חלבון ${num(g.protein)}</span>
      </div>
      ${metrics.length ? `<div class="day-metrics">${metrics.join(' · ')}</div>` : ''}
      <table class="meals">
        <thead><tr><th>שעה</th><th>קטגוריה</th><th>פירוט</th><th class="n">פחמ'</th><th class="n">שומן</th><th class="n">חלבון</th></tr></thead>
        <tbody>${mealRows}</tbody>
      </table>
    </div>`;
}

const STYLES = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { font-family: 'Assistant', -apple-system, 'Segoe UI', Arial, sans-serif; margin: 0; background: #f4f1ea; color: #2b2a26; line-height: 1.5; }
  .page { max-width: 900px; margin: 0 auto; padding: 28px 22px 60px; }
  header.report { border-bottom: 3px solid #6b7a4f; padding-bottom: 16px; margin-bottom: 22px; }
  header.report h1 { margin: 0 0 4px; font-size: 26px; color: #4a5a30; }
  header.report .meta { font-size: 13px; color: #6a685f; display: flex; flex-wrap: wrap; gap: 6px 16px; margin-top: 8px; }
  section { background: #fff; border: 1px solid #e3ddd0; border-radius: 12px; padding: 16px 18px; margin-bottom: 16px; box-shadow: 0 1px 2px rgba(0,0,0,.03); page-break-inside: avoid; }
  h2 { font-size: 17px; margin: 0 0 12px; color: #4a5a30; border-bottom: 1px solid #eee6d6; padding-bottom: 6px; }
  .muted { color: #8a887e; font-size: 12.5px; }
  .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 10px; }
  .stat { background: #f7f5ee; border: 1px solid #eee6d6; border-radius: 10px; padding: 10px 12px; text-align: center; }
  .stat-num { font-size: 22px; font-weight: 700; color: #3d4a27; }
  .stat-sub { font-size: 11px; font-weight: 500; color: #8a887e; margin-inline-start: 4px; }
  .stat-lab { font-size: 11.5px; color: #6a685f; margin-top: 2px; }
  .bar { display: flex; height: 16px; border-radius: 999px; overflow: hidden; background: #eee6d6; margin-bottom: 8px; }
  .bar i { display: block; height: 100%; }
  .seg-fat { background: #6b7a4f; } .seg-prot { background: #b08968; } .seg-carb { background: #d9a441; }
  .legend { display: flex; gap: 16px; flex-wrap: wrap; font-size: 12.5px; }
  .dot { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-inline-end: 4px; vertical-align: middle; }
  .records { display: flex; gap: 12px; flex-wrap: wrap; }
  .rec { flex: 1; min-width: 160px; border-radius: 10px; padding: 10px 12px; border: 1px solid #eee6d6; }
  .rec.good { background: #eef3e4; } .rec.bad { background: #f6ece2; }
  .rec-cap { display: block; font-size: 12px; color: #6a685f; }
  .rec-val { display: block; font-size: 20px; font-weight: 700; }
  .rec-date { display: block; font-size: 12px; color: #8a887e; }
  .tracks { display: flex; flex-direction: column; gap: 6px; }
  .track-row { display: flex; align-items: center; gap: 10px; font-size: 12.5px; }
  .track-name { flex: 0 0 96px; } .track-meta { flex: 0 0 auto; color: #6a685f; }
  .track { flex: 1; height: 12px; background: #eee6d6; border-radius: 999px; overflow: hidden; }
  .track i { display: block; height: 100%; background: #d9a441; }
  .chips { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
  .chip { background: #f7f5ee; border: 1px solid #eee6d6; border-radius: 999px; padding: 3px 12px; font-size: 12.5px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: start; padding: 7px 8px; border-bottom: 1px solid #eee6d6; vertical-align: top; }
  th { font-size: 11.5px; color: #6a685f; font-weight: 600; }
  td.n, th.n { text-align: center; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .mono { font-family: 'IBM Plex Mono', ui-monospace, monospace; }
  .thumb-cell { width: 44px; }
  .thumb { width: 36px; height: 36px; border-radius: 6px; object-fit: cover; border: 1px solid #e3ddd0; display: block; }
  .thumb.ph { display: flex; align-items: center; justify-content: center; background: #f7f5ee; font-size: 16px; }
  .day { margin-bottom: 18px; page-break-inside: avoid; }
  .day-head { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; border-bottom: 2px solid #eee6d6; padding-bottom: 5px; margin-bottom: 6px; }
  .day-date { font-weight: 700; font-size: 14.5px; color: #3d4a27; }
  .day-total { font-weight: 700; padding: 1px 10px; border-radius: 999px; font-size: 13px; }
  .day-total.ok { background: #eef3e4; color: #4a5a30; } .day-total.over { background: #f6e2dc; color: #a24a37; }
  .day-macros { font-size: 12px; color: #6a685f; }
  .day-metrics { font-size: 12px; color: #6a685f; margin-bottom: 6px; }
  table.meals th { background: #faf8f2; }
  .items { margin-top: 3px; display: flex; flex-wrap: wrap; gap: 4px 10px; }
  .item { font-size: 11.5px; color: #6a685f; } .item em { color: #98968c; font-style: normal; }
  footer.report { text-align: center; font-size: 11.5px; color: #8a887e; margin-top: 24px; }
  @media print { body { background: #fff; } section, .day { box-shadow: none; } }
`;

// Build the full HTML document string.
export function buildReportHTML({ days, products, target, email, ketoMonths, generatedAt }) {
  const a = buildAnalytics(days, target, {
    today: generatedAt.slice(0, 10),
    ketoGoal: { months: ketoMonths },
  });
  const asc = [...days].sort((x, y) => y.date.localeCompare(x.date)); // newest first

  const metaBits = [
    email ? `חשבון: ${esc(email)}` : '',
    `יעד יומי: ${num(target)} גרם פחמימות נטו`,
    ketoMonths ? `יעד קיטו: ${ketoMonths} חודשים` : '',
    `הופק: ${esc(heDate(generatedAt.slice(0, 10)))}`,
  ]
    .filter(Boolean)
    .map((s) => `<span>${s}</span>`)
    .join('');

  const body = [
    section('סיכום ותובנות', insightsBlock(a, target)),
    section('שיאים', recordsBlock(a)),
    section('איזון מאקרו ממוצע', macroBlock(a)),
    section('תקופת הקיטו', ketoBlock(a)),
    section('השעות העתירות בפחמימות', hoursBlock(a)),
    section('קפה', coffeeBlock(a)),
    section('משקל', weightBlock(a)),
    section('פעילות', activityBlock(a)),
    section('ארוחות לפי קטגוריה', categoriesBlock(a)),
    section(`המוצרים שלי (${products.length})`, productsBlock(products)),
    section(`יומן מלא (${days.length} ימים)`, asc.map((d) => dayBlock(d, target)).join('')),
  ].join('');

  return `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ketolog — דוח מלא</title>
<style>${STYLES}</style>
</head>
<body>
<div class="page">
  <header class="report">
    <h1>🥑 ketolog — דוח יומן מלא</h1>
    <div class="meta">${metaBits}</div>
  </header>
  ${body}
  <footer class="report">
    הופק מ-ketolog · הערכים הם הערכות (±2–3 גרם למנות בית).
  </footer>
</div>
</body>
</html>`;
}

// Generate the report and hand the browser a downloadable .html file.
export function downloadReport(data) {
  const html = buildReportHTML(data);
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const stamp = data.generatedAt.slice(0, 10);
  const link = document.createElement('a');
  link.href = url;
  link.download = `ketolog-${stamp}.html`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
