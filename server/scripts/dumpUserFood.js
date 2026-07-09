// Read-only dump of one user's food data (days+meals, products, templates)
// to a JSON file, as raw material for building the Quick-Add demo DB.
// Usage: node scripts/dumpUserFood.js <email> <outPath>
import 'dotenv/config';
import mongoose from 'mongoose';

const [email, outPath] = process.argv.slice(2);
if (!email || !outPath) {
  console.error('usage: node scripts/dumpUserFood.js <email> <outPath>');
  process.exit(1);
}

await mongoose.connect(process.env.MONGODB_URI);
const db = mongoose.connection.db;

const user = await db.collection('users').findOne({ email });
if (!user) {
  console.error('user not found:', email);
  process.exit(1);
}
const uid = user._id;

const [days, products, templates] = await Promise.all([
  db.collection('days').find({ user: uid }).sort({ date: 1 }).toArray(),
  db.collection('products').find({ user: uid }).toArray(),
  db.collection('mealtemplates').find({ user: uid }).toArray(),
]);

const { writeFileSync } = await import('fs');
writeFileSync(outPath, JSON.stringify({ days, products, templates }, null, 1));
console.log(
  `dumped ${days.length} days (${days.reduce((n, d) => n + (d.meals?.length || 0), 0)} meals), ` +
    `${products.length} products, ${templates.length} templates → ${outPath}`,
);
await mongoose.disconnect();
