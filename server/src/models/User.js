import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    // Daily net-carb budget (grams). Drives the live budget meter + carb zones.
    dailyCarbTarget: { type: Number, default: 20, min: 5, max: 200 },
  },
  { timestamps: true }
);

export default mongoose.model('User', userSchema);
