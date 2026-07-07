import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { isAdmin } from '../lib/approval.js';
import { usageSummary } from '../lib/usage.js';
import { asyncHandler } from '../lib/http.js';
import CatalogItem from '../models/CatalogItem.js';
import CatalogMerge from '../models/CatalogMerge.js';
import {
  runScan,
  scanStatus,
  applyMerge,
  createManualMerge,
  createManualItem,
  updateManualItem,
  removeAlias,
} from '../lib/optimizeCatalog.js';
import { getSetting, setSetting, RESOLVER_ENABLED } from '../lib/settings.js';

const router = Router();

// All admin routes require a logged-in admin. requireAuth attaches req.user;
// non-admins get a 403 so the client hides the dashboard rather than erroring.
router.use(requireAuth);
router.use((req, res, next) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'למנהלים בלבד' });
  next();
});

// GET /api/admin/usage -> per-user AI cost breakdown (what each user costs me).
router.get('/usage', asyncHandler(async (req, res) => {
  res.json(await usageSummary());
}));

// GET /api/admin/catalog -> the whole global learned-product catalog. The admin
// UI does its own filtering/sorting client-side (regex, column sort, thresholds),
// so we just hand over every item; the catalog is small (distinct foods).
// Also reports the optimize-scan status + how many merge requests await review.
// Reading NEVER triggers a scan — scans are manual-only ("scan now" / CLI).
router.get('/catalog', asyncHandler(async (req, res) => {
  const [items, pendingCount, resolverEnabled] = await Promise.all([
    CatalogItem.find({}).sort({ usedCount: -1 }).lean(),
    CatalogMerge.countDocuments({ status: 'pending' }),
    getSetting(RESOLVER_ENABLED, false),
  ]);
  res.json({
    items,
    count: items.length,
    optimize: { ...scanStatus(), pendingCount },
    resolverEnabled: !!resolverEnabled,
  });
}));

// POST /api/admin/catalog/resolver { enabled } -> the feature kill switch.
// OFF (default): meal estimation behaves exactly as before the catalog feature
// (cache → AI, no catalog involvement). ON: confident meals are served from
// the catalog with no AI call. Takes effect within seconds (settings cache).
router.post('/catalog/resolver', asyncHandler(async (req, res) => {
  const enabled = !!req.body?.enabled;
  await setSetting(RESOLVER_ENABLED, enabled);
  res.json({ resolverEnabled: enabled });
}));

// POST /api/admin/catalog/optimize { dryRun? } -> run the AI duplicate scan NOW.
// Awaited so the button gets the result (clusters/proposed counts) directly;
// the in-process guard turns a double-click into { running: true }.
router.post('/catalog/optimize', asyncHandler(async (req, res) => {
  try {
    const result = await runScan({ dryRun: !!req.body?.dryRun, force: !!req.body?.force, userId: req.userId });
    res.json(result);
  } catch (err) {
    console.error('catalog scan failed:', err.message);
    res.status(502).json({ error: err.message || 'הסריקה נכשלה' });
  }
}));

// GET /api/admin/catalog/merges?status=pending -> merge requests for review.
// Pending first (by confidence), then recently decided ones for reference.
router.get('/catalog/merges', asyncHandler(async (req, res) => {
  const status = String(req.query.status || '').trim();
  const filter = ['pending', 'applied', 'rejected'].includes(status) ? { status } : {};
  const merges = await CatalogMerge.find(filter).sort({ status: 1, confidence: -1, updatedAt: -1 }).limit(200).lean();
  res.json({ merges });
}));

// POST /api/admin/catalog/merges -> admin-created merge: fold phrases (existing
// items or brand-new rephrasings) under a chosen main item. Applied immediately.
router.post('/catalog/merges', asyncHandler(async (req, res) => {
  const { canonicalKey, phrases } = req.body || {};
  try {
    const applied = await createManualMerge({
      canonicalKey,
      phrases: Array.isArray(phrases) ? phrases : [],
    });
    res.status(201).json({ applied });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}));

// POST /api/admin/catalog/merges/:id { decision: 'approve'|'reject', canonicalKey? }
// Approve applies the merge (optionally flipping which member is the main item
// first — the admin picks the canonical); reject records a negative example
// that future scans learn from. Both are final for that phrase unless the admin
// later re-merges it manually.
router.post('/catalog/merges/:id', asyncHandler(async (req, res) => {
  const doc = await CatalogMerge.findById(req.params.id);
  if (!doc) return res.status(404).json({ error: 'בקשת מיזוג לא נמצאה' });
  if (doc.status !== 'pending') return res.json({ status: doc.status, already: true });

  const decision = req.body?.decision === 'approve' ? 'approve' : 'reject';
  if (decision === 'reject') {
    doc.status = 'rejected';
    await doc.save();
    return res.json({ status: 'rejected' });
  }

  try {
    // the admin may flip the main item: fold the OTHER side instead
    const chosen = String(req.body?.canonicalKey || '').trim();
    if (chosen && chosen !== doc.canonicalKey) {
      if (chosen !== doc.aliasKey) return res.status(400).json({ error: 'הפריט הראשי חייב להיות אחד מצדדי הבקשה' });
      const swap = doc.canonicalKey;
      doc.canonicalKey = doc.aliasKey;
      doc.aliasKey = swap;
      await doc.save(); // unique aliasKey may collide with an existing decision
    }
    const applied = await applyMerge(doc);
    res.json({ status: 'applied', ...applied });
  } catch (err) {
    const msg = err?.code === 11000 ? 'קיימת כבר החלטה על הביטוי הזה' : err.message;
    res.status(400).json({ error: msg });
  }
}));

// POST /api/admin/catalog/items -> manually create a catalog product with
// hand-calculated per-unit values (+ optional rephrases), usable by the
// resolver immediately and protected from backfill overwrites (verified).
router.post('/catalog/items', asyncHandler(async (req, res) => {
  const { name, label, unit, carbs, fat, protein, phrases } = req.body || {};
  try {
    const created = await createManualItem({
      name,
      label,
      unit,
      carbs,
      fat,
      protein,
      phrases: Array.isArray(phrases) ? phrases : [],
    });
    res.status(201).json(created);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}));

// PATCH /api/admin/catalog/items/:key -> edit an item's curated fields
// (display name / label / unit / per-unit macros / clear a review note).
router.patch('/catalog/items/:key', asyncHandler(async (req, res) => {
  try {
    const item = await updateManualItem(req.params.key, req.body || {});
    res.json(item);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}));

// DELETE /api/admin/catalog/aliases/:aliasKey -> detach a rephrase from its
// main item (deletes the merge record; the phrase becomes independent again).
// Rename = detach + add the corrected phrase back under the same item.
router.delete('/catalog/aliases/:aliasKey', asyncHandler(async (req, res) => {
  try {
    res.json(await removeAlias(req.params.aliasKey));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}));

export default router;
