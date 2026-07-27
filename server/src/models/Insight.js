import mongoose from 'mongoose';

// A history of generated insight reports. One document per (user, period,
// periodKey) — e.g. the weekly report for the week starting 2026-06-21, or the
// monthly report for 2026-06. In the default 'auto' mode reports are generated
// automatically (lazily, in the background) once a period completes; accounts
// in 'manual' mode instead trigger an 'ondemand' report (last 7 days, keyed by
// the run date) with a button. The unique index makes generation idempotent
// under concurrent requests. `seenAt` stays null until the user opens the
// report, which drives the "new" highlight.
const insightSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    period: { type: String, enum: ['weekly', 'monthly', 'ondemand'], required: true },
    periodKey: { type: String, required: true }, // 'YYYY-MM-DD' (week start / run date) or 'YYYY-MM'
    periodStart: { type: String, required: true }, // ISO date
    periodEnd: { type: String, required: true }, // ISO date (inclusive)
    label: { type: String, default: '' }, // human label, e.g. "21–27 ביוני"
    result: { type: Object, required: true }, // the structured insight JSON
    model: { type: String, default: '' },
    // Version of the generation prompt this report was produced with. When the
    // prompt improves we bump the code constant, and reports below it are
    // regenerated automatically so fixes reach already-generated reports.
    promptVersion: { type: Number, default: 1 },
    // Grammatical gender the report was written for. If the user changes their
    // gender setting, reports written for the other gender are regenerated.
    gender: { type: String, default: '' },
    seenAt: { type: Date, default: null },
  },
  { timestamps: true, minimize: false }
);

// One report per user per period instance — also the idempotency guard for
// concurrent background generations.
insightSchema.index({ user: 1, period: 1, periodKey: 1 }, { unique: true });

export default mongoose.model('Insight', insightSchema);
