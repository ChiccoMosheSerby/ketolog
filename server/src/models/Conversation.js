import mongoose from 'mongoose';

// One chat thread with the keto assistant.
// `messages` holds the RAW Anthropic message array (role + content blocks,
// including tool_use / tool_result), so a thread can be replayed to the API
// verbatim on the next turn. The client renders a simplified view derived
// from these blocks server-side.
const conversationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, default: 'שיחה חדשה' },
    messages: { type: [mongoose.Schema.Types.Mixed], default: [] },
    // map of proposal tool_use id -> 'added' | 'cancelled'; keeps confirm-card
    // state across reloads and prevents double-committing the same proposal.
    resolvedActions: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  // minimize:false is REQUIRED. Read tools that take no arguments produce a
  // tool_use block with `input: {}`. With Mongoose's default minimize:true that
  // empty object is stripped on save, so the reloaded thread replays to the
  // Anthropic API as a tool_use with no `input` -> 400 "tool_use.input: Field
  // required", which surfaced to users as "העוזר אינו זמין כרגע".
  { timestamps: true, minimize: false }
);

export default mongoose.model('Conversation', conversationSchema);
