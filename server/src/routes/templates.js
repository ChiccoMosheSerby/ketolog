import { Router } from 'express';
import MealTemplate from '../models/MealTemplate.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../lib/http.js';
import { msg, reqLang, defaultCat } from '../lib/i18n.js';

const router = Router();
router.use(requireAuth);

// GET /api/templates -> all of the user's saved meal templates
router.get('/', asyncHandler(async (req, res) => {
  const templates = await MealTemplate.find({ user: req.userId }).sort({ createdAt: 1 }).lean();
  res.json(templates);
}));

// POST /api/templates -> create a template
router.post('/', asyncHandler(async (req, res) => {
  const { name, time, cat, desc, carbs, fat, protein } = req.body;
  if (!name || !String(name).trim())
    return res.status(400).json({ error: msg(req, 'תן/י שם לתבנית', 'Give the template a name') });
  const template = await MealTemplate.create({
    user: req.userId,
    name: String(name).trim(),
    time: time || '',
    cat: cat || defaultCat(reqLang(req)),
    desc: desc || '',
    carbs: Number(carbs) || 0,
    fat: fat == null ? null : Number(fat),
    protein: protein == null ? null : Number(protein),
  });
  res.status(201).json(template);
}));

// DELETE /api/templates/:id
router.delete('/:id', asyncHandler(async (req, res) => {
  const result = await MealTemplate.deleteOne({ _id: req.params.id, user: req.userId });
  if (result.deletedCount === 0) return res.status(404).json({ error: msg(req, 'תבנית לא נמצאה', 'Template not found') });
  res.json({ ok: true });
}));

export default router;
