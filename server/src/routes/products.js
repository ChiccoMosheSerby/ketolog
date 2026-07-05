import { Router } from 'express';
import Product from '../models/Product.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../lib/http.js';
import { msg, reqLang, defaultCat, defaultUnit } from '../lib/i18n.js';

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
  if (!key || !String(key).trim())
    return res.status(400).json({ error: msg(req, 'תן/י שם למוצר', 'Give the product a name') });
  // Only accept a small inline data-URL thumbnail; ignore anything oversized or
  // not an image data URL so a stray payload can't bloat the document.
  const img =
    typeof image === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(image) && image.length < 200000
      ? image
      : '';
  const lang = reqLang(req);
  const product = await Product.create({
    user: req.userId,
    key: String(key).trim(),
    label: label || key,
    unit: unit || defaultUnit(lang),
    cat: cat || defaultCat(lang),
    carbs: Number(carbs) || 0,
    fat: Number(fat) || 0,
    protein: Number(protein) || 0,
    image: img,
  });
  res.status(201).json(product);
}));

// PATCH /api/products/:id -> rename (only the display name / key)
router.patch('/:id', asyncHandler(async (req, res) => {
  const { key } = req.body;
  if (!key || !String(key).trim())
    return res.status(400).json({ error: msg(req, 'תן/י שם למוצר', 'Give the product a name') });
  const product = await Product.findOneAndUpdate(
    { _id: req.params.id, user: req.userId },
    { key: String(key).trim() },
    { new: true }
  );
  if (!product) return res.status(404).json({ error: msg(req, 'מוצר לא נמצא', 'Product not found') });
  res.json(product);
}));

// DELETE /api/products/:id
router.delete('/:id', asyncHandler(async (req, res) => {
  const result = await Product.deleteOne({ _id: req.params.id, user: req.userId });
  if (result.deletedCount === 0)
    return res.status(404).json({ error: msg(req, 'מוצר לא נמצא', 'Product not found') });
  res.json({ ok: true });
}));

export default router;
