// Full-log export: turns the entire journal (days + meals), the saved products,
// and the computed insights into a single readable, schematic Markdown document
// and triggers a download. Plain text — opens anywhere, no dependencies.
import { buildAnalytics } from './analytics.js';
import { dayTotal, dayMacroGrams, fmt, heDate } from './helpers.js';
import i18n from './i18n.js';

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
  if (!a.hasData) return i18n.t('exportLog.noData');
  return table(
    [i18n.t('exportLog.metricHeader'), i18n.t('exportLog.valueHeader')],
    [
      [i18n.t('exportLog.dailyAvgLabel'), i18n.t('exportLog.withTarget', { value: num(a.avg), target: num(target) })],
      [i18n.t('exportLog.loggedDaysLabel'), String(a.loggedDays)],
      [
        i18n.t('exportLog.inTargetLabel'),
        i18n.t('exportLog.inTargetValue', { rate: a.inTargetRate, count: a.inTargetCount, total: a.loggedDays }),
      ],
      [i18n.t('exportLog.currentStreakLabel'), i18n.t('exportLog.daysValue', { days: a.currentStreak })],
      [i18n.t('exportLog.longestStreakLabel'), i18n.t('exportLog.daysValue', { days: a.longestStreak })],
      [i18n.t('exportLog.avg7Label'), num(a.avg7)],
      [i18n.t('exportLog.totalNetCarbsLabel'), num(a.totalNetCarbs)],
      [i18n.t('exportLog.totalMealsLabel'), i18n.t('exportLog.totalMealsValue', { total: a.totalMeals, avg: num(a.avgMeals) })],
    ]
  );
}

function macroBlock(a) {
  if (!a.macroAvg) return '';
  const m = a.macroAvg;
  return [
    i18n.t('exportLog.macroLine', { fat: m.fat, protein: m.protein, carb: m.carb }),
    '',
    i18n.t('exportLog.macroAvgNote', { days: m.days, kcal: m.kcal }),
    i18n.t('exportLog.macroTarget'),
  ].join('\n');
}

function recordsBlock(a) {
  const rows = [];
  if (a.best)
    rows.push([i18n.t('exportLog.bestDayLabel'), i18n.t('common.grams', { value: num(a.best.total) }), heDate(a.best.date)]);
  if (a.worst)
    rows.push([i18n.t('exportLog.worstDayLabel'), i18n.t('common.grams', { value: num(a.worst.total) }), heDate(a.worst.date)]);
  return table([i18n.t('exportLog.recordHeader'), i18n.t('exportLog.valueHeader'), i18n.t('exportLog.dateHeader')], rows);
}

function ketoBlock(a) {
  if (!a.keto) return '';
  const k = a.keto;
  const line = k.done
    ? i18n.t('exportLog.ketoDone', { months: k.months })
    : i18n.t('exportLog.ketoProgress', {
        elapsed: k.elapsed,
        totalDays: k.totalDays,
        pct: k.pct,
        months: k.months,
        remaining: k.remaining,
      });
  const foot = `${heDate(k.start)} – ${heDate(k.end)}${
    k.loggedInPeriod > 0
      ? i18n.t('exportLog.ketoAdherence', { inTarget: k.inTargetInPeriod, logged: k.loggedInPeriod, adherence: k.adherence })
      : ''
  }`;
  return `${line}\n\n_${foot}_`;
}

function hoursBlock(a) {
  if (!a.peakHours.length) return '';
  return table(
    [i18n.t('exportLog.hourHeader'), i18n.t('exportLog.totalCarbsHeader'), i18n.t('exportLog.mealsHeader')],
    a.peakHours.slice(0, 8).map((h) => [hourRange(h.hour), num(h.carbs), String(h.count)])
  );
}

function coffeeBlock(a) {
  if (!a.coffee.total) return '';
  const c = a.coffee;
  const bits = [
    i18n.t('exportLog.coffeeBlack', { count: c.types.black }),
    i18n.t('exportLog.coffeeEspresso', { count: c.types.espresso }),
    i18n.t('exportLog.coffeeInstant', { count: c.types.instant }),
    ...(c.types.other ? [i18n.t('exportLog.coffeeOther', { count: c.types.other })] : []),
  ];
  return `${i18n.t('exportLog.coffeeSummary', { perDay: num(c.perDay), total: c.total })}\n\n${bits.join(' · ')}`;
}

function weightBlock(a) {
  if (!a.weight) return '';
  const w = a.weight;
  const arrow = w.delta < 0 ? '↓' : w.delta > 0 ? '↑' : '→';
  return i18n.t('exportLog.weightSummary', {
    current: num(w.current),
    start: num(w.start),
    arrow,
    delta: num(Math.abs(w.delta)),
    min: num(w.min),
    max: num(w.max),
  });
}

function activityBlock(a) {
  const { runDays, absDays, runRate } = a.activity;
  if (!runDays && !absDays) return '';
  return i18n.t('exportLog.activitySummary', { runDays, runRate, absDays });
}

function categoriesBlock(a) {
  if (!a.categories.length) return '';
  return table(
    [i18n.t('exportLog.categoryHeader'), i18n.t('exportLog.mealsHeader'), i18n.t('exportLog.totalCarbsHeader'), i18n.t('exportLog.avgHeader')],
    a.categories.map((c) => [cell(c.cat), String(c.count), num(c.carbs), num(c.avg)])
  );
}

function productsBlock(products) {
  if (!products.length) return i18n.t('exportLog.noProducts');
  return table(
    [
      i18n.t('exportLog.productHeader'),
      i18n.t('exportLog.unitHeader'),
      i18n.t('exportLog.carbsHeader'),
      i18n.t('exportLog.fatHeader'),
      i18n.t('exportLog.proteinHeader'),
      i18n.t('exportLog.imageHeader'),
    ],
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
  if (d.metrics?.weight) metrics.push(i18n.t('exportLog.metricWeight', { weight: d.metrics.weight }));
  if (d.metrics?.run) metrics.push(i18n.t('exportLog.metricRun'));
  if (d.metrics?.abs) metrics.push(i18n.t('exportLog.metricAbs'));
  if (d.metrics?.status) metrics.push(d.metrics.status);

  const head = `### ${i18n.t('exportLog.dayHead', {
    date: heDate(d.date),
    total: num(total),
    flag,
    fat: num(g.fat),
    protein: num(g.protein),
  })}`;

  const meta = metrics.length ? `\n_${metrics.map(cell).join(' · ')}_\n` : '';

  const body = meals.length
    ? table(
        [
          i18n.t('exportLog.hourHeader'),
          i18n.t('exportLog.categoryHeader'),
          i18n.t('exportLog.detailHeader'),
          i18n.t('exportLog.carbsHeader'),
          i18n.t('exportLog.fatHeader'),
          i18n.t('exportLog.proteinHeader'),
        ],
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
    : `_${i18n.t('exportLog.noMealsForDay')}_`;

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
    email ? i18n.t('exportLog.accountMeta', { email }) : '',
    i18n.t('exportLog.dailyTargetMeta', { value: num(target) }),
    ketoMonths ? i18n.t('exportLog.ketoTargetMeta', { months: ketoMonths }) : '',
    i18n.t('exportLog.generatedMeta', { date: heDate(generatedAt.slice(0, 10)) }),
  ].filter(Boolean);

  // Only emit a section when it has body content.
  const sec = (title, body) => (body ? `## ${title}\n\n${body}\n` : '');

  const parts = [
    i18n.t('exportLog.title'),
    '',
    meta.join('  \n'),
    '',
    '---',
    '',
    sec(i18n.t('exportLog.secSummary'), insightsBlock(a, target)),
    sec(i18n.t('exportLog.secRecords'), recordsBlock(a)),
    sec(i18n.t('exportLog.secMacro'), macroBlock(a)),
    sec(i18n.t('exportLog.secKeto'), ketoBlock(a)),
    sec(i18n.t('exportLog.secPeakHours'), hoursBlock(a)),
    sec(i18n.t('exportLog.secCoffee'), coffeeBlock(a)),
    sec(i18n.t('exportLog.secWeight'), weightBlock(a)),
    sec(i18n.t('exportLog.secActivity'), activityBlock(a)),
    sec(i18n.t('exportLog.secCategories'), categoriesBlock(a)),
    sec(i18n.t('exportLog.secProducts', { count: products.length }), productsBlock(products)),
    `## ${i18n.t('exportLog.secFullLog', { count: days.length })}\n\n${
      desc.length ? desc.map((d) => dayBlock(d, target)).join('\n\n') : i18n.t('exportLog.noDays')
    }\n`,
    '---',
    '',
    i18n.t('exportLog.footer'),
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
