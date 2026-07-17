import { Router } from 'express';
import Product from '../models/Product.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../lib/http.js';

const router = Router();
router.use(requireAuth);

// GET /api/products -> all of the user's saved products
router.get('/', asyncHandler(async (req, res) => {
  const products = await Product.find({ user: req.userId }).sort({ createdAt: 1 }).lean();
  res.json(products);
}));

// POST /api/products -> create a product
router.post('/', asyncHandler(async (req, res) => {
  const { key, label, unit, cat, carbs, fat, protein, image } = req.body;
  if (!key || !String(key).trim()) return res.status(400).json({ error: 'תן/י שם למוצר' });
  // Only accept a small inline data-URL thumbnail; ignore anything oversized or
  // not an image data URL so a stray payload can't bloat the document.
  const img =
    typeof image === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(image) && image.length < 200000
      ? image
      : '';
  const product = await Product.create({
    user: req.userId,
    key: String(key).trim(),
    label: label || key,
    unit: unit || 'מנה',
    cat: cat || 'נשנוש / ביניים',
    carbs: Number(carbs) || 0,
    fat: Number(fat) || 0,
    protein: Number(protein) || 0,
    image: img,
  });
  res.status(201).json(product);
}));

// PATCH /api/products/:id -> partial update: name (key), category, starred
router.patch('/:id', asyncHandler(async (req, res) => {
  const up = {};
  if (req.body.key !== undefined) {
    const key = String(req.body.key).trim();
    if (!key) return res.status(400).json({ error: 'תן/י שם למוצר' });
    up.key = key;
  }
  if (req.body.cat !== undefined) {
    up.cat = String(req.body.cat).trim() || 'נשנוש / ביניים';
  }
  if (req.body.starred !== undefined) up.starred = !!req.body.starred;
  if (!Object.keys(up).length) return res.status(400).json({ error: 'אין מה לעדכן' });
  const product = await Product.findOneAndUpdate(
    { _id: req.params.id, user: req.userId },
    up,
    { new: true }
  );
  if (!product) return res.status(404).json({ error: 'מוצר לא נמצא' });
  res.json(product);
}));

// DELETE /api/products/:id
router.delete('/:id', asyncHandler(async (req, res) => {
  const result = await Product.deleteOne({ _id: req.params.id, user: req.userId });
  if (result.deletedCount === 0) return res.status(404).json({ error: 'מוצר לא נמצא' });
  res.json({ ok: true });
}));

export default router;
