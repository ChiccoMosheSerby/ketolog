import mongoose from 'mongoose';

// A user-submitted bug report. Name/email are snapshotted at submit time so the
// report stays attributable even if the profile changes later. Screenshots are
// stored inline as small data URLs (the client downscales before uploading).
const bugReportSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, default: '' },
    email: { type: String, required: true },
    description: { type: String, required: true, maxlength: 4000 },
    // data URLs (image/jpeg|png|webp), each already downscaled client-side
    images: { type: [String], default: [] },
    // open → the admin hasn't handled it yet; answered → replied (reply text
    // below, also delivered to the reporter as an in-app message); closed →
    // resolved/won't fix.
    status: { type: String, enum: ['open', 'answered', 'closed'], default: 'open' },
    adminReply: { type: String, default: '' },
    // context the client attaches automatically — helps reproduce UI bugs
    userAgent: { type: String, default: '' },
  },
  { timestamps: true }
);

export default mongoose.model('BugReport', bugReportSchema);
