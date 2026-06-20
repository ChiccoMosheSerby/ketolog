// Lightweight in-memory rate limiter — no external deps, which is fine for the
// single web instance this app runs as (Render free plan). Counters live in
// process memory: they reset on restart and are NOT shared across instances, so
// if you ever scale to more than one instance, swap this for a Redis-backed
// limiter (e.g. rate-limit-redis) to enforce the limit globally.
const buckets = new Map();

// Periodically drop expired buckets so memory can't grow unbounded under a flood
// of unique IPs. unref() so this timer never keeps the process alive on its own.
const sweep = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of buckets) {
    if (now >= entry.reset) buckets.delete(key);
  }
}, 60_000);
sweep.unref?.();

const DEFAULT_MSG = 'יותר מדי בקשות — נסה/י שוב בעוד רגע';

// Fixed-window limiter. Keyed by client IP (requires app.set('trust proxy', …)
// so req.ip is the real client behind Render's proxy, not the proxy itself).
export function rateLimit({ windowMs, max, name = 'rl', message = DEFAULT_MSG }) {
  return function rateLimiter(req, res, next) {
    const now = Date.now();
    const key = `${name}:${req.ip}`;
    let entry = buckets.get(key);
    if (!entry || now >= entry.reset) {
      entry = { count: 0, reset: now + windowMs };
      buckets.set(key, entry);
    }
    entry.count++;
    if (entry.count > max) {
      res.set('Retry-After', String(Math.ceil((entry.reset - now) / 1000)));
      return res.status(429).json({ error: message });
    }
    next();
  };
}
