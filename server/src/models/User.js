import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    // Daily net-carb budget (grams). Drives the live budget meter + carb zones.
    dailyCarbTarget: { type: Number, default: 20, min: 5, max: 200 },
    // Access gate: a user can sign in only once approved (admins are auto-approved
    // at registration; everyone else waits for the admin to click the email link).
    approved: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export default mongoose.model('User', userSchema);
