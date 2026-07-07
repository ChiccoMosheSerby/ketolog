import mongoose from 'mongoose';

// Tiny app-wide key/value settings store (feature flags etc.). One document per
// key. First use: the catalog-resolver kill switch — the admin can turn the
// DB-first meal calculation on/off from the UI without a deploy, and OFF means
// the estimate path behaves exactly as it did before the feature existed.
const settingSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    value: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true, minimize: false }
);

export default mongoose.model('Setting', settingSchema);
