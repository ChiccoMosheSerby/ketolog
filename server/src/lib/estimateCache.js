import { createHash } from 'crypto';
import MealEstimate from '../models/MealEstimate.js';
import { estimateMeal } from './anthropic.js';
import { buildLookup, resolveFromProducts } from './mealResolver.js';

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

// The user's saved products as resolver entries (products carry no aliases).
function productsLookupOf(products = []) {
  return buildLookup(
    products.map((p) => ({
      key: p.key,
      name: p.key,
      unit: p.unit,
      carbs: p.carbs,
      fat: p.fat,
      protein: p.protein,
    }))
  );
}

// Estimate a meal description, most-trusted-then-cheapest source first:
//   0. the user's saved products — their own hand-confirmed values, above all;
//      never overridden by cache/AI, and free (no AI call);
//   1. per-user cache of previous AI answers;
//   2. the AI estimator (cached for next time).
// The result carries `source: 'local' | 'ai'` so meals can show where the
// numbers came from, and callers get `{ cached, source }` alongside.
export async function estimateMealCached(userId, desc, products = []) {
  let own = null;
  try {
    if (products.length) own = resolveFromProducts(desc, productsLookupOf(products));
  } catch (err) {
    // resolver trouble must never block logging — fall through to cache/AI
    console.error('products resolve failed:', err.message);
  }
  if (own) return { result: { ...own, source: 'local' }, cached: false, source: 'local' };

  const key = normKey(desc);
  const fp = productsFingerprint(products);

  const hit = await MealEstimate.findOne({ user: userId, key, fp }).lean();
  if (hit) return { result: { ...hit.result, source: 'ai' }, cached: true, source: 'ai' };

  const result = await estimateMeal(desc, products, { userId });

  // upsert so two concurrent identical requests don't create duplicates (the
  // unique index would otherwise reject the second insert).
  await MealEstimate.updateOne(
    { user: userId, key, fp },
    { $set: { result, desc: desc.trim() } },
    { upsert: true }
  );

  return { result: { ...result, source: 'ai' }, cached: false, source: 'ai' };
}
