// Manual catalog duplicate scan from the CLI — same engine as the admin
// panel's "scan now" button. The scan only FILES merge requests (pending);
// nothing merges without approval in the admin UI.
//
// Usage (from the server/ directory):
//   node scripts/optimizeCatalog.js              incremental scan (new items only)
//   node scripts/optimizeCatalog.js --dry-run    print the proposed plan, write nothing
//   node scripts/optimizeCatalog.js --force      re-examine already-scanned clusters too
import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDB } from '../src/db.js';
import CatalogMerge from '../src/models/CatalogMerge.js';
import { runScan } from '../src/lib/optimizeCatalog.js';

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const force = process.argv.includes('--force');
  await connectDB(process.env.MONGODB_URI);

  console.log(`Scanning catalog for duplicates${dryRun ? ' (dry-run)' : ''}${force ? ' (force)' : ''}…`);
  const r = await runScan({ dryRun, force });

  if (r.running) {
    console.log('A scan is already running elsewhere.');
  } else {
    console.log(`✓ Scan done: ${r.clusters} clusters examined, ${r.proposed} new requests, ${r.flagged} items flagged.`);
    if (dryRun && r.plan) {
      console.log('\nProposed plan (NOT written):');
      for (const m of r.plan.merges) {
        console.log(`  ${(m.confidence * 100).toFixed(0).padStart(3)}%  ${m.aliasKeys.join(', ')}  ⇢  ${m.canonicalKey}`);
        if (m.reason) console.log(`        ${m.reason}`);
      }
      for (const f of r.plan.flags) console.log(`  ⚠ ${f.key}: ${f.issue}`);
    }
  }

  const pending = await CatalogMerge.find({ status: 'pending' }).sort({ confidence: -1 }).lean();
  console.log(`\nPending merge requests awaiting approval: ${pending.length}`);
  for (const m of pending.slice(0, 20)) {
    console.log(`  ${(m.confidence * 100).toFixed(0).padStart(3)}%  "${m.aliasKey}" ⇢ "${m.canonicalKey}"`);
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('✗ Scan failed:', err);
  process.exit(1);
});
