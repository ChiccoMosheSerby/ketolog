// Catalog optimization: folding rephrasings of the same food under one main
// item ("merges"), manually curating items, and the admin-triggered AI scan
// that PROPOSES merge candidates.
//
// Ground rules (user decisions):
// - The scan only ever writes `pending` CatalogMerge proposals — NOTHING is
//   merged automatically. applyMerge() below is the single writer of a real
//   merge, reached only from admin approval or admin manual creation.
// - The admin picks which member is the main item (the UI pre-selects the
//   highest-usedCount member; the model's suggestion is just a default).
// - Scans run ONLY when the admin presses "scan now" (or the CLI) — no
//   scheduling of any kind.
// - Decided merges feed the next scan's few-shot examples: applied/admin ones
//   as positives, rejected ones as negatives — the scan learns the admin's own
//   patterns over time.
import CatalogItem from '../models/CatalogItem.js';
import CatalogMerge from '../models/CatalogMerge.js';
import { getClient, CHAT_MODEL, ketoRules, parseJsonReply, aiConfigured } from './anthropic.js';
import { recordAnthropicUsage } from './usage.js';
import { catalogKey, aliasRemap } from './catalog.js';

// Bump when the scan prompt improves — clusters whose members were all examined
// by the current version are skipped, so a version bump re-opens everything.
export const OPTIMIZE_PROMPT_VERSION = 1;
// Proposals below this confidence are dropped as noise (never even queued).
const REVIEW_CONFIDENCE = 0.6;
const MAX_CLUSTERS_PER_RUN = 40;
const MAX_CLUSTER_SIZE = 6;

const num0 = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

// ---------------------------------------------------------------------------
// Applying merges (admin approval / admin manual creation ONLY)
// ---------------------------------------------------------------------------

// Apply one merge: fold the alias item (if a row exists) into the canonical
// item, register the alias on the canonical's aliases cache, mark the merge
// applied. Keeps the no-chains invariant by re-pointing any applied merges
// that targeted the alias. Idempotent — re-applying an applied merge is a no-op.
export async function applyMerge(mergeDoc, { macroFix } = {}) {
  const aliasKey = catalogKey(mergeDoc.aliasKey);
  // resolve the canonical through existing applied merges (no chains)
  const remap = await aliasRemap();
  let canonicalKey = catalogKey(mergeDoc.canonicalKey);
  canonicalKey = remap.get(canonicalKey) || canonicalKey;
  if (!aliasKey || !canonicalKey) throw new Error('מפתחות לא תקינים');
  if (aliasKey === canonicalKey) throw new Error('אי אפשר למזג פריט לעצמו');

  const canonical = await CatalogItem.findOne({ key: canonicalKey });
  if (!canonical) throw new Error(`הפריט הראשי "${canonicalKey}" לא קיים בקטלוג`);
  const alias = await CatalogItem.findOne({ key: aliasKey }).lean();

  // fold the alias row's stats + its own aliases into the canonical
  const aliasSet = new Set([...(canonical.aliases || []), aliasKey, ...(alias?.aliases || [])]);
  aliasSet.delete(canonicalKey);
  canonical.aliases = [...aliasSet].sort();
  canonical.usedCount = (canonical.usedCount || 0) + (alias?.usedCount || 0);
  if (alias?.lastUsed && (!canonical.lastUsed || alias.lastUsed > canonical.lastUsed)) {
    canonical.lastUsed = alias.lastUsed;
  }
  canonical.verified = true;
  const fix = macroFix || mergeDoc.macroFix;
  if (fix) {
    if (num0(fix.carbs) != null) canonical.carbs = num0(fix.carbs);
    if (num0(fix.fat) != null) canonical.fat = num0(fix.fat);
    if (num0(fix.protein) != null) canonical.protein = num0(fix.protein);
  }
  await canonical.save();
  if (alias) await CatalogItem.deleteOne({ key: aliasKey });

  // no-chains invariant: merges that pointed AT the alias now point at the
  // canonical, and the alias's own folded aliases follow it too
  await CatalogMerge.updateMany(
    { canonicalKey: aliasKey, status: 'applied' },
    { $set: { canonicalKey } }
  );

  await CatalogMerge.updateOne(
    { aliasKey },
    { $set: { canonicalKey, status: 'applied' } }
  );
  return { canonicalKey, aliasKey };
}

// Admin-created merge: fold existing items and/or brand-new phrases under a
// chosen main item, applied immediately (source 'admin', confidence 1). A
// phrase that was previously rejected can be re-merged by the admin — the
// admin's explicit decision wins; a phrase already applied to a DIFFERENT
// canonical is a conflict and is reported, not silently re-pointed.
//
// The main name may be BRAND NEW (multi-select → merge → "define the main
// name"): when no catalog row exists for it, one is created seeded with the
// per-unit values of the most-used existing item among the folded phrases,
// marked verified so backfills keep the curated name.
export async function createManualMerge({ canonicalKey, phrases = [] }) {
  const canonical = catalogKey(canonicalKey);
  if (!canonical) throw new Error('חסר פריט ראשי');

  if (!(await CatalogItem.findOne({ key: canonical }).lean())) {
    const donor = await CatalogItem.find({ key: { $in: phrases.map(catalogKey).filter(Boolean) } })
      .sort({ usedCount: -1 })
      .limit(1)
      .lean();
    if (!donor.length) {
      throw new Error(`הפריט הראשי "${canonical}" לא קיים בקטלוג ואין פריט קיים בין הניסוחים לרשת ממנו ערכים`);
    }
    const d = donor[0];
    await CatalogItem.create({
      key: canonical,
      name: String(canonicalKey).trim(),
      label: d.label || '',
      unit: d.unit || '',
      carbs: d.carbs,
      fat: d.fat,
      protein: d.protein,
      usedCount: 0, // the donors' counts fold in via applyMerge below
      lastUsed: d.lastUsed || null,
      verified: true,
      optimizeVersion: OPTIMIZE_PROMPT_VERSION,
    });
  }

  const applied = [];
  for (const raw of phrases) {
    const aliasKey = catalogKey(raw);
    if (!aliasKey || aliasKey === canonical) continue;
    const existing = await CatalogMerge.findOne({ aliasKey }).lean();
    if (existing && existing.status === 'applied' && existing.canonicalKey !== canonical) {
      throw new Error(`"${aliasKey}" כבר ממוזג תחת "${existing.canonicalKey}"`);
    }
    await CatalogMerge.updateOne(
      { aliasKey },
      {
        $set: {
          canonicalKey: canonical,
          confidence: 1,
          reason: 'admin',
          source: 'admin',
          status: 'pending', // applyMerge flips it to applied
        },
        $setOnInsert: { promptVersion: 0, macroFix: null },
      },
      { upsert: true }
    );
    const doc = await CatalogMerge.findOne({ aliasKey }).lean();
    applied.push(await applyMerge(doc));
  }
  return applied;
}

// Admin-created catalog item with hand-calculated macros (plus optional
// rephrases). Marked verified so recomputeCatalog never overwrites the curated
// label, and usable by the resolver immediately even before it's ever logged.
export async function createManualItem({ name, label, unit, carbs, fat, protein, phrases = [] }) {
  const key = catalogKey(name);
  if (!key) throw new Error('תן/י שם למוצר');
  const existing = await CatalogItem.findOne({ key }).lean();
  if (existing) throw new Error('פריט בשם הזה כבר קיים בקטלוג');
  await CatalogItem.create({
    key,
    name: String(name).trim(),
    label: String(label || '').trim(),
    unit: String(unit || '').trim(),
    carbs: num0(carbs) ?? 0,
    fat: fat == null || fat === '' ? null : num0(fat),
    protein: protein == null || protein === '' ? null : num0(protein),
    usedCount: 0,
    lastUsed: null,
    verified: true,
    optimizeVersion: OPTIMIZE_PROMPT_VERSION,
  });
  const merges = phrases.length ? await createManualMerge({ canonicalKey: key, phrases }) : [];
  return { key, merges };
}

// Detach a rephrase from its main item: the merge record is deleted (so a
// future scan may re-propose it — reject it there if it was truly wrong) and
// the alias leaves the item's cache. The phrase becomes independent again;
// logging it later creates its own catalog row. Renaming a rephrase in the UI
// is detach + add-under-the-same-item.
export async function removeAlias(aliasKeyRaw) {
  const aliasKey = catalogKey(aliasKeyRaw);
  if (!aliasKey) throw new Error('חסר ניסוח');
  const merge = await CatalogMerge.findOne({ aliasKey, status: 'applied' }).lean();
  await CatalogMerge.deleteOne({ aliasKey });
  // pull from whichever item carries it (covers stale/edge states too)
  const { modifiedCount } = await CatalogItem.updateMany(
    { aliases: aliasKey },
    { $pull: { aliases: aliasKey } }
  );
  if (!merge && !modifiedCount) throw new Error('הניסוח לא נמצא');
  return { aliasKey, canonicalKey: merge?.canonicalKey || null };
}

// Delete an item outright. Its applied/pending merges are removed too — the
// folded rephrasings become independent again (keeping them would make a later
// log of a rephrase resurrect the deleted key via aliasRemap). Rejected merges
// stay: they are negative few-shot examples, not live mappings. The food can
// still reappear if a user logs it again or a backfill runs — deletion removes
// the catalog entry, not the meal history behind it.
export async function deleteManualItem(keyRaw) {
  const key = catalogKey(keyRaw);
  if (!key) throw new Error('חסר פריט');
  const { deletedCount } = await CatalogItem.deleteOne({ key });
  if (!deletedCount) throw new Error('פריט לא נמצא');
  const { deletedCount: removedMerges } = await CatalogMerge.deleteMany({
    $or: [{ canonicalKey: key }, { aliasKey: key }],
    status: { $ne: 'rejected' },
  });
  return { key, removedMerges };
}

// Admin edit of an existing item's curated fields (macros/label/unit/name —
// the normalized key itself is immutable). Marks the entry verified.
export async function updateManualItem(key, { name, label, unit, carbs, fat, protein, reviewNote }) {
  const set = { verified: true };
  if (name != null && String(name).trim()) set.name = String(name).trim();
  if (label != null) set.label = String(label).trim();
  if (unit != null) set.unit = String(unit).trim();
  if (carbs != null && carbs !== '') set.carbs = num0(carbs) ?? 0;
  if (fat !== undefined) set.fat = fat === null || fat === '' ? null : num0(fat);
  if (protein !== undefined) set.protein = protein === null || protein === '' ? null : num0(protein);
  if (reviewNote !== undefined) set.reviewNote = String(reviewNote || '');
  const item = await CatalogItem.findOneAndUpdate({ key: catalogKey(key) }, { $set: set }, { new: true });
  if (!item) throw new Error('פריט לא נמצא');
  return item;
}

// ---------------------------------------------------------------------------
// The AI scan (admin "scan now" button / CLI) — proposes, never applies
// ---------------------------------------------------------------------------

const tokensOf = (key) => key.split(' ').filter(Boolean);

// Levenshtein with early exit — catches typo/spelling/singular-plural variants.
function lev(a, b, max) {
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

function looksSimilar(a, b) {
  const ta = tokensOf(a.key);
  const tb = tokensOf(b.key);
  // whole-token containment: "גאודה" ⊂ "פרוסת גאודה"
  const [small, big] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  if (small.length && small.every((t) => big.includes(t))) return true;
  // token-set overlap
  const setB = new Set(tb);
  const shared = ta.filter((t) => setB.has(t)).length;
  const union = new Set([...ta, ...tb]).size;
  if (union && shared / union >= 0.5) return true;
  // small edit distance on the whole key (typos, plural forms)
  const cap = Math.min(a.key.length, b.key.length) >= 6 ? 2 : 1;
  return lev(a.key, b.key, cap) <= cap;
}

// Group look-alike phrasings into candidate clusters — pure heuristics, no AI.
// The clusters only PROPOSE candidates; the model judges same-food, the admin
// decides. Blocking by shared token keeps this far from O(n²) on a big catalog.
export function buildCandidateClusters(items, { maxClusters = MAX_CLUSTERS_PER_RUN, maxSize = MAX_CLUSTER_SIZE } = {}) {
  const byToken = new Map();
  items.forEach((it, i) => {
    for (const t of new Set(tokensOf(it.key))) {
      if (!byToken.has(t)) byToken.set(t, []);
      byToken.get(t).push(i);
    }
  });

  // union-find over similar pairs within each token block
  const parent = items.map((_, i) => i);
  const find = (x) => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };
  const compared = new Set();
  for (const idxs of byToken.values()) {
    for (let i = 0; i < idxs.length; i++) {
      for (let j = i + 1; j < idxs.length; j++) {
        const a = idxs[i];
        const b = idxs[j];
        const pair = a < b ? `${a}:${b}` : `${b}:${a}`;
        if (compared.has(pair)) continue;
        compared.add(pair);
        if (looksSimilar(items[a], items[b])) union(a, b);
      }
    }
  }
  // extra pass for single-token typo pairs that share no exact token
  for (let a = 0; a < items.length; a++) {
    for (let b = a + 1; b < items.length; b++) {
      if (find(a) === find(b)) continue;
      if (tokensOf(items[a].key).length === 1 && tokensOf(items[b].key).length === 1) {
        if (looksSimilar(items[a], items[b])) union(a, b);
      }
    }
  }

  const groups = new Map();
  items.forEach((it, i) => {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(it);
  });

  return [...groups.values()]
    .filter((g) => g.length >= 2)
    .map((g) => g.sort((a, b) => (b.usedCount || 0) - (a.usedCount || 0)).slice(0, maxSize))
    .sort(
      (a, b) =>
        b.reduce((s, x) => s + (x.usedCount || 0), 0) - a.reduce((s, x) => s + (x.usedCount || 0), 0)
    )
    .slice(0, maxClusters);
}

// Few-shot examples drawn from the catalog's own history: the admin's applied
// merges teach the model what THIS user considers the same food; rejected ones
// teach it what not to touch. A seed of classic keto traps covers the cold start.
export async function buildFewShot() {
  const [applied, rejected] = await Promise.all([
    CatalogMerge.find({ status: 'applied' }).sort({ updatedAt: -1 }).limit(10).lean(),
    CatalogMerge.find({ status: 'rejected' }).sort({ updatedAt: -1 }).limit(10).lean(),
  ]);
  const pos = applied.map((m) => `"${m.aliasKey}" ⇢ "${m.canonicalKey}"`);
  const neg = rejected.map((m) => `"${m.aliasKey}" ≠ "${m.canonicalKey}"`);
  neg.push(
    '"ביצה מטוגנת" ≠ "ביצה קשה" (אופן הכנה שונה)',
    '"חזה עוף" ≠ "שוקי עוף" (נתח שונה, ערכים שונים)',
    '"קוטג\' 5%" ≠ "קוטג\' 9%" (אחוז שומן שונה)',
    '"חלב מלא" ≠ "חלב דל שומן" (ערכים שונים)'
  );
  return { pos, neg };
}

const SCAN_FORMAT = `
המשימה: לפניך אשכולות (clusters) של פריטים מהקטלוג הגלובלי של האפליקציה שנראים דומים בשמם. לכל אשכול, קבע/י אילו פריטים הם באמת אותו מאכל בדיוק — אותו מאכל בסיסי, אותו אופן הכנה, ואותו בסיס ליחידה — ולכן ניסוחים שונים של אותו דבר שאפשר לאחד.
כללים מחייבים:
- אחד/י רק כשמדובר באותו מאכל ממש. אופן הכנה שונה, נתח שונה, אחוז שומן שונה, או יחידה שונה (פרוסה מול 100 גרם) — אסור לאחד.
- canonicalKey הוא השם המיטבי לפריט הראשי (עדיף השם הנפוץ/המדויק). aliasKeys הם הניסוחים שיתקפלו תחתיו.
- אם הערכים ליחידה של הפריט הראשי נראים שגויים לפי הידע התזונתי, אפשר להציע macroFix (ערכים ליחידה אחת) עם note קצר — אחרת null.
- confidence בין 0 ל-1: עד כמה בטוח/ה שזה אותו מאכל.
- פריט שאין לו התאמה אמיתית — פשוט אל תכלול אותו בשום merge.
- אפשר גם לסמן פריט בעייתי (ערכים חשודים) ב-flags גם בלי מיזוג.
השב/י אך ורק ב-JSON תקין:
{"merges":[{"groupId":<מספר>,"canonicalKey":"<key>","aliasKeys":["<key>",...],"confidence":<0-1>,"reason":"<נימוק קצר>","macroFix":{"carbs":<מס>,"fat":<מס>,"protein":<מס>,"note":"<הסבר>"} או null}],
 "flags":[{"key":"<key>","issue":"<מה חשוד>"}]}
ללא טקסט נוסף וללא markdown.`;

// One Claude call for the whole scan — all clusters batched into one message.
export async function generateMergePlan(clusters, fewShot, ctx = {}) {
  const examples =
    (fewShot.pos.length
      ? `\nמיזוגים שאושרו בעבר באפליקציה (למד/י מהדפוסים האלה):\n${fewShot.pos.join('\n')}\n`
      : '') +
    (fewShot.neg.length
      ? `\nזוגות שאסור לאחד (נדחו בעבר או ידועים כשונים):\n${fewShot.neg.join('\n')}\n`
      : '');
  const payload = clusters.map((members, i) => ({
    groupId: i,
    members: members.map((m) => ({
      key: m.key,
      name: m.name,
      label: m.label || undefined,
      unit: m.unit || undefined,
      carbs: m.carbs,
      fat: m.fat,
      protein: m.protein,
      usedCount: m.usedCount,
    })),
  }));
  const message = await getClient().messages.create({
    model: CHAT_MODEL(),
    max_tokens: 4000,
    system: ketoRules() + examples + SCAN_FORMAT,
    messages: [{ role: 'user', content: JSON.stringify(payload) }],
  });
  recordAnthropicUsage({ userId: ctx.userId, kind: 'optimize_catalog', model: CHAT_MODEL(), usage: message.usage });
  return parseJsonReply(message);
}

// Validate the model output against what was actually sent — hallucinated keys
// die here, weak confidence is dropped, unit mismatches get flagged in the
// reason so the admin sees them. EVERYTHING that survives is only a proposal.
export function normalizeMergePlan(plan, sentByKey) {
  const merges = [];
  for (const m of Array.isArray(plan?.merges) ? plan.merges : []) {
    const canonicalKey = catalogKey(m?.canonicalKey);
    const canonical = sentByKey.get(canonicalKey);
    if (!canonical) continue;
    const aliasKeys = [...new Set((Array.isArray(m?.aliasKeys) ? m.aliasKeys : []).map(catalogKey))].filter(
      (k) => k && k !== canonicalKey && sentByKey.has(k)
    );
    if (!aliasKeys.length) continue;
    const confidence = Math.max(0, Math.min(1, Number(m?.confidence) || 0));
    if (confidence < REVIEW_CONFIDENCE) continue;

    let reason = String(m?.reason || '').trim();
    const units = new Set([canonical, ...aliasKeys.map((k) => sentByKey.get(k))].map((x) => catalogKey(x.unit)));
    if (units.size > 1) reason = `⚠ יחידות שונות (${[...units].filter(Boolean).join(' / ')}) — ${reason}`;

    let macroFix = null;
    if (m?.macroFix && typeof m.macroFix === 'object') {
      macroFix = {
        carbs: num0(m.macroFix.carbs),
        fat: num0(m.macroFix.fat),
        protein: num0(m.macroFix.protein),
        note: String(m.macroFix.note || '').trim(),
      };
      if (macroFix.carbs == null && macroFix.fat == null && macroFix.protein == null) macroFix = null;
    }
    merges.push({ canonicalKey, aliasKeys, confidence, reason, macroFix });
  }

  const flags = (Array.isArray(plan?.flags) ? plan.flags : [])
    .map((f) => ({ key: catalogKey(f?.key), issue: String(f?.issue || '').trim() }))
    .filter((f) => f.key && f.issue && sentByKey.has(f.key));

  return { merges, flags };
}

// Write the plan as PENDING proposals. Already-decided (or already-pending)
// phrases are left untouched — the unique aliasKey makes a re-scan a no-op for
// them. Members of the sent clusters are version-stamped so the next
// incremental scan skips clusters with nothing new in them.
export async function recordProposals(plan, sentKeys) {
  let proposed = 0;
  for (const m of plan.merges) {
    for (const aliasKey of m.aliasKeys) {
      const r = await CatalogMerge.updateOne(
        { aliasKey },
        {
          $setOnInsert: {
            canonicalKey: m.canonicalKey,
            confidence: m.confidence,
            reason: m.reason,
            macroFix: m.macroFix,
            promptVersion: OPTIMIZE_PROMPT_VERSION,
            status: 'pending',
            source: 'auto',
          },
        },
        { upsert: true }
      ).catch((err) => {
        if (err?.code !== 11000) throw err; // concurrent duplicate — fine
        return { upsertedCount: 0 };
      });
      proposed += r.upsertedCount || 0;
    }
  }
  for (const f of plan.flags) {
    await CatalogItem.updateOne({ key: f.key }, { $set: { reviewNote: f.issue } });
  }
  if (sentKeys.length) {
    await CatalogItem.updateMany(
      { key: { $in: sentKeys } },
      { $set: { optimizeVersion: OPTIMIZE_PROMPT_VERSION } }
    );
  }
  return { proposed, flagged: plan.flags.length };
}

// In-process guard + last-run record (manual-only scans; a restart just clears
// the cosmetic lastRun — pendingCount always comes straight from the DB).
let scanInFlight = false;
let lastRun = null;
export const scanStatus = () => ({ running: scanInFlight, lastRun });

// The "scan now" entry point. force=true re-examines already-stamped clusters
// (also what a prompt-version bump does implicitly). dryRun returns the
// normalized plan without writing anything.
export async function runScan({ dryRun = false, force = false, userId = null } = {}) {
  if (!aiConfigured()) throw new Error('מפתח ה-AI לא הוגדר בשרת');
  if (scanInFlight) return { running: true };
  scanInFlight = true;
  try {
    const items = await CatalogItem.find({}).lean();
    // cluster over the WHOLE catalog (a new item must be able to pair with an
    // old, already-stamped one); incremental runs skip clusters with no new member
    let clusters = buildCandidateClusters(items);
    if (!force) {
      clusters = clusters.filter((g) => g.some((it) => (it.optimizeVersion || 0) < OPTIMIZE_PROMPT_VERSION));
    }
    // phrases already decided/pending are still SENT (the model needs the full
    // cluster for context) but are filtered out before proposals are written
    const decided = new Set((await CatalogMerge.find({}, { aliasKey: 1 }).lean()).map((m) => m.aliasKey));

    if (!clusters.length) {
      lastRun = { at: new Date(), clusters: 0, proposed: 0, flagged: 0, dryRun };
      return { ...lastRun };
    }

    const fewShot = await buildFewShot();
    const raw = await generateMergePlan(clusters, fewShot, { userId });
    const sentByKey = new Map(clusters.flat().map((it) => [it.key, it]));
    const plan = normalizeMergePlan(raw, sentByKey);
    // proposals for phrases with an existing decision are dropped before writing
    plan.merges = plan.merges
      .map((m) => ({ ...m, aliasKeys: m.aliasKeys.filter((k) => !decided.has(k)) }))
      .filter((m) => m.aliasKeys.length);

    if (dryRun) {
      lastRun = { at: new Date(), clusters: clusters.length, proposed: 0, flagged: 0, dryRun: true };
      return { ...lastRun, plan };
    }
    const { proposed, flagged } = await recordProposals(plan, [...sentByKey.keys()]);
    lastRun = { at: new Date(), clusters: clusters.length, proposed, flagged, dryRun: false };
    return { ...lastRun };
  } finally {
    scanInFlight = false;
  }
}
