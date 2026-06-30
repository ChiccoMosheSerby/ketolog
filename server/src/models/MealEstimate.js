import mongoose from 'mongoose';

// Cache of AI meal-estimate results so an identical meal description isn't sent
// to Claude twice. Keyed per user by the normalized description plus a
// fingerprint of the user's saved products — those products are fed into the
// estimator as context, so when the user edits/adds a product the fingerprint
// changes and the next estimate is recomputed (and re-cached) instead of
// returning a now-stale number.
const mealEstimateSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    key: { type: String, required: true }, // normalized description (lookup key)
    fp: { type: String, required: true }, // products-context fingerprint
    desc: { type: String, default: '' }, // original description, for reference
    result: { type: Object, required: true }, // { net_carbs, fat, protein, items[] }
  },
  { timestamps: true, minimize: false }
);

// One cached result per (user, description, products-context).
mealEstimateSchema.index({ user: 1, key: 1, fp: 1 }, { unique: true });

export default mongoose.model('MealEstimate', mealEstimateSchema);
