// Full-log export: turns the entire journal (days + meals), the saved products,
// and the computed insights into a single readable, schematic Markdown document
// and triggers a download. Plain text — opens anywhere, no dependencies.
import { buildAnalytics } from './analytics.js';
import { dayTotal, dayMacroGrams, fmt, heDate } from './helpers.js';

const pad2 = (n) => String(n).padStart(2, '0');
const hourRange = (h) => `${pad2(h)}:00–${pad2((h + 1) % 24)}:00`;
const num = (v) => (v == null || v === '' || isNaN(Number(v)) ? '–' : fmt(Number(v)));

// Escape Markdown table-breaking chars in free-text cells (pipes / newlines).
const cell = (s) =>
  String(s ?? '')
    .replace(/\r?\n/g, ' ')
    .replace(/\|/g, '\\|')
    .trim() || '–';

// A GitHub-style table from a header array + array-of-row-arrays.
function table(headers, rows) {
  if (!rows.length) return '';
  const line = (arr) => `| ${arr.join(' | ')} |`;
  return [line(headers), line(headers.map(() => '---')), ...rows.map(line)].join('\n');
}

function insightsBlock(a, target) {
  if (!a.hasData) return '_אין עדיין נתונים מתועדים לניתוח._';
  return table(
    ['מדד', 'ערך'],
    [
      ['ממוצע יומי (גרם נטו)', `${num(a.avg)} (יעד ${num(target)})`],
      ['ימים מתועדים', String(a.loggedDays)],
      ['ימים ביעד', `${a.inTargetRate}% (${a.inTargetCount}/${a.loggedDays})`],
      ['רצף נוכחי ביעד', `${a.currentStreak} ימים`],
      ['רצף ארוך ביותר', `${a.longestStreak} ימים`],
      ['ממוצע 7 ימים אחרונים', num(a.avg7)],
      ['סה"כ פחמימות נטו', num(a.totalNetCarbs)],
      ['סה"כ ארוחות', `${a.totalMeals} (~${num(a.avgMeals)}/יום)`],
    ]
  );
}

function macroBlock(a) {
  if (!a.macroAvg) return '';
  const m = a.macroAvg;
  return [
    `**שומן ${m.fat}% · חלבון ${m.protein}% · פחמ׳ ${m.carb}%**`,
    '',
    `ממוצע מתוך ${m.days} ימים עם פירוט מאקרו · ~${m.kcal} קק"ל ליום.`,
    'היעד הקטוגני: שומן 70–75% · חלבון 20–25% · פחמ׳ 5–10%.',
  ].join('\n');
}

function recordsBlock(a) {
  const rows = [];
  if (a.best) rows.push(['היום הנקי ביותר', `${num(a.best.total)} ג'`, heDate(a.best.date)]);
  if (a.worst) rows.push(['היום הגבוה ביותר', `${num(a.worst.total)} ג'`, heDate(a.worst.date)]);
  return table(['שיא', 'ערך', 'תאריך'], rows);
}

function ketoBlock(a) {
  if (!a.keto) return '';
  const k = a.keto;
  const line = k.done
    ? `יעד ${k.months} חודשי הקיטו הושלם! ✓`
    : `${k.elapsed} מתוך ${k.totalDays} ימים (${k.pct}%) · יעד ${k.months} חודשים · נותרו ${k.remaining} ימים`;
  const foot = `${heDate(k.start)} – ${heDate(k.end)}${
    k.loggedInPeriod > 0 ? ` · ${k.inTargetInPeriod}/${k.loggedInPeriod} ימים ביעד בתקופה (${k.adherence}%)` : ''
  }`;
  return `${line}\n\n_${foot}_`;
}

function hoursBlock(a) {
  if (!a.peakHours.length) return '';
  return table(
    ['שעה', 'סה"כ פחמ\'', 'ארוחות'],
    a.peakHours.slice(0, 8).map((h) => [hourRange(h.hour), num(h.carbs), String(h.count)])
  );
}

function coffeeBlock(a) {
  if (!a.coffee.total) return '';
  const c = a.coffee;
  const bits = [
    `שחור ${c.types.black}`,
    `אספרסו ${c.types.espresso}`,
    `נס ${c.types.instant}`,
    ...(c.types.other ? [`אחר ${c.types.other}`] : []),
  ];
  return `**${num(c.perDay)}** כוסות ליום בממוצע · ${c.total} סה"כ ☕\n\n${bits.join(' · ')}`;
}

function weightBlock(a) {
  if (!a.weight) return '';
  const w = a.weight;
  const arrow = w.delta < 0 ? '↓' : w.delta > 0 ? '↑' : '→';
  return `נוכחי **${num(w.current)}** ק"ג · התחלה ${num(w.start)} · שינוי ${arrow} ${num(
    Math.abs(w.delta)
  )} · טווח ${num(w.min)}–${num(w.max)}`;
}

function activityBlock(a) {
  const { runDays, absDays, runRate } = a.activity;
  if (!runDays && !absDays) return '';
  return `ריצה: **${runDays}** ימים (${runRate}%) · בטן: **${absDays}** ימים`;
}

function categoriesBlock(a) {
  if (!a.categories.length) return '';
  return table(
    ['קטגוריה', 'ארוחות', 'סה"כ פחמ\'', 'ממוצע'],
    a.categories.map((c) => [cell(c.cat), String(c.count), num(c.carbs), num(c.avg)])
  );
}

function productsBlock(products) {
  if (!products.length) return '_אין מוצרים שמורים._';
  return table(
    ['מוצר', 'יחידה', 'פחמ\'', 'שומן', 'חלבון', 'תמונה'],
    products.map((p) => [
      cell(p.label && p.label !== p.key ? `${p.key} — ${p.label}` : p.key),
      cell(p.unit),
      num(p.carbs),
      num(p.fat),
      num(p.protein),
      p.image ? '📷' : '–',
    ])
  );
}

// One day = a heading with total + metrics, then a meals table.
function dayBlock(d, target) {
  const meals = d.meals || [];
  const total = dayTotal(d);
  const g = dayMacroGrams(d);
  const flag = total > target ? '⚠️' : '✓';

  const metrics = [];
  if (d.metrics?.weight) metrics.push(`משקל ${d.metrics.weight}`);
  if (d.metrics?.run) metrics.push('ריצה ✓');
  if (d.metrics?.abs) metrics.push('בטן ✓');
  if (d.metrics?.status) metrics.push(d.metrics.status);

  const head = `### ${heDate(d.date)} — ${num(total)} ג' נטו ${flag}  ·  שומן ${num(
    g.fat
  )} · חלבון ${num(g.protein)}`;

  const meta = metrics.length ? `\n_${metrics.map(cell).join(' · ')}_\n` : '';

  const body = meals.length
    ? table(
        ['שעה', 'קטגוריה', 'פירוט', 'פחמ\'', 'שומן', 'חלבון'],
        meals.map((m) => {
          const items = (m.items || [])
            .map(
              (it) =>
                `${it.qty > 1 ? `${num(it.qty)}× ` : ''}${it.name} (${num(
                  (Number(it.carbs) || 0) * (it.qty || 1)
                )})`
            )
            .join('; ');
          const desc = items ? `${m.desc || ''} — ${items}` : m.desc || '';
          return [cell(m.time || '–'), cell(m.cat), cell(desc), num(m.carbs), num(m.fat), num(m.protein)];
        })
      )
    : '_אין ארוחות מתועדות ליום זה._';

  return `${head}\n${meta}\n${body}`;
}

// Build the full Markdown document string.
export function buildReportMarkdown({ days, products, target, email, ketoMonths, generatedAt }) {
  const a = buildAnalytics(days, target, {
    today: generatedAt.slice(0, 10),
    ketoGoal: { months: ketoMonths },
  });
  const desc = [...days].sort((x, y) => y.date.localeCompare(x.date)); // newest first

  const meta = [
    email ? `**חשבון:** ${email}` : '',
    `**יעד יומי:** ${num(target)} גרם פחמימות נטו`,
    ketoMonths ? `**יעד קיטו:** ${ketoMonths} חודשים` : '',
    `**הופק:** ${heDate(generatedAt.slice(0, 10))}`,
  ].filter(Boolean);

  // Only emit a section when it has body content.
  const sec = (title, body) => (body ? `## ${title}\n\n${body}\n` : '');

  const parts = [
    `# 🥑 ketolog — דוח יומן מלא`,
    '',
    meta.join('  \n'),
    '',
    '---',
    '',
    sec('סיכום ותובנות', insightsBlock(a, target)),
    sec('שיאים', recordsBlock(a)),
    sec('איזון מאקרו ממוצע', macroBlock(a)),
    sec('תקופת הקיטו', ketoBlock(a)),
    sec('השעות העתירות בפחמימות', hoursBlock(a)),
    sec('קפה', coffeeBlock(a)),
    sec('משקל', weightBlock(a)),
    sec('פעילות', activityBlock(a)),
    sec('ארוחות לפי קטגוריה', categoriesBlock(a)),
    sec(`המוצרים שלי (${products.length})`, productsBlock(products)),
    `## יומן מלא (${days.length} ימים)\n\n${
      desc.length ? desc.map((d) => dayBlock(d, target)).join('\n\n') : '_אין ימים מתועדים._'
    }\n`,
    '---',
    '',
    '_הופק מ-ketolog · הערכים הם הערכות (±2–3 גרם למנות בית)._',
    '',
  ];

  return parts.join('\n');
}

// Generate the report and hand the browser a downloadable .md file.
export function downloadReport(data) {
  const md = buildReportMarkdown(data);
  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const stamp = data.generatedAt.slice(0, 10);
  const link = document.createElement('a');
  link.href = url;
  link.download = `ketolog-${stamp}.md`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
