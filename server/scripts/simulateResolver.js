// Stage-0 measurement for the DB-first meal resolver — READ-ONLY, ZERO AI COST.
//
// Answers "how much would the catalog-resolver actually cut AI usage?" against
// the real data, before building anything user-facing:
//
//   1. Spend share  — what part of the AI bill is estimate_meal at all (the
//      savings ceiling; chat/insights/image/barcode are untouched by the plan).
//   2. Replay       — walk every stored meal in chronological order, build the
//      would-be catalog only from EARLIER meals (exactly like the live capture
//      path), and check whether the resolver could have served each meal's
//      description without AI.
//   3. Alias headroom — how many of the misses would flip to hits if
//      near-identical phrasings were aliased (what manual rephrasing + the
//      optimizer add), plus the top unresolved phrasings — the manual-alias
//      shopping list.
//
// Usage (from the server/ directory):
//   node scripts/simulateResolver.js
import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDB } from '../src/db.js';
import Day from '../src/models/Day.js';
import Product from '../src/models/Product.js';
import MealEstimate from '../src/models/MealEstimate.js';
import Usage from '../src/models/Usage.js';
import { catalogKey } from '../src/lib/catalog.js';
import { parseMeal, resolveFromLookup } from '../src/lib/mealResolver.js';

const pct = (a, b) => (b ? ((100 * a) / b).toFixed(1) + '%' : '—');
const usd = (n) => '$' + (Number(n) || 0).toFixed(2);

// ---- 1. spend share ---------------------------------------------------------

async function spendByKind() {
  const cutoff = new Date(Date.now() - 30 * 864e5);
  const rows = await Usage.aggregate([
    {
      $group: {
        _id: '$kind',
        cost: { $sum: '$costUsd' },
        calls: { $sum: 1 },
        cost30: { $sum: { $cond: [{ $gte: ['$createdAt', cutoff] }, '$costUsd', 0] } },
        calls30: { $sum: { $cond: [{ $gte: ['$createdAt', cutoff] }, 1, 0] } },
      },
    },
    { $sort: { cost: -1 } },
  ]);
  return rows;
}

// ---- 3. alias headroom helpers ----------------------------------------------

// Levenshtein distance with an early exit above `max` — enough to catch typo /
// spelling / singular-plural variants without a dependency.
function lev(a, b, max = 1) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

// Would this failed key plausibly be an alias of an existing catalog key?
// (small edit distance, or whole-token containment — "ביצה" ⊂ "ביצה קשה")
function nearMatch(key, catalogKeys) {
  const tokens = key.split(' ');
  for (const k of catalogKeys) {
    if (lev(key, k, 1) <= 1) return k;
    const kt = k.split(' ');
    const [small, big] = tokens.length <= kt.length ? [tokens, kt] : [kt, tokens];
    if (small.length && small.every((t) => big.includes(t))) return k;
  }
  return null;
}

// ---- 2. the replay ------------------------------------------------------------

async function main() {
  await connectDB(process.env.MONGODB_URI);

  // spend share first — the ceiling
  const kinds = await spendByKind();
  const total = kinds.reduce((s, r) => s + r.cost, 0);
  const total30 = kinds.reduce((s, r) => s + r.cost30, 0);
  const est = kinds.find((r) => r._id === 'estimate_meal') || { cost: 0, calls: 0, cost30: 0, calls30: 0 };

  console.log('\n═══ 1. Where the AI money goes (Usage collection) ═══');
  for (const r of kinds) {
    console.log(
      `  ${r._id.padEnd(16)} all-time ${usd(r.cost).padStart(8)} (${String(r.calls).padStart(4)} calls)` +
        `   last-30d ${usd(r.cost30).padStart(7)} (${r.calls30} calls)`
    );
  }
  console.log(
    `  → estimate_meal is ${pct(est.cost, total)} of all-time spend, ${pct(est.cost30, total30)} of the last 30 days.` +
      ` Avg ${usd(est.calls ? est.cost / est.calls : 0)}/call. This is the savings CEILING.`
  );

  // meals that definitely went through the AI estimator (they're in the cache)
  const aiEstimated = new Set();
  for await (const e of MealEstimate.find({}, { user: 1, key: 1 }).lean().cursor()) {
    aiEstimated.add(`${e.user}:${e.key}`);
  }

  // per-user saved products (current snapshot — best available approximation)
  const userProducts = new Map();
  for (const p of await Product.find({}).lean()) {
    const uid = String(p.user);
    if (!userProducts.has(uid)) userProducts.set(uid, new Map());
    const key = catalogKey(p.key);
    if (key && !userProducts.get(uid).has(key)) userProducts.get(uid).set(key, p);
  }

  // replay state
  const globalCatalog = new Map(); // key -> first-capture entry (like recomputeCatalog)
  const seenDesc = new Set(); // `${user}:${normalized desc}` -> exact-repeat (cache hit today)

  const stats = {
    meals: 0, // meals with a description
    repeats: 0, // free today via the per-user estimate cache
    hits: 0, // NEW: resolver would serve locally
    hitsProductsOnly: 0, // subset of hits where every part is a saved product (some already free via chips)
    misses: 0, // still needs AI
    missAmbiguous: 0, // ...because of vague amounts / size words / grams
    missUnknown: 0, // ...because a food name isn't in the catalog (yet)
    aliasRecoverable: 0, // misses that flip to hits if near-phrasings were aliased
    aiHits: 0, // hits among meals that PROVABLY hit the AI (in MealEstimate)
    aiMisses: 0, // misses among that same population
  };
  const unresolved = new Map(); // nameKey -> count (the manual-alias shopping list)

  const cursor = Day.find({}, { user: 1, date: 1, meals: 1 }).sort({ date: 1 }).lean().cursor();
  for await (const day of cursor) {
    const uid = String(day.user);
    const products = userProducts.get(uid);
    // products take precedence over the global catalog, like the AI prompt does
    const lookup = { get: (k) => products?.get(k) || globalCatalog.get(k) };

    for (const meal of day.meals || []) {
      const desc = String(meal.desc || '').trim();
      const capture = () => {
        for (const it of meal.items || []) {
          const key = catalogKey(it?.name);
          if (key && !globalCatalog.has(key)) globalCatalog.set(key, it);
        }
      };
      if (!desc) {
        capture();
        continue;
      }

      stats.meals++;
      const normed = catalogKey(desc);
      const seenKey = `${uid}:${normed}`;
      const wasAI = aiEstimated.has(seenKey);

      if (seenDesc.has(seenKey)) {
        stats.repeats++;
      } else {
        seenDesc.add(seenKey);
        const resolved = resolveFromLookup(desc, lookup);
        if (resolved) {
          stats.hits++;
          if (wasAI) stats.aiHits++;
          if (products && resolved.items.every((it) => products.has(catalogKey(it.name)))) {
            stats.hitsProductsOnly++;
          }
        } else {
          stats.misses++;
          if (wasAI) stats.aiMisses++;
          const { segments, ok } = parseMeal(desc);
          if (!ok && segments.some((s) => s.ambiguous)) {
            stats.missAmbiguous++;
          } else {
            stats.missUnknown++;
            // which names failed, and could aliases have saved the meal?
            const keys = [...globalCatalog.keys()];
            let allRecoverable = segments.length > 0;
            for (const seg of segments) {
              if (seg.ambiguous || !seg.nameKey) {
                allRecoverable = false;
                continue;
              }
              if (!lookup.get(seg.nameKey)) {
                unresolved.set(seg.nameKey, (unresolved.get(seg.nameKey) || 0) + 1);
                if (!nearMatch(seg.nameKey, keys)) allRecoverable = false;
              }
            }
            if (allRecoverable) stats.aliasRecoverable++;
          }
        }
      }
      capture(); // items feed the catalog only AFTER this meal is classified
    }
  }

  const firstTimers = stats.hits + stats.misses;
  console.log('\n═══ 2. Replay: could the resolver have served each meal? ═══');
  console.log(`  meals with a description        ${stats.meals}`);
  console.log(`  exact repeats (free today)      ${stats.repeats}  (${pct(stats.repeats, stats.meals)})`);
  console.log(`  first-time descriptions         ${firstTimers}`);
  console.log(`    ✓ resolver hit (NEW saving)   ${stats.hits}  (${pct(stats.hits, firstTimers)})`);
  console.log(`        of which products-only    ${stats.hitsProductsOnly}  (some already free via chip taps)`);
  console.log(`    ✗ still needs AI              ${stats.misses}  (${pct(stats.misses, firstTimers)})`);
  console.log(`        vague amount / size words ${stats.missAmbiguous}`);
  console.log(`        unknown food name         ${stats.missUnknown}`);

  const aiPop = stats.aiHits + stats.aiMisses;
  console.log('\n  Restricted to meals that PROVABLY called the AI (found in the estimate cache):');
  console.log(`    resolver would have handled   ${stats.aiHits} of ${aiPop}  (${pct(stats.aiHits, aiPop)})`);

  console.log('\n═══ 3. Alias headroom (what manual rephrasing + optimizer add) ═══');
  console.log(
    `  misses that flip to hits with aliases: ${stats.aliasRecoverable}` +
      `  → potential hit rate ${pct(stats.hits + stats.aliasRecoverable, firstTimers)}`
  );
  const top = [...unresolved.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
  if (top.length) {
    console.log('  Top unresolved phrasings (your manual-alias shopping list):');
    for (const [k, n] of top) console.log(`    ${String(n).padStart(4)}×  ${k}`);
  }

  // projected savings: hit-rate over the provably-AI population × estimate_meal spend
  const rate = aiPop ? stats.aiHits / aiPop : 0;
  const rateAliased = aiPop ? Math.min(1, (stats.aiHits + stats.aliasRecoverable) / aiPop) : 0;
  console.log('\n═══ Bottom line ═══');
  console.log(
    `  estimate_meal last-30d spend: ${usd(est.cost30)} — projected saving` +
      ` ${usd(est.cost30 * rate)}/mo now, up to ${usd(est.cost30 * rateAliased)}/mo with aliases.`
  );
  console.log(
    `  Overall AI bill (last 30d ${usd(total30)}): cut of ${pct(est.cost30 * rate, total30)} now,` +
      ` up to ${pct(est.cost30 * rateAliased, total30)} with aliases.`
  );
  console.log(
    '  (Assumptions: current products stand in for historical ones; repeats counted as free' +
      ' even when a product edit would have busted the cache — both make the NEW-saving figure conservative.)\n'
  );

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('✗ Simulation failed:', err);
  process.exit(1);
});
