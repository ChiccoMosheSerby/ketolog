import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { isAdmin } from '../lib/approval.js';
import { usageSummary } from '../lib/usage.js';
import { asyncHandler } from '../lib/http.js';
import CatalogItem from '../models/CatalogItem.js';

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
router.get('/catalog', asyncHandler(async (req, res) => {
  const items = await CatalogItem.find({}).sort({ usedCount: -1 }).lean();
  res.json({ items, count: items.length });
}));

export default router;
