import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    // Display name, set in settings. Optional — the UI falls back to the email
    // prefix. Attached to bug reports so the admin knows who is writing.
    name: { type: String, default: '', trim: true, maxlength: 60 },
    // Grammatical gender for Hebrew address ('male' | 'female'). Empty = unset,
    // so AI text falls back to neutral dual forms (/ית). Drives correctly-
    // gendered wording in the insight reports.
    gender: { type: String, enum: ['male', 'female', ''], default: '' },
    // Daily net-carb budget (grams). Drives the live budget meter + carb zones.
    dailyCarbTarget: { type: Number, default: 20, min: 5, max: 200 },
    // Monthly weight-loss goal (kg/month). The client derives the daily calorie
    // budget from it (measured TDEE − kg × 7700 / 30) — there is no manual kcal
    // target; it also drives the surplus/deficit grading of each day.
    monthlyLossTarget: { type: Number, default: 2, min: 0, max: 10 },
    // Height (cm) + birth year, both optional (0 = unset). Together with gender
    // and the latest weigh-in they let the client show a provisional TDEE
    // estimate (Mifflin-St Jeor) before enough weigh-ins exist to measure one.
    heightCm: { type: Number, default: 0, min: 0, max: 250 },
    birthYear: { type: Number, default: 0 },
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
    // The user's own Anthropic API key, encrypted at rest (see lib/aiAccess.js).
    // Non-owner accounts get AI features only when this holds a working key.
    anthropicApiKey: { type: String, default: '' },
    // Owner preview toggle: force all AI features off for this account (to see
    // how the app looks/behaves without them).
    aiOptOut: { type: Boolean, default: false },
    // Why the key stopped working ('auth' | 'no_credit' | ''), recorded when an
    // AI call fails so the UI can explain instead of failing silently.
    aiKeyError: { type: String, default: '' },
    // Optional self-set monthly AI spend budget (USD, 0 = none). Compared
    // against the recorded usage to warn the user before they run out.
    aiMonthlyBudgetUsd: { type: Number, default: 0, min: 0, max: 10000 },
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
