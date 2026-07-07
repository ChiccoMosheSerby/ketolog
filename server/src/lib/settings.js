import Setting from '../models/Setting.js';

// App-wide feature flags with a short in-memory cache, so hot paths (every meal
// estimate) don't pay a DB read per call but a UI toggle still takes effect
// within seconds on every server instance.
const TTL_MS = 15_000;
const cache = new Map(); // key -> { value, at }

// The catalog-resolver kill switch. OFF (the default) = the app estimates meals
// exactly as it did before the catalog feature existed (cache → AI only).
export const RESOLVER_ENABLED = 'resolverEnabled';

export async function getSetting(key, dflt = null) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const doc = await Setting.findOne({ key }).lean();
  const value = doc ? doc.value : dflt;
  cache.set(key, { value, at: Date.now() });
  return value;
}

export async function setSetting(key, value) {
  await Setting.updateOne({ key }, { $set: { value } }, { upsert: true });
  cache.set(key, { value, at: Date.now() });
  return value;
}
