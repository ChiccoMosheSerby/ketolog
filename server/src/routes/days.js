import { Router } from 'express';
import Day from '../models/Day.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../lib/http.js';
import { captureItemsToCatalog } from '../lib/catalog.js';

const router = Router();
router.use(requireAuth);

// GET /api/days  -> all days for the logged-in user, newest first
router.get('/', asyncHandler(async (req, res) => {
  const days = await Day.find({ user: req.userId }).sort({ date: -1 }).lean();
  res.json(days);
}));

// PUT /api/days/:date  -> upsert day-level fields (label / metrics)
router.put('/:date', asyncHandler(async (req, res) => {
  const { date } = req.params;
  const update = {};
  if (typeof req.body.label === 'string') update.label = req.body.label;
  if (req.body.metrics && typeof req.body.metrics === 'object') update.metrics = req.body.metrics;
  const day = await Day.findOneAndUpdate(
    { user: req.userId, date },
    { $set: update, $setOnInsert: { user: req.userId, date } },
    { new: true, upsert: true }
  );
  res.json(day);
}));

// PATCH /api/days/:date/metrics  -> set a single metric field
router.patch('/:date/metrics', asyncHandler(async (req, res) => {
  const { date } = req.params;
  const { field, value } = req.body;
  const allowed = ['weight', 'run', 'abs', 'status'];
  if (!allowed.includes(field)) return res.status(400).json({ error: 'שדה לא חוקי' });
  const day = await Day.findOneAndUpdate(
    { user: req.userId, date },
    { $set: { [`metrics.${field}`]: value }, $setOnInsert: { user: req.userId, date } },
    { new: true, upsert: true }
  );
  res.json(day);
}));

// Sanitize the optional per-item breakdown. Each item carries macros PER ONE
// unit plus a qty; names are required, the rest fall back to safe defaults.
const cleanMealItems = (arr) =>
  Array.isArray(arr)
    ? arr
        .map((it) => ({
          name: String(it?.name || '').trim(),
          qty: Number(it?.qty) > 0 ? Number(it.qty) : 1,
          unit: String(it?.unit || '').trim(),
          carbs: Number(it?.carbs) || 0,
          fat: it?.fat == null ? null : Number(it.fat),
          protein: it?.protein == null ? null : Number(it.protein),
        }))
        .filter((it) => it.name)
    : [];

// POST /api/days/:date/meals  -> add a meal, creating the day if needed
router.post('/:date/meals', asyncHandler(async (req, res) => {
  const { date } = req.params;
  const { time = '', cat = '', desc = '', carbs = 0, fat = null, protein = null, items, label } =
    req.body;
  const meal = { time, cat, desc, carbs: Number(carbs) || 0, fat, protein, items: cleanMealItems(items) };
  const setOnInsert = { user: req.userId, date };
  if (label) setOnInsert.label = label;
  const day = await Day.findOneAndUpdate(
    { user: req.userId, date },
    { $push: { meals: meal }, $setOnInsert: setOnInsert },
    { new: true, upsert: true }
  );
  // Feed the global learned-product catalog (best-effort; never blocks the log).
  captureItemsToCatalog(meal.items);
  res.status(201).json(day);
}));

// PATCH /api/days/:date/meals/:mealId  -> update a single meal's time (HH:MM).
// Meals are sorted by this string in the UI, so changing it reorders the day.
router.patch('/:date/meals/:mealId', asyncHandler(async (req, res) => {
  const { date, mealId } = req.params;
  const { time } = req.body;
  if (typeof time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    return res.status(400).json({ error: 'שעה לא חוקית (HH:MM)' });
  }
  const day = await Day.findOneAndUpdate(
    { user: req.userId, date, 'meals._id': mealId },
    { $set: { 'meals.$.time': time } },
    { new: true }
  );
  if (!day) return res.status(404).json({ error: 'ארוחה לא נמצאה' });
  res.json(day);
}));

// DELETE /api/days/:date/meals/:mealId
router.delete('/:date/meals/:mealId', asyncHandler(async (req, res) => {
  const { date, mealId } = req.params;
  const day = await Day.findOneAndUpdate(
    { user: req.userId, date },
    { $pull: { meals: { _id: mealId } } },
    { new: true }
  );
  if (!day) return res.status(404).json({ error: 'יום לא נמצא' });
  res.json(day);
}));

export default router;
