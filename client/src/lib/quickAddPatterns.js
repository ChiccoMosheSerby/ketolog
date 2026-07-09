// Hour-aware suggestion engine for the Quick-Add POC. Every logged quick-meal
// records (productId, hour) events locally; suggestions score each product by
// how often it was logged around the current hour, with newer events counting
// more. Stored per user in localStorage — good enough for the POC; later this
// moves server-side so patterns follow the account across devices.

const KEY_PREFIX = 'ketolog:quickAddPatterns:';
const MAX_EVENTS = 600;
const HALF_LIFE_DAYS = 30;

const storeKey = (email) => KEY_PREFIX + (email || 'anon');

function readEvents(email) {
  try {
    const raw = localStorage.getItem(storeKey(email));
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

// Record one logged meal: an event per selected product (qty doesn't multiply
// the signal — logging shakshuka once shouldn't out-vote three coffees).
export function recordSelection(email, productIds, when = new Date()) {
  const events = readEvents(email);
  const ts = when.getTime();
  const hour = when.getHours();
  for (const id of productIds) events.push({ id, hour, ts });
  try {
    localStorage.setItem(storeKey(email), JSON.stringify(events.slice(-MAX_EVENTS)));
  } catch {
    /* storage full/blocked — suggestions just stay colder */
  }
}

// Circular hour distance: 23:00 and 01:00 are 2 hours apart, not 22.
const hourDist = (a, b) => Math.min(Math.abs(a - b), 24 - Math.abs(a - b));

// Weight by closeness to the current hour: same hour counts full, fading to
// zero beyond ±3h, so breakfast habits don't leak into dinner suggestions.
const hourWeight = (d) => (d <= 3 ? (4 - d) / 4 : 0);

// Ranked product ids for the given moment. Learned patterns first; while the
// user has little history near this hour, daypart defaults fill the tail.
export function suggestIds(email, { now = new Date(), limit = 4, defaults = [] } = {}) {
  const nowTs = now.getTime();
  const hour = now.getHours();
  const scores = new Map();
  for (const ev of readEvents(email)) {
    const w = hourWeight(hourDist(hour, ev.hour));
    if (!w) continue;
    const ageDays = Math.max(0, (nowTs - ev.ts) / 86400000);
    const decay = Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
    scores.set(ev.id, (scores.get(ev.id) || 0) + w * decay);
  }
  const learned = [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id);
  const merged = [...learned];
  for (const id of defaults) {
    if (merged.length >= limit) break;
    if (!merged.includes(id)) merged.push(id);
  }
  return { ids: merged.slice(0, limit), learnedCount: learned.length };
}
