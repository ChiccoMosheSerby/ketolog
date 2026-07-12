// Diary Excel export: the daily journal only — one sheet of days, one of
// meals, one of the per-item breakdowns. Styled for reading: RTL sheets,
// frozen header rows, autofilter, zebra rows and traffic-light status colors.
// This module is imported dynamically by the caller, so exceljs never weighs
// on the main bundle.
import ExcelJS from 'exceljs';
import {
  dayTotal, dayMacroGrams, dayKcal, macroKcal, maxRange, dayHebrewName,
} from './helpers.js';

// ---- palette (ARGB) — mirrors the app's avocado theme ----
const C = {
  headFill: 'FF3D6B35', // dark avocado — header rows
  headText: 'FFFFFFFF',
  zebra: 'FFF4F8F0', // faint green — every 2nd row
  line: 'FFDCE5D5',
  ink: 'FF243021',
  green: 'FF4C7A3D',
  greenFill: 'FFE7F1E0',
  amber: 'FFB07818',
  amberFill: 'FFFBF0DA',
  red: 'FFC0492F',
  redFill: 'FFF9E2DC',
};

const thin = { style: 'thin', color: { argb: C.line } };
const BORDER = { top: thin, bottom: thin, left: thin, right: thin };

const round2 = (n) => Math.round(n * 100) / 100;
const numOr = (v) => (v == null || v === '' || isNaN(Number(v)) ? null : round2(Number(v)));

// Traffic-light for a day's net carbs against the target (matches zoneInfo zones).
function carbStatus(total, target) {
  if (total <= target) return { text: 'ביעד ✓', font: C.green, fill: C.greenFill };
  if (total <= maxRange(target) * 0.9) return { text: 'מעל היעד', font: C.amber, fill: C.amberFill };
  return { text: 'חריגה', font: C.red, fill: C.redFill };
}

function kcalStatus(kcal, target) {
  if (!target || kcal == null) return null;
  if (kcal <= target) return { font: C.green, fill: C.greenFill };
  if (kcal <= target * 1.1) return { font: C.amber, fill: C.amberFill };
  return { font: C.red, fill: C.redFill };
}

// 'catalog' is legacy: meals logged by the retired learned-catalog feature.
const SOURCE_HE = { catalog: 'קטלוג מוצרים', local: 'מוצרים שמורים', ai: 'AI' };

// ---- sheet helpers ----

function addSheet(wb, name, columns) {
  const ws = wb.addWorksheet(name, {
    views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }],
    properties: { defaultRowHeight: 18 },
  });
  ws.columns = columns;
  const head = ws.getRow(1);
  head.height = 24;
  head.eachCell((c) => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.headFill } };
    c.font = { name: 'Arial', size: 11, bold: true, color: { argb: C.headText } };
    c.alignment = { horizontal: 'center', vertical: 'middle' };
    c.border = BORDER;
  });
  ws.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: columns.length },
  };
  return ws;
}

// Zebra fill + borders + base font for a data row.
function styleRow(row, idx) {
  row.eachCell({ includeEmpty: true }, (c) => {
    c.border = BORDER;
    if (!c.font) c.font = { name: 'Arial', size: 10.5, color: { argb: C.ink } };
    if (idx % 2 === 1 && !c.fill) {
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.zebra } };
    }
  });
}

function paint(cell, st, bold = false) {
  if (!st) return;
  cell.font = { name: 'Arial', size: 10.5, bold, color: { argb: st.font } };
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: st.fill } };
}

const center = (row, keys) => {
  keys.forEach((k) => {
    row.getCell(k).alignment = { horizontal: 'center', vertical: 'middle' };
  });
};

// ---- one row per day ----
function daysSheet(wb, days, target, kcalTarget) {
  const ws = addSheet(wb, 'ימים', [
    { header: '#', key: 'n', width: 5 },
    { header: 'תאריך', key: 'date', width: 12 },
    { header: 'יום', key: 'weekday', width: 9 },
    { header: "שומן (ג')", key: 'fat', width: 11 },
    { header: "חלבון (ג')", key: 'protein', width: 11 },
    { header: "פחמ' נטו (ג')", key: 'carbs', width: 13 },
    { header: 'סטטוס', key: 'status', width: 12 },
    { header: 'קק"ל', key: 'kcal', width: 10 },
    { header: 'משקל (ק"ג)', key: 'weight', width: 12 },
    { header: 'ריצה', key: 'run', width: 7 },
    { header: 'בטן', key: 'abs', width: 7 },
    { header: 'הערות', key: 'status_note', width: 40 },
  ]);

  days.forEach((d, i) => {
    const total = round2(dayTotal(d));
    const g = dayMacroGrams(d);
    const kcal = dayKcal(d);
    const st = carbStatus(total, target);
    const row = ws.addRow({
      n: i + 1,
      date: d.date,
      weekday: dayHebrewName(d.date),
      carbs: total,
      status: st.text,
      fat: g.fat ? round2(g.fat) : null,
      protein: g.protein ? round2(g.protein) : null,
      kcal,
      weight: numOr(d.metrics?.weight),
      run: d.metrics?.run ? '✓' : '',
      abs: d.metrics?.abs ? '✓' : '',
      status_note: d.metrics?.status || '',
    });
    styleRow(row, i);
    row.getCell('carbs').font = { name: 'Arial', size: 10.5, bold: true, color: { argb: st.font } };
    paint(row.getCell('status'), st, true);
    paint(row.getCell('kcal'), kcalStatus(kcal, kcalTarget));
    row.getCell('status_note').alignment = { wrapText: true, vertical: 'top' };
    center(row, ['n', 'date', 'weekday', 'carbs', 'fat', 'protein', 'kcal', 'weight', 'run', 'abs', 'status']);
  });

  // ---- summary: averages over the exported range (incl. its last day) + the
  // user's targets. A blank spacer row keeps the autofilter off these rows. ----
  if (days.length) {
    const avgOf = (vals) => {
      const nums = vals.filter((v) => v != null);
      return nums.length ? round2(nums.reduce((s, v) => s + v, 0) / nums.length) : null;
    };
    const avgCarbs = avgOf(days.map((d) => dayTotal(d)));
    const avgKc = avgOf(days.map(dayKcal));
    const grams = days.map(dayMacroGrams);

    ws.addRow({});
    const avgRow = ws.addRow({
      weekday: 'ממוצע',
      carbs: avgCarbs,
      fat: avgOf(grams.map((g) => (g.fat ? g.fat : null))),
      protein: avgOf(grams.map((g) => (g.protein ? g.protein : null))),
      kcal: avgKc,
      weight: avgOf(days.map((d) => numOr(d.metrics?.weight))),
      status_note: `ממוצע ליום על פני ${days.length} הימים שיוצאו`,
    });
    const tgtRow = ws.addRow({
      weekday: 'יעד',
      carbs: target,
      kcal: kcalTarget || null,
      status_note: kcalTarget
        ? 'היעד היומי: פחמימות נטו וקק"ל'
        : 'היעד היומי: פחמימות נטו (לא הוגדר יעד קק"ל)',
    });

    [avgRow, tgtRow].forEach((row) => {
      row.eachCell({ includeEmpty: true }, (c) => {
        c.border = BORDER;
        c.font = { name: 'Arial', size: 10.5, bold: true, color: { argb: C.ink } };
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.zebra } };
      });
      row.getCell('status_note').font = { name: 'Arial', size: 9.5, italic: true, color: { argb: C.ink } };
      center(row, ['weekday', 'carbs', 'fat', 'protein', 'kcal', 'weight']);
    });
    // Grade the averages the same way as single days: carbs vs target, kcal vs
    // the kcal target — so the bottom line reads at a glance.
    if (avgCarbs != null) {
      const st = carbStatus(avgCarbs, target);
      avgRow.getCell('carbs').font = { name: 'Arial', size: 10.5, bold: true, color: { argb: st.font } };
      paint(avgRow.getCell('status'), st, true);
      avgRow.getCell('status').value = st.text;
      avgRow.getCell('status').alignment = { horizontal: 'center', vertical: 'middle' };
    }
    paint(avgRow.getCell('kcal'), kcalStatus(avgKc, kcalTarget), true);
  }
  return ws;
}

// ---- one row per meal ----
function mealsSheet(wb, days) {
  const ws = addSheet(wb, 'ארוחות', [
    { header: 'תאריך', key: 'date', width: 12 },
    { header: 'יום', key: 'weekday', width: 9 },
    { header: 'שעה', key: 'time', width: 8 },
    { header: 'קטגוריה', key: 'cat', width: 13 },
    { header: 'תיאור', key: 'desc', width: 52 },
    { header: "פחמ' נטו (ג')", key: 'carbs', width: 13 },
    { header: "שומן (ג')", key: 'fat', width: 11 },
    { header: "חלבון (ג')", key: 'protein', width: 11 },
    { header: 'קק"ל', key: 'kcal', width: 9 },
    { header: 'פריטים', key: 'items', width: 8 },
    { header: 'חושב לפי', key: 'source', width: 15 },
  ]);

  let i = 0;
  for (const d of days) {
    const meals = [...(d.meals || [])].sort((a, b) => (a.time || '').localeCompare(b.time || ''));
    for (const m of meals) {
      const row = ws.addRow({
        date: d.date,
        weekday: dayHebrewName(d.date),
        time: m.time || '',
        cat: m.cat || '',
        desc: m.desc || '',
        carbs: numOr(m.carbs) ?? 0,
        fat: numOr(m.fat),
        protein: numOr(m.protein),
        kcal: macroKcal(m),
        items: (m.items || []).length || null,
        source: SOURCE_HE[m.source] || '',
      });
      styleRow(row, i);
      row.getCell('desc').alignment = { wrapText: true, vertical: 'top' };
      center(row, ['date', 'weekday', 'time', 'carbs', 'fat', 'protein', 'kcal', 'items']);
      i += 1;
    }
  }
  return ws;
}

// ---- one row per meal item (the "product in the meal" breakdown) ----
function itemsSheet(wb, days) {
  const rows = [];
  for (const d of days) {
    const meals = [...(d.meals || [])].sort((a, b) => (a.time || '').localeCompare(b.time || ''));
    for (const m of meals) {
      for (const it of m.items || []) {
        const qty = Number(it.qty) > 0 ? Number(it.qty) : 1;
        rows.push({
          date: d.date,
          time: m.time || '',
          meal: m.desc || m.cat || '',
          name: it.name || '',
          qty,
          unit: it.unit || '',
          carbs1: numOr(it.carbs) ?? 0,
          carbs: round2((Number(it.carbs) || 0) * qty),
          fat: it.fat != null ? round2((Number(it.fat) || 0) * qty) : null,
          protein: it.protein != null ? round2((Number(it.protein) || 0) * qty) : null,
          kcal: macroKcal(it, qty),
        });
      }
    }
  }
  if (!rows.length) return null;

  const ws = addSheet(wb, 'פריטים', [
    { header: 'תאריך', key: 'date', width: 12 },
    { header: 'שעה', key: 'time', width: 8 },
    { header: 'ארוחה', key: 'meal', width: 34 },
    { header: 'פריט', key: 'name', width: 34 },
    { header: 'כמות', key: 'qty', width: 7 },
    { header: 'יחידה', key: 'unit', width: 10 },
    { header: "פחמ' ליחידה", key: 'carbs1', width: 12 },
    { header: "פחמ' סה\"כ (ג')", key: 'carbs', width: 14 },
    { header: "שומן (ג')", key: 'fat', width: 10 },
    { header: "חלבון (ג')", key: 'protein', width: 11 },
    { header: 'קק"ל', key: 'kcal', width: 9 },
  ]);
  rows.forEach((r, i) => {
    const row = ws.addRow(r);
    styleRow(row, i);
    row.getCell('meal').alignment = { wrapText: true, vertical: 'top' };
    row.getCell('name').alignment = { wrapText: true, vertical: 'top' };
    center(row, ['date', 'time', 'qty', 'unit', 'carbs1', 'carbs', 'fat', 'protein', 'kcal']);
  });
  return ws;
}

// Build the workbook and hand the browser a downloadable .xlsx. Diary only —
// days, meals and their items; no products, no insights. from/to are inclusive
// ISO dates; empty values fall back to the full log (including today).
export async function downloadExcel({ days, target, kcalTarget, from, to, generatedAt }) {
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date)); // chronological
  const lo = from || (sorted[0]?.date ?? generatedAt);
  const hi = to || generatedAt;
  const inRange = sorted.filter((d) => d.date >= lo && d.date <= hi);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'ketolog';
  wb.created = new Date();

  daysSheet(wb, inRange, target, kcalTarget);
  mealsSheet(wb, inRange);
  itemsSheet(wb, inRange);

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `ketolog-${lo}_${hi}.xlsx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
