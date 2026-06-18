import { Router } from 'express';
import Product from '../models/Product.js';
import { requireAuth } from '../middleware/auth.js';
import { estimateMeal, estimateImage, aiConfigured } from '../lib/anthropic.js';

const router = Router();
router.use(requireAuth);

// POST /api/ai/estimate-meal { desc } -> { net_carbs, fat, protein, breakdown }
router.post('/estimate-meal', async (req, res) => {
  if (!aiConfigured()) return res.status(503).json({ error: 'מפתח ה-AI לא הוגדר בשרת' });
  const desc = (req.body.desc || '').trim();
  if (!desc) return res.status(400).json({ error: 'חסר תיאור הארוחה' });
  try {
    const products = await Product.find({ user: req.userId }).lean();
    const result = await estimateMeal(desc, products);
    res.json(result);
  } catch (err) {
    console.error('estimate-meal failed:', err.message);
    res.status(502).json({ error: 'החישוב האוטומטי נכשל כרגע' });
  }
});

// POST /api/ai/estimate-image { image (base64), mediaType, unit } -> product fields
router.post('/estimate-image', async (req, res) => {
  if (!aiConfigured()) return res.status(503).json({ error: 'מפתח ה-AI לא הוגדר בשרת' });
  const { image, mediaType, unit } = req.body;
  if (!image || !mediaType) return res.status(400).json({ error: 'חסרים נתוני תמונה' });
  try {
    const products = await Product.find({ user: req.userId }).lean();
    const result = await estimateImage(image, mediaType, unit, products);
    res.json(result);
  } catch (err) {
    console.error('estimate-image failed:', err.message);
    res.status(502).json({ error: 'זיהוי התמונה נכשל כרגע' });
  }
});

export default router;
