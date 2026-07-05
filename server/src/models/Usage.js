import mongoose from 'mongoose';

// One row per paid third-party AI call, so the admin can see what each user
// actually costs. Written fire-and-forget from the call sites (see lib/usage.js)
// — a failure to log usage must never break the feature that triggered it.
// Token fields follow the Anthropic `usage` shape (input_tokens is the uncached
// remainder; cache create/read are billed at different rates). `audioSeconds` is
// used only for OpenAI Whisper transcription (priced per minute, not per token).
const usageSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    provider: { type: String, required: true }, // 'anthropic' | 'openai'
    model: { type: String, required: true },
    // What the call was for: estimate_meal | estimate_image | barcode | chat |
    // insight | transcribe. Drives the per-feature cost breakdown.
    kind: { type: String, required: true },
    inputTokens: { type: Number, default: 0 },
    outputTokens: { type: Number, default: 0 },
    cacheCreationTokens: { type: Number, default: 0 },
    cacheReadTokens: { type: Number, default: 0 },
    audioSeconds: { type: Number, default: 0 },
    costUsd: { type: Number, default: 0 }, // computed at write time from the pricing table
  },
  { timestamps: true }
);

// Aggregations always scope by user, usually within a time window (createdAt).
usageSchema.index({ user: 1, createdAt: -1 });

export default mongoose.model('Usage', usageSchema);
