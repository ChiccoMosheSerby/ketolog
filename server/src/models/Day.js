import mongoose from 'mongoose';

const mealSchema = new mongoose.Schema(
  {
    time: { type: String, default: '' },
    cat: { type: String, default: '' },
    desc: { type: String, default: '' },
    carbs: { type: Number, default: 0 },
    fat: { type: Number, default: null },
    protein: { type: Number, default: null },
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
