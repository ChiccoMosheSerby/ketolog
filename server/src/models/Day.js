import mongoose from 'mongoose';

// A single part of a meal (one ingredient/product line). Macros are PER ONE
// unit, so a line total = qty × the per-unit value, and the line maps cleanly
// onto a personal Product when the user saves it. Identical parts eaten more
// than once are stored as one item with qty > 1 (e.g. 6× נקניקיה), not repeated.
const mealItemSchema = new mongoose.Schema(
  {
    name: { type: String, default: '' },
    qty: { type: Number, default: 1 },
    unit: { type: String, default: '' },
    carbs: { type: Number, default: 0 }, // net carbs per single unit
    fat: { type: Number, default: null }, // per single unit
    protein: { type: Number, default: null }, // per single unit
  },
  { _id: false }
);

const mealSchema = new mongoose.Schema(
  {
    time: { type: String, default: '' },
    cat: { type: String, default: '' },
    desc: { type: String, default: '' },
    carbs: { type: Number, default: 0 },
    fat: { type: Number, default: null },
    protein: { type: Number, default: null },
    items: { type: [mealItemSchema], default: [] },
    // where the numbers came from: 'catalog' (the learned product catalog, no
    // AI) | 'local' (client-side sum of tapped saved products, no AI) | 'ai' |
    // '' (manual entry / pre-feature meals). Makes AI usage visible per meal.
    source: { type: String, default: '' },
  },
  { _id: true }
);

const metricsSchema = new mongoose.Schema(
  {
    weight: { type: String, default: '' },
    run: { type: Boolean, default: false },
    abs: { type: Boolean, default: false },
    status: { type: String, default: '' },
  },
  { _id: false }
);

const daySchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    // ISO date string 'YYYY-MM-DD' — one document per user per day
    date: { type: String, required: true },
    label: { type: String, default: '' },
    meals: { type: [mealSchema], default: [] },
    metrics: { type: metricsSchema, default: () => ({}) },
  },
  { timestamps: true }
);

// A user can only have one document per calendar day
daySchema.index({ user: 1, date: 1 }, { unique: true });

export default mongoose.model('Day', daySchema);
