// Local (no-AI) meal resolution: parse a free-text Hebrew meal description into
// (qty, food-name) segments and match them against known per-unit macro entries
// (the global learned catalog + the user's saved products).
//
// PRECISION OVER RECALL — the one safety rule. A result is served only when the
// ENTIRE description is accounted for: every segment parses cleanly and matches
// a known entry exactly (by normalized key or alias). Any doubt — an unknown
// word, a vague amount ("קצת"), a size word ("גדול"), grams — returns null and
// the caller falls back to the AI estimator. A wrong local number would silently
// corrupt the log; an unnecessary AI call just costs a cent.
//
// Everything here is pure (no DB, no network) so it can be unit-tested and
// replayed offline (scripts/simulateResolver.js). The DB-facing wrapper that
// loads CatalogItem/Product entries lives with the estimate path.
import { catalogKey } from './catalog.js';

// ---- Hebrew quantity vocabulary --------------------------------------------
// Fraction words scale one whole unit linearly — the same semantics ketoRules
// dictates to the AI ("חצי" = half the base value, never more than a whole).
const FRACTION_WORDS = new Map([
  ['חצי', 0.5],
  ['רבע', 0.25],
  ['שליש', 1 / 3],
  ['שלם', 1],
  ['שלמה', 1],
]);

// Unambiguous Hebrew count words. Anything beyond these (e.g. "תריסר") is rare
// enough to leave to the AI.
const COUNT_WORDS = new Map([
  ['אחד', 1],
  ['אחת', 1],
  ['שני', 2],
  ['שתי', 2],
  ['שניים', 2],
  ['שתיים', 2],
  ['שלוש', 3],
  ['שלושה', 3],
  ['ארבע', 4],
  ['ארבעה', 4],
  ['חמש', 5],
  ['חמישה', 5],
  ['שש', 6],
  ['שישה', 6],
]);

// Words that make the amount (or the whole segment) unquantifiable from text
// alone. The catalog stores one fixed per-unit value with no small/large
// calibration, so size words can't be scaled honestly — they go to the AI,
// which is instructed to scale relative to a medium portion.
const AMBIGUOUS_WORDS = new Set([
  // vague amounts
  'קצת', 'מעט', 'הרבה', 'כמה', 'חופן', 'בערך', 'חתיכת', 'חתיכה', 'טיפה',
  // size modifiers (relative to an uncalibrated "medium")
  'גדול', 'גדולה', 'גדולים', 'גדולות', 'קטן', 'קטנה', 'קטנים', 'קטנות', 'ענק', 'ענקית',
  // weight/volume units — per-gram serving needs the AI (catalog is per-piece)
  'גרם', "גר'", 'גר', 'ג', 'קילו', 'ק"ג', 'מ"ל', 'מל', 'ליטר',
]);

// Leading connectives that survive segment splitting ("ביצה, ועוד קפה").
const LEADING_CONNECTIVES = new Set(['עם', 'וגם', 'ועוד']);

const round2 = (n) => Math.round(n * 100) / 100;

// ---- parsing ----------------------------------------------------------------

// Split a description into candidate item segments: newlines, commas, '+',
// middots, and the standalone conjunction " ו ". A prefix-vav ("וקפה") does NOT
// split — that segment will simply fail to match and the meal goes to the AI
// (precision-first; over-splitting could cut real food names in half).
export function splitSegments(desc) {
  return String(desc || '')
    .split(/[\n,+·;]|(?:\s+ו\s+)/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// Parse one segment into { qty, name, nameKey, rawKey, ambiguous }. qty
// defaults to 1. Recognized as a quantity: ONE leading number / count word /
// fraction word, plus an optional trailing "וחצי" ("ביצה וחצי" = 1.5). Any
// ambiguous word, a second independent quantity, or an empty name marks the
// segment ambiguous. rawKey is the untouched segment text as a lookup key —
// the products tier also matches it verbatim, so a saved product whose name
// starts with a number ("300 גרם סינטה") isn't mis-read as qty=300.
export function parseSegment(raw) {
  // Detach digit runs stuck to letters ("2ביצים" -> "2 ביצים") before tokenizing.
  // A hyphen keeps its digit attached: "חביתה מ-2 ביצים" must stay one name whose
  // key equals the catalog key, not become "מ- 2".
  const spaced = String(raw || '').replace(/(\d)(?=[^\d\s.,%])/g, '$1 ').replace(/([^\d\s.,-])(?=\d)/g, '$1 ');
  let tokens = spaced.trim().split(/\s+/).filter(Boolean);
  const rawKey = catalogKey(raw);

  while (tokens.length && LEADING_CONNECTIVES.has(tokens[0])) tokens = tokens.slice(1);
  if (!tokens.length) return { qty: 1, name: '', nameKey: '', rawKey, ambiguous: true };

  let qty = null;
  let ambiguous = false;

  // two-word fractions first ("שלוש רבעים אבוקדו" = ¾), so the count word
  // "שלוש" doesn't swallow the phrase as qty=3
  if (tokens.length >= 2 && FRACTION_WORDS.has(tokens[0] + ' ' + tokens[1])) {
    qty = FRACTION_WORDS.get(tokens[0] + ' ' + tokens[1]);
    tokens = tokens.slice(2);
  }

  // one leading quantity token
  const t0 = tokens[0] || '';
  const num = qty == null && /^\d+(?:[.,]\d+)?$/.test(t0) ? Number(t0.replace(',', '.')) : null;
  if (num != null && Number.isFinite(num) && num > 0) {
    qty = num;
    tokens = tokens.slice(1);
  } else if (qty == null && COUNT_WORDS.has(t0)) {
    qty = COUNT_WORDS.get(t0);
    tokens = tokens.slice(1);
  } else if (qty == null && FRACTION_WORDS.has(t0)) {
    qty = FRACTION_WORDS.get(t0);
    tokens = tokens.slice(1);
  }

  // optional trailing "וחצי" adds half a unit ("ביצה וחצי", "2 וחצי ביצים" is
  // NOT supported — the fraction must close the segment)
  if (tokens.length && tokens[tokens.length - 1] === 'וחצי') {
    qty = (qty == null ? 1 : qty) + 0.5;
    tokens = tokens.slice(0, -1);
  }

  // any remaining quantity-ish or vague token inside the name → ambiguous
  for (const t of tokens) {
    if (AMBIGUOUS_WORDS.has(t) || FRACTION_WORDS.has(t) || COUNT_WORDS.has(t)) ambiguous = true;
  }

  const name = tokens.join(' ');
  if (!name) ambiguous = true;

  return { qty: qty == null ? 1 : qty, name, nameKey: catalogKey(name), rawKey, ambiguous };
}

// Parse a whole description. `ok` is false when there is nothing to match or
// any segment is ambiguous — callers can short-circuit to the AI without a
// catalog lookup.
export function parseMeal(desc) {
  const segments = splitSegments(desc).map(parseSegment);
  const ok = segments.length > 0 && segments.every((s) => !s.ambiguous && s.nameKey);
  return { segments, ok };
}

// ---- matching / assembly ------------------------------------------------------

// Naive plural forms of a Hebrew unit noun: "פרוסה" → "פרוסות", "כוס" →
// "כוסות"/"כוסים". Over-generation is harmless — each variant only adds an
// alias key for the same entry — while a missed irregular plural ("כפיות")
// just falls back to the AI, per the precision rule.
function unitVariants(unit) {
  const u = String(unit || '').trim();
  if (!u) return [];
  return u.endsWith('ה') ? [u, u.slice(0, -1) + 'ות'] : [u, u + 'ות', u + 'ים'];
}

// Build a lookup Map from entries ({key, name, unit, carbs, fat, protein,
// aliases?}) indexed by the canonical key AND every alias, so a match on any
// rephrase selects the main item. Each entry is also indexed under
// "<unit> <key>" (singular and plural) — the exact text the product-shortcut
// chips compose ("מנה" + "דאבל אספרסו עם טרוביה") — so a shortcut-built or
// dictated description resolves without AI. First writer wins on collisions.
export function buildLookup(entries) {
  const map = new Map();
  for (const e of entries || []) {
    if (!e) continue;
    const put = (k) => {
      const key = catalogKey(k);
      if (key && !map.has(key)) map.set(key, e);
    };
    put(e.key);
    for (const u of unitVariants(e.unit)) put(`${u} ${e.key}`);
    for (const a of e.aliases || []) put(a);
  }
  return map;
}

const EMPTY_LOOKUP = new Map();

// Resolve a meal against two tiers: the user's own saved products first, then
// the learned catalog. A saved product is the user's hand-confirmed data, so it
// outranks everything AND is exempt from the ambiguity rules — its name may
// itself contain grams/numbers ("300 גרם סינטה") and still match, because the
// match is exact on the full normalized text. Two product matches are tried per
// segment: the name left after quantity extraction ("2 מנה X" → qty 2 of "מנה
// X"), then the raw segment verbatim with qty 1 ("300 גרם סינטה" — the digits
// belong to the name, not the amount). Catalog matches keep the full
// precision rules (no ambiguous segment, exact key/alias match).
//
// Returns { result, source: 'local' | 'catalog' } — 'local' when every segment
// came from the user's products — or null when ANY segment fails; no partial
// serving, ever. Totals are derived from the per-item breakdown with the same
// rounding as normalizeMeal, so the meal card always reconciles.
export function resolveFromLookups(desc, productsLookup, catalogLookup) {
  const { segments } = parseMeal(desc);
  if (!segments.length) return null;

  const items = [];
  let fromCatalog = false;
  for (const seg of segments) {
    let qty = seg.qty;
    let entry = seg.nameKey ? productsLookup.get(seg.nameKey) : null;
    if (!entry && productsLookup.has(seg.rawKey)) {
      entry = productsLookup.get(seg.rawKey);
      qty = 1;
    }
    if (!entry) {
      if (seg.ambiguous || !seg.nameKey) return null;
      entry = catalogLookup.get(seg.nameKey);
      if (!entry) return null;
      fromCatalog = true;
    }
    items.push({
      name: entry.name || seg.name,
      qty,
      unit: String(entry.unit || ''),
      carbs: Number(entry.carbs) || 0,
      fat: entry.fat == null ? null : Number(entry.fat),
      protein: entry.protein == null ? null : Number(entry.protein),
    });
  }

  const sum = (key) => items.reduce((a, it) => a + (Number(it[key]) || 0) * (it.qty || 1), 0);
  return {
    result: {
      net_carbs: round2(sum('carbs')),
      fat: items.every((it) => it.fat != null) ? round2(sum('fat')) : null,
      protein: items.every((it) => it.protein != null) ? round2(sum('protein')) : null,
      items,
    },
    source: fromCatalog ? 'catalog' : 'local',
  };
}

// Single-tier resolution (catalog rules in full) — kept for tests/simulation.
export function resolveFromLookup(desc, lookup) {
  const r = resolveFromLookups(desc, EMPTY_LOOKUP, lookup);
  return r ? r.result : null;
}
