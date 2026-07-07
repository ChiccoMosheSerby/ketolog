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
    unit: { type: String, default: '' },
    carbs: { type: Number, default: 0 }, // net carbs per single unit
    fat: { type: Number, default: null }, // per single unit
    protein: { type: Number, default: null }, // per single unit
    // Times this item has been logged app-wide (weighted by qty). Usage score
    // that both orders serving suggestions and drives the /optimize merge logic.
    usedCount: { type: Number, default: 0 },
  },
  { timestamps: true } // createdAt = first seen, updatedAt = last used
);

export default mongoose.model('CatalogItem', catalogItemSchema);
