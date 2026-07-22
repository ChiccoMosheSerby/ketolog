// Clone the owner's meals log (Day documents only — no products, templates,
// insights or profile) onto the test account, and wipe it again when done.
// Both emails are hardcoded on purpose: this script can never touch any other
// account's data.
//
// Usage:
//   node scripts/copyMealsLog.js copy   # snapshot SRC's days onto DST (replaces DST's days)
//   node scripts/copyMealsLog.js wipe   # delete all of DST's days
import 'dotenv/config';
import mongoose from 'mongoose';

const SRC_EMAIL = 'chiccomoshe@gmail.com';
const DST_EMAIL = 'chicco2@r2net.com';

const cmd = process.argv[2];
if (!['copy', 'wipe'].includes(cmd)) {
  console.error('usage: node scripts/copyMealsLog.js <copy|wipe>');
  process.exit(1);
}

await mongoose.connect(process.env.MONGODB_URI);
const db = mongoose.connection.db;

async function userIdOf(email) {
  const u = await db.collection('users').findOne({ email });
  if (!u) {
    console.error(`user not found: ${email}${email === DST_EMAIL ? ' — register the account in the app first' : ''}`);
    await mongoose.disconnect();
    process.exit(1);
  }
  return u._id;
}

const dstId = await userIdOf(DST_EMAIL);

if (cmd === 'wipe') {
  const { deletedCount } = await db.collection('days').deleteMany({ user: dstId });
  console.log(`wiped ${deletedCount} days from ${DST_EMAIL}`);
} else {
  const srcId = await userIdOf(SRC_EMAIL);
  const days = await db.collection('days').find({ user: srcId }).sort({ date: 1 }).toArray();
  if (!days.length) {
    console.log(`${SRC_EMAIL} has no days to copy`);
  } else {
    // Replace, don't merge: the copy is a clean snapshot, re-runnable anytime.
    const { deletedCount } = await db.collection('days').deleteMany({ user: dstId });
    const now = new Date();
    const clones = days.map(({ _id, user, createdAt, updatedAt, __v, ...rest }) => ({
      ...rest,
      user: dstId,
      createdAt: now,
      updatedAt: now,
    }));
    await db.collection('days').insertMany(clones);
    const meals = clones.reduce((n, d) => n + (d.meals?.length || 0), 0);
    console.log(
      `copied ${clones.length} days (${meals} meals) ${SRC_EMAIL} → ${DST_EMAIL}` +
        (deletedCount ? ` (replaced ${deletedCount} existing days)` : '')
    );
  }
}

await mongoose.disconnect();
