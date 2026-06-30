import { createHash } from 'crypto';
import MealEstimate from '../models/MealEstimate.js';
import { estimateMeal } from './anthropic.js';

// Normalize a meal description into a stable lookup key: trim, collapse runs of
// whitespace, lowercase. So "2 Eggs " and "2  eggs" hit the same cache entry,
// while genuinely different descriptions stay distinct.
function normKey(desc) {
  return String(desc || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

// Fingerprint the user's saved products — only the fields that actually feed
// into the estimator's prompt. Sorted by key so order doesn't matter; hashed so
// the value stays short regardless of how many products the user has. Any
// add/edit/delete that changes a relevant field flips the fingerprint, which
// busts the cache for that user and forces a fresh estimate.
function productsFingerprint(products = []) {
  const norm = products
    .map((p) => `${p.key}|${p.label}|${p.unit}|${p.carbs}|${p.fat}|${p.protein}`)
    .sort()
    .join('\n');
  return createHash('sha1').update(norm).digest('hex');
}

// Return a cached meal estimate when one exists for this (user, description,
// products-context); otherwise call the AI estimator, cache the result, and
// return it. The `cached` flag lets callers see whether AI was hit.
export async function estimateMealCached(userId, desc, products = []) {
  const key = normKey(desc);
  const fp = productsFingerprint(products);

  const hit = await MealEstimate.findOne({ user: userId, key, fp }).lean();
  if (hit) return { result: hit.result, cached: true };

  const result = await estimateMeal(desc, products);

  // upsert so two concurrent identical requests don't create duplicates (the
  // unique index would otherwise reject the second insert).
  await MealEstimate.updateOne(
    { user: userId, key, fp },
    { $set: { result, desc: desc.trim() } },
    { upsert: true }
  );

  return { result, cached: false };
}
