import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    // Grammatical gender for Hebrew address ('male' | 'female'). Empty = unset,
    // so AI text falls back to neutral dual forms (/ית). Drives correctly-
    // gendered wording in the insight reports.
    gender: { type: String, enum: ['male', 'female', ''], default: '' },
    // Daily net-carb budget (grams). Drives the live budget meter + carb zones.
    dailyCarbTarget: { type: Number, default: 20, min: 5, max: 200 },
    // Daily calorie budget (kcal). 0 = no target set; when set it colors the
    // daily kcal totals (green/amber/red) and draws the target line on the
    // calories trend chart.
    dailyKcalTarget: { type: Number, default: 0, min: 0, max: 10000 },
    // Keto-period goal: when the run started (YYYY-MM-DD) + its length in months.
    // months = 0 means no goal set; drives the progress chart on the dashboard.
    ketoStartDate: { type: String, default: '' },
    ketoGoalMonths: { type: Number, default: 0, min: 0, max: 60 },
    // Access gate: a user can sign in only once approved (admins are auto-approved
    // at registration; everyone else waits for the admin to click the email link).
    approved: { type: Boolean, default: false },
    // Linked WhatsApp number (normalized to E.164 digits, no '+', e.g.
    // '972501234567') so meals texted to the bot map back to this account. Empty
    // = not linked. Uniqueness is enforced by the partial index below (an empty
    // string never participates, so many un-linked users can coexist).
    whatsappPhone: { type: String, default: '' },
  },
  { timestamps: true }
);

// One phone links to at most one user. Partial filter so only non-empty numbers
// are indexed/uniqueness-checked — blank whatsappPhone values don't collide.
userSchema.index(
  { whatsappPhone: 1 },
  { unique: true, partialFilterExpression: { whatsappPhone: { $gt: '' } } }
);

export default mongoose.model('User', userSchema);
