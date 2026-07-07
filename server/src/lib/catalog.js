import CatalogItem from '../models/CatalogItem.js';
import Day from '../models/Day.js';

// Canonical dedup key for a food name: trim, collapse internal whitespace, and
// lowercase (a no-op for Hebrew, but folds latin/brand casing). Rephrasings and
// near-duplicates that survive this are merged later by the /optimize skill.
export function catalogKey(name) {
  return String(name || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

// LIVE path — called after a single meal is logged (any user). Upserts each item
// into the global catalog keyed on its normalized name: first capture seeds the
// per-unit macros, every capture bumps usedCount by the item's qty (eating 3×
// counts as 3 uses). Fire-and-forget — never let a catalog write break logging.
export async function captureItemsToCatalog(items) {
  try {
    const ops = [];
    for (const it of Array.isArray(items) ? items : []) {
      const name = String(it?.name || '').trim();
      const key = catalogKey(name);
      if (!key) continue;
      const qty = Number(it?.qty) > 0 ? Number(it.qty) : 1;
      ops.push({
        updateOne: {
          filter: { key },
          update: {
            $setOnInsert: {
              key,
              name,
              unit: String(it?.unit || '').trim(),
              carbs: Number(it?.carbs) || 0,
              fat: it?.fat == null ? null : Number(it.fat),
              protein: it?.protein == null ? null : Number(it.protein),
            },
            $inc: { usedCount: qty },
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
// meals in one pass and writes ABSOLUTE usedCount values. Idempotent by design:
// re-running always converges to the app-wide truth (unlike the live $inc path),
// so it's safe to run any time to reconcile counts. Only meals that already carry
// an items[] breakdown contribute; meals with no breakdown are skipped.
// Returns a summary for the CLI.
export async function recomputeCatalog() {
  const acc = new Map(); // key -> { key, name, unit, carbs, fat, protein, usedCount }
  let daysScanned = 0;
  let itemsProcessed = 0;

  const cursor = Day.find({}, { meals: 1 }).lean().cursor();
  for await (const day of cursor) {
    daysScanned++;
    for (const meal of day.meals || []) {
      for (const it of meal.items || []) {
        const name = String(it?.name || '').trim();
        const key = catalogKey(name);
        if (!key) continue;
        itemsProcessed++;
        const qty = Number(it?.qty) > 0 ? Number(it.qty) : 1;
        const cur = acc.get(key);
        if (cur) {
          cur.usedCount += qty;
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
          });
        }
      }
    }
  }

  const ops = [...acc.values()].map((v) => ({
    updateOne: {
      filter: { key: v.key },
      // $set the count absolutely (re-sync), $setOnInsert the values so an
      // existing entry keeps its already-seeded per-unit macros.
      update: {
        $set: { usedCount: v.usedCount },
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
