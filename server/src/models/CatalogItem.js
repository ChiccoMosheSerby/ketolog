import mongoose from 'mongoose';

// A GLOBAL, app-wide catalog of individual food items learned from every user's
// logged meals. Unlike the per-user `Product` list (the curated 📦 shortcuts),
// this collection has no `user` field — the same normalized `key` maps to one
// shared entry no matter who logged it. Macros are stored PER ONE unit (mirroring
// a meal's `items[]`), so a "2-egg omelet" reduces to the single-egg base via a
// meal item's qty rather than becoming a second entry.
//
// The point is to serve future logging from the DB instead of the AI estimator,
// and to accumulate a `usedCount` popularity score per phrasing so a later
// /optimize pass can merge rephrased duplicates by keeping the higher-count name.
const catalogItemSchema = new mongoose.Schema(
  {
    // canonical dedup key (normalized name) — one entry per food, app-wide
    key: { type: String, required: true, unique: true },
    name: { type: String, default: '' }, // display name (trimmed original)
    // description / details: a matching saved Product's label when one exists,
    // otherwise the free text of a single-item meal it came from. May be empty.
    label: { type: String, default: '' },
    unit: { type: String, default: '' },
    carbs: { type: Number, default: 0 }, // net carbs per single unit
    fat: { type: Number, default: null }, // per single unit
    protein: { type: Number, default: null }, // per single unit
    // Times this item has been logged app-wide (weighted by qty). Usage score
    // that both orders serving suggestions and drives the /optimize merge logic.
    usedCount: { type: Number, default: 0 },
    // Date of the most recent meal (by the meal's own day, not the row's write
    // time) that logged this item — so a stale product is visibly stale even
    // right after a backfill. Drives the "still useful vs old" read.
    lastUsed: { type: Date, default: null },
    // Normalized rephrasings folded under this item (a match on any of them
    // selects this entry). Denormalized cache of the applied CatalogMerge rows —
    // the merge collection is the durable truth; this array is rebuilt from it
    // by recomputeCatalog so a backfill can never lose a merge.
    aliases: { type: [String], default: [] },
    // True once an admin has vouched for the entry — either by creating it
    // manually (with hand-calculated macros) or by approving a merge onto it.
    // recomputeCatalog preserves the label/name of verified entries.
    verified: { type: Boolean, default: false },
    // Short note from an optimize scan (e.g. a flagged macro concern). Cleared
    // by the admin once handled.
    reviewNote: { type: String, default: '' },
    // The optimize-prompt version that last examined this row. Rows below the
    // current OPTIMIZE_PROMPT_VERSION are eligible for the next scan.
    optimizeVersion: { type: Number, default: 0 },
  },
  { timestamps: true } // createdAt = first seen, updatedAt = last used
);

// The resolver looks items up by canonical key OR any alias in one query.
catalogItemSchema.index({ aliases: 1 });

export default mongoose.model('CatalogItem', catalogItemSchema);
