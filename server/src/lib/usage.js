// AI cost accounting. Every paid call to Anthropic (Claude) or OpenAI (Whisper)
// is priced here and written to the Usage collection, so the admin can see what
// each user costs and decide what to charge. Recording is fire-and-forget: a
// logging failure logs a warning but never propagates, so it can't break the
// feature that made the call.
import Usage from '../models/Usage.js';

// ---- pricing --------------------------------------------------------------
// USD per 1,000,000 tokens. Cache rates follow Anthropic's model: a 5-minute
// ephemeral cache write costs 1.25× base input, a read costs ~0.1× base input.
// The app writes 5-minute cache breakpoints (cache_control: { type:'ephemeral' }
// in chatAgent.js), so `cacheWrite` is the 5-minute rate.
const ANTHROPIC_PRICING = {
  // Claude Opus 4.8 — the model every estimator/chat/insight call runs on.
  'claude-opus-4-8': { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  // Sensible fallbacks so an unknown/renamed model still gets a (rough) cost
  // instead of silently logging $0. Opus-tier pricing is the safe over-estimate.
  default: { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
};

// OpenAI audio transcription — USD per minute of audio.
const OPENAI_AUDIO_PRICING = {
  'whisper-1': 0.006,
  default: 0.006,
};

// Twilio WhatsApp — USD per message. Real Twilio pricing is conversation-based
// and varies by country/message category, so this is a flat per-message estimate
// you tune via env to match your actual bill. Inbound is free on most plans, so
// it defaults to 0 (count it, price it 0) — override if yours charges.
const twilioRate = (kind) =>
  kind === 'whatsapp_out'
    ? Number(process.env.TWILIO_WHATSAPP_OUT_USD ?? 0.005)
    : Number(process.env.TWILIO_WHATSAPP_IN_USD ?? 0);

const per = (table, model) => table[model] || table.default;

// Cost of one Anthropic message from its `usage` block. input_tokens is the
// uncached remainder; cache create/read are separate line items at their own
// rates. Returns USD.
export function anthropicCost(model, usage = {}) {
  const p = per(ANTHROPIC_PRICING, model);
  const input = usage.input_tokens || 0;
  const output = usage.output_tokens || 0;
  const cacheWrite = usage.cache_creation_input_tokens || 0;
  const cacheRead = usage.cache_read_input_tokens || 0;
  return (
    (input * p.input +
      output * p.output +
      cacheWrite * p.cacheWrite +
      cacheRead * p.cacheRead) /
    1_000_000
  );
}

// Cost of one Whisper transcription from its audio duration (seconds). Returns USD.
export function openaiAudioCost(model, seconds = 0) {
  const rate = per(OPENAI_AUDIO_PRICING, model); // per minute
  return (Math.max(0, seconds) / 60) * rate;
}

// Fire-and-forget insert. Never throws — a usage-logging failure must not break
// the AI feature that triggered it. A missing userId (e.g. an anonymous path)
// is skipped rather than written with a null user.
export function recordAnthropicUsage({ userId, kind, model, usage }) {
  if (!userId || !usage) return;
  const doc = {
    user: userId,
    provider: 'anthropic',
    model,
    kind,
    inputTokens: usage.input_tokens || 0,
    outputTokens: usage.output_tokens || 0,
    cacheCreationTokens: usage.cache_creation_input_tokens || 0,
    cacheReadTokens: usage.cache_read_input_tokens || 0,
    costUsd: anthropicCost(model, usage),
  };
  Usage.create(doc).catch((err) => console.warn('usage log failed:', err.message));
}

export function recordOpenAIUsage({ userId, kind, model, seconds }) {
  if (!userId) return;
  Usage.create({
    user: userId,
    provider: 'openai',
    model,
    kind,
    audioSeconds: seconds || 0,
    costUsd: openaiAudioCost(model, seconds || 0),
  }).catch((err) => console.warn('usage log failed:', err.message));
}

// One WhatsApp message (kind: 'whatsapp_out' | 'whatsapp_in'). Attributed to the
// linked user; messages to/from unlinked numbers (no userId) aren't per-user, so
// they're skipped.
export function recordTwilioUsage({ userId, kind }) {
  if (!userId) return;
  Usage.create({
    user: userId,
    provider: 'twilio',
    model: 'whatsapp',
    kind,
    costUsd: twilioRate(kind),
  }).catch((err) => console.warn('usage log failed:', err.message));
}

// Per-user usage report for the admin view. Aggregates all-time cost + a
// per-feature (kind) breakdown, plus a rolling 30-day cost, and joins in each
// user's email. Returns rows sorted by all-time cost, highest first, plus totals.
export async function usageSummary(Usage_ = Usage) {
  const [byKind, last30, users] = await Promise.all([
    Usage_.aggregate([
      {
        $group: {
          _id: { user: '$user', kind: '$kind' },
          costUsd: { $sum: '$costUsd' },
          calls: { $sum: 1 },
          inputTokens: { $sum: '$inputTokens' },
          outputTokens: { $sum: '$outputTokens' },
          cacheCreationTokens: { $sum: '$cacheCreationTokens' },
          cacheReadTokens: { $sum: '$cacheReadTokens' },
        },
      },
    ]),
    Usage_.aggregate([
      { $match: { createdAt: { $gte: new Date(Date.now() - 30 * 864e5) } } },
      { $group: { _id: '$user', costUsd: { $sum: '$costUsd' } } },
    ]),
    // Emails, loaded lazily to avoid a hard import cycle.
    (await import('../models/User.js')).default.find().select('email').lean(),
  ]);

  const emailFor = new Map(users.map((u) => [String(u._id), u.email]));
  const last30For = new Map(last30.map((r) => [String(r._id), r.costUsd]));

  // Fold the (user, kind) rows into one entry per user.
  const perUser = new Map();
  for (const row of byKind) {
    const uid = String(row._id.user);
    if (!perUser.has(uid)) {
      perUser.set(uid, {
        userId: uid,
        email: emailFor.get(uid) || '(משתמש נמחק)',
        costUsd: 0,
        calls: 0,
        cost30d: last30For.get(uid) || 0,
        byKind: {},
      });
    }
    const u = perUser.get(uid);
    u.costUsd += row.costUsd;
    u.calls += row.calls;
    u.byKind[row._id.kind] = {
      costUsd: row.costUsd,
      calls: row.calls,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      cacheCreationTokens: row.cacheCreationTokens,
      cacheReadTokens: row.cacheReadTokens,
    };
  }

  const rows = [...perUser.values()].sort((a, b) => b.costUsd - a.costUsd);
  const totalUsd = rows.reduce((s, r) => s + r.costUsd, 0);
  const total30d = rows.reduce((s, r) => s + r.cost30d, 0);
  return { rows, totalUsd, total30d };
}
