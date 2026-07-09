import { createHash } from 'crypto';
import MealEstimate from '../models/MealEstimate.js';
import CatalogItem from '../models/CatalogItem.js';
import { estimateMeal } from './anthropic.js';
import { parseMeal, buildLookup, resolveFromLookups } from './mealResolver.js';
import { getSetting, RESOLVER_ENABLED } from './settings.js';

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

// Was this segment already covered by the user's own products? Mirrors the two
// product matches resolveFromLookups tries (post-quantity name, raw verbatim).
const coveredByProducts = (seg, lookup) =>
  (seg.nameKey && lookup.has(seg.nameKey)) || lookup.has(seg.rawKey);

// Stage 0 — the user's own saved products, above everything. Pure (no DB, no
// toggle): a product the user saved with values IS the answer for its own name,
// so a meal composed entirely of saved products never reaches the catalog, the
// cache, or the AI. Returns null unless EVERY segment matches a product.
function resolveFromProducts(desc, products = []) {
  if (!products.length) return null;
  const r = resolveFromLookups(desc, productsLookupOf(products), new Map());
  return r ? r.result : null;
}

// Stage 1 — DB-first resolution: serve the meal from the global learned catalog
// (+ the user's saved products, which still win per segment) with zero AI.
// Precision-first — parse first and bail before any DB read when a segment the
// products don't cover has vague amounts / unknown structure; then one batched
// query fetches every remaining item by canonical key OR any of its
// admin-curated rephrases. Returns null on ANY doubt → AI fallback.
async function resolveFromCatalog(desc, products = []) {
  const { segments } = parseMeal(desc);
  if (!segments.length || segments.some((s) => !s.nameKey)) return null;
  const productsLookup = productsLookupOf(products);
  const rest = segments.filter((s) => !coveredByProducts(s, productsLookup));
  if (rest.some((s) => s.ambiguous)) return null;
  // Fetch each segment's key AND the key minus its first word — the segment may
  // carry a unit prefix ("מנה דאבל אספרסו") while the catalog doc is keyed on
  // the bare name. This only widens the FETCH; serving still requires an exact
  // "<unit> <key>" match, which buildLookup derives from the doc's own unit.
  const keys = [
    ...new Set(
      rest.flatMap((s) => {
        const i = s.nameKey.indexOf(' ');
        return i > 0 ? [s.nameKey, s.nameKey.slice(i + 1)] : [s.nameKey];
      })
    ),
  ];
  const catalogEntries = keys.length
    ? await CatalogItem.find({
        $or: [{ key: { $in: keys } }, { aliases: { $in: keys } }],
      }).lean()
    : [];
  const r = resolveFromLookups(desc, productsLookup, buildLookup(catalogEntries));
  return r ? r.result : null;
}

// Estimate a meal description, most-trusted-then-cheapest source first:
//   0. the user's saved products — their own hand-confirmed values, above all;
//      always on (no admin toggle) and never overridden by catalog/cache/AI;
//   1. catalog resolver — instant, free, and always reflects the admin-curated
//      values/rephrases (which is why it outranks the cache: a curated fix
//      must win over a stale cached AI answer for the same text);
//   2. per-user cache of previous AI answers;
//   3. the AI estimator (cached for next time).
// The result carries `source: 'local' | 'catalog' | 'ai'` so meals can show
// where the numbers came from, and callers get `{ cached, source }` alongside.
export async function estimateMealCached(userId, desc, products = []) {
  let own = null;
  try {
    own = resolveFromProducts(desc, products);
  } catch (err) {
    // resolver trouble must never block logging — fall through to catalog/AI
    console.error('products resolve failed:', err.message);
  }
  if (own) return { result: { ...own, source: 'local' }, cached: false, source: 'local' };

  // Feature toggle (admin UI): OFF (default) = behave exactly as before the
  // catalog feature existed — no catalog lookup, straight to cache → AI.
  const resolverOn = await getSetting(RESOLVER_ENABLED, false).catch(() => false);
  const local = !resolverOn
    ? null
    : await resolveFromCatalog(desc, products).catch((err) => {
        console.error('catalog resolve failed:', err.message);
        return null;
      });
  if (local) return { result: { ...local, source: 'catalog' }, cached: false, source: 'catalog' };

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
