// One-time (re-runnable) backfill for the global learned-product catalog.
// Rebuilds CatalogItem from every user's already-stored meal breakdowns.
// Idempotent: each run re-syncs usedCount to the app-wide truth rather than
// adding to it, so it's safe to run repeatedly. Meals with no items[] are skipped.
//
// Usage (from the server/ directory):  node scripts/backfillCatalog.js
import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDB } from '../src/db.js';
import CatalogItem from '../src/models/CatalogItem.js';
import { recomputeCatalog } from '../src/lib/catalog.js';

async function main() {
  await connectDB(process.env.MONGODB_URI);
  const { daysScanned, itemsProcessed, distinctKeys } = await recomputeCatalog();

  const top = await CatalogItem.find({}).sort({ usedCount: -1 }).limit(15).lean();
  console.log(
    `\n✓ Catalog backfill complete: ${daysScanned} days scanned, ` +
      `${itemsProcessed} items processed, ${distinctKeys} distinct products.`
  );
  console.log('\nTop products by usage:');
  for (const p of top) {
    console.log(`  ${String(p.usedCount).padStart(5)}×  ${p.name}`);
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('✗ Backfill failed:', err);
  process.exit(1);
});
