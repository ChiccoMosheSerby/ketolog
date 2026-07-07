import CatalogItem from '../models/CatalogItem.js';
import Day from '../models/Day.js';
import Product from '../models/Product.js';

// Canonical dedup key for a food name: trim, collapse internal whitespace, and
// lowercase (a no-op for Hebrew, but folds latin/brand casing). Rephrasings and
// near-duplicates that survive this are merged later by the /optimize skill.
export function catalogKey(name) {
  return String(name || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

// A meal's day date ('YYYY-MM-DD') as a Date, anchored at midday UTC so it lands
// on the intended calendar day regardless of zone. Falls back to now.
function dayDate(dateStr) {
  const s = String(dateStr || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(s + 'T12:00:00Z');
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date();
}

// key -> a saved product's (non-empty) label, so catalog items can borrow the
// description the user gave a matching product. Global: any user's product with
// that normalized name contributes (first non-empty wins).
async function productLabelMap() {
  const prods = await Product.find({}, { key: 1, label: 1 }).lean();
  const map = new Map();
  for (const p of prods) {
    const k = catalogKey(p.key);
    const label = String(p.label || '').trim();
    if (k && label && !map.has(k)) map.set(k, label);
  }
  return map;
}

// LIVE path — called after a single meal is logged (any user). Upserts each item
// into the global catalog keyed on its normalized name: first capture seeds the
// per-unit macros + a description (matching product label, else the meal's own
// text when it's a single-item meal), every capture bumps usedCount by the item's
// qty and advances lastUsed to the meal's date. Fire-and-forget — never let a
// catalog write break logging.
export async function captureItemsToCatalog(items, mealDesc, date) {
  try {
    const arr = Array.isArray(items) ? items : [];
    if (!arr.length) return;
    const labelMap = await productLabelMap();
    // Only a single-item meal's text truly describes that one item; for a
    // multi-item meal the free text is the whole plate, so we don't stamp it.
    const fallback = arr.length === 1 ? String(mealDesc || '').trim() : '';
    const when = dayDate(date);

    const ops = [];
    for (const it of arr) {
      const name = String(it?.name || '').trim();
      const key = catalogKey(name);
      if (!key) continue;
      const qty = Number(it?.qty) > 0 ? Number(it.qty) : 1;
      const label = labelMap.get(key) || fallback;
      ops.push({
        updateOne: {
          filter: { key },
          update: {
            $setOnInsert: {
              key,
              name,
              label,
              unit: String(it?.unit || '').trim(),
              carbs: Number(it?.carbs) || 0,
              fat: it?.fat == null ? null : Number(it.fat),
              protein: it?.protein == null ? null : Number(it.protein),
            },
            $inc: { usedCount: qty },
            $max: { lastUsed: when },
          },
          upsert: true,
        },
      });
    }
    if (ops.length) await CatalogItem.bulkWrite(ops, { ordered: false });
  } catch (err) {
    // Catalog capture is best-effort; the meal is already saved.
    console.error('catalog capture failed:', err.message);
  }
}

// BACKFILL / RE-SYNC path — rebuilds the whole catalog from every user's stored
// meals in one pass and writes ABSOLUTE usedCount / lastUsed / label values.
// Idempotent by design: re-running always converges to the app-wide truth
// (unlike the live $inc path), so it's safe to run any time to reconcile.
// Only meals that already carry an items[] breakdown contribute.
// Returns a summary for the CLI.
export async function recomputeCatalog() {
  // key -> { key, name, unit, carbs, fat, protein, usedCount, lastUsed(ms), descFallback }
  const acc = new Map();
  let daysScanned = 0;
  let itemsProcessed = 0;

  const cursor = Day.find({}, { date: 1, meals: 1 }).lean().cursor();
  for await (const day of cursor) {
    daysScanned++;
    const whenMs = dayDate(day.date).getTime();
    for (const meal of day.meals || []) {
      const mealItems = meal.items || [];
      const fallback = mealItems.length === 1 ? String(meal.desc || '').trim() : '';
      for (const it of mealItems) {
        const name = String(it?.name || '').trim();
        const key = catalogKey(name);
        if (!key) continue;
        itemsProcessed++;
        const qty = Number(it?.qty) > 0 ? Number(it.qty) : 1;
        const cur = acc.get(key);
        if (cur) {
          cur.usedCount += qty;
          if (whenMs > cur.lastUsed) cur.lastUsed = whenMs;
          // keep the first single-item-meal text we saw as a fallback description
          if (!cur.descFallback && fallback) cur.descFallback = fallback;
        } else {
          // first occurrence seeds the per-unit values (first capture wins)
          acc.set(key, {
            key,
            name,
            unit: String(it?.unit || '').trim(),
            carbs: Number(it?.carbs) || 0,
            fat: it?.fat == null ? null : Number(it.fat),
            protein: it?.protein == null ? null : Number(it.protein),
            usedCount: qty,
            lastUsed: whenMs,
            descFallback: fallback,
          });
        }
      }
    }
  }

  const labelMap = await productLabelMap();
  const ops = [...acc.values()].map((v) => ({
    updateOne: {
      filter: { key: v.key },
      // $set the derived fields absolutely (re-sync); $setOnInsert only the
      // per-unit macros so an existing entry keeps its seeded values.
      update: {
        $set: {
          usedCount: v.usedCount,
          lastUsed: new Date(v.lastUsed),
          label: labelMap.get(v.key) || v.descFallback || '',
        },
        $setOnInsert: {
          key: v.key,
          name: v.name,
          unit: v.unit,
          carbs: v.carbs,
          fat: v.fat,
          protein: v.protein,
        },
      },
      upsert: true,
    },
  }));
  if (ops.length) await CatalogItem.bulkWrite(ops, { ordered: false });

  return { daysScanned, itemsProcessed, distinctKeys: acc.size };
}
