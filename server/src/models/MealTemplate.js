import mongoose from 'mongoose';

// A saved, reusable meal the user can re-add with one click (e.g. a fixed
// breakfast). Same shape as an embedded Day meal, plus a display name.
const mealTemplateSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true },
    time: { type: String, default: '' },
    cat: { type: String, default: 'נשנוש / ביניים' },
    desc: { type: String, default: '' },
    carbs: { type: Number, default: 0 },
    fat: { type: Number, default: null },
    protein: { type: Number, default: null },
  },
  { timestamps: true }
);

export default mongoose.model('MealTemplate', mealTemplateSchema);
