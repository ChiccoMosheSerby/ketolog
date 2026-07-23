import mongoose from 'mongoose';

// An in-app message for one user: the admin's reply to a bug report, a system
// announcement, or any future update. Shown in the header's messages panel;
// `read` drives the unread badge.
const messageSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, enum: ['bug_reply', 'system', 'update'], default: 'system' },
    title: { type: String, required: true, maxlength: 120 },
    body: { type: String, default: '', maxlength: 4000 },
    read: { type: Boolean, default: false },
    // set when the message answers a specific bug report
    bugReport: { type: mongoose.Schema.Types.ObjectId, ref: 'BugReport' },
  },
  { timestamps: true }
);

// The inbox is always "this user's messages, newest first".
messageSchema.index({ user: 1, createdAt: -1 });

export default mongoose.model('Message', messageSchema);
