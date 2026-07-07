import mongoose from 'mongoose';

// The durable record of catalog merges — the SOURCE OF TRUTH for "phrase X is a
// rephrasing of item Y". One document per folded-away phrasing (aliasKey).
//
// Why a separate collection: recomputeCatalog rebuilds CatalogItem from scratch
// out of every stored meal, and captureItemsToCatalog upserts by raw key — a
// merge kept only on CatalogItem rows would be silently undone by the next
// backfill or the next log of the alias phrasing. Both write paths therefore
// remap alias keys through the APPLIED rows of this collection before writing;
// CatalogItem.aliases is just a rebuildable cache of it.
//
// Lifecycle: an optimize scan proposes merges as `pending` (it NEVER applies
// them itself); the admin approves (→ `applied`) or rejects (→ `rejected`) each
// one in the admin screen, or creates merges directly (`source: 'admin'`,
// applied immediately). Decided rows also feed the next scan's few-shot
// examples — approved/admin merges as positives, rejected as negatives.
const catalogMergeSchema = new mongoose.Schema(
  {
    // the normalized phrasing being folded away — unique, so re-proposing an
    // already-decided (or already-pending) phrase is an idempotent no-op
    aliasKey: { type: String, required: true, unique: true },
    // the normalized key of the main item it folds into. Never itself an
    // applied aliasKey — apply resolves chains to the ultimate canonical.
    canonicalKey: { type: String, required: true },
    // model confidence (0-1) for scan proposals; 1 for admin-created merges
    confidence: { type: Number, default: 1 },
    // short "why these are the same food" (model's reason, or 'admin')
    reason: { type: String, default: '' },
    // optional per-unit macro correction proposed for the canonical entry;
    // applied only when the admin approves the merge carrying it
    macroFix: { type: Object, default: null },
    // optimize-prompt version that proposed it (0 for admin-created)
    promptVersion: { type: Number, default: 0 },
    status: { type: String, enum: ['pending', 'applied', 'rejected'], default: 'pending' },
    source: { type: String, enum: ['auto', 'admin'], default: 'auto' },
  },
  { timestamps: true, minimize: false }
);

catalogMergeSchema.index({ status: 1, confidence: -1 });

export default mongoose.model('CatalogMerge', catalogMergeSchema);
