// THE critical integration test: merges must survive recomputeCatalog and live
// capture (the "un-merge bug"). Runs against an ISOLATED database name on the
// same cluster (never the app's real db) and drops it at the end.
// Skipped automatically when MONGODB_URI isn't configured.
// Run from server/:  node --test
import 'dotenv/config';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import Day from '../src/models/Day.js';
import Product from '../src/models/Product.js';
import CatalogItem from '../src/models/CatalogItem.js';
import CatalogMerge from '../src/models/CatalogMerge.js';
import { recomputeCatalog, captureItemsToCatalog, aliasRemap } from '../src/lib/catalog.js';
import { createManualMerge, createManualItem, applyMerge, removeAlias } from '../src/lib/optimizeCatalog.js';

const TEST_DB = 'ketolog_ai_test';
const uri = process.env.MONGODB_URI;
const enabled = Boolean(uri);

const uid = new mongoose.Types.ObjectId();
const egg = (qty) => ({ name: 'ביצה', qty, unit: 'ביצה', carbs: 0.5, fat: 5, protein: 6 });
const hardEgg = (qty) => ({ name: 'ביצה קשה', qty, unit: 'ביצה', carbs: 0.6, fat: 5, protein: 6 });

before(async function () {
  if (!enabled) return;
  // dbName overrides the path db in the URI — everything lands in the test db
  await mongoose.connect(uri, { dbName: TEST_DB });
  assert.equal(mongoose.connection.name, TEST_DB); // hard guard: never the real db
  await mongoose.connection.dropDatabase();
});

after(async function () {
  if (!enabled) return;
  if (mongoose.connection.name === TEST_DB) await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

test('merge persistence: recompute + live capture never undo an applied merge', { skip: !enabled }, async () => {
  // two phrasings of the same food, logged on different days
  await Day.create([
    { user: uid, date: '2026-07-01', meals: [{ desc: '2 ביצים', carbs: 1, items: [egg(2)] }] },
    { user: uid, date: '2026-07-02', meals: [{ desc: 'ביצה קשה, ביצה קשה, ביצה קשה', carbs: 1.8, items: [hardEgg(3)] }] },
  ]);

  let r = await recomputeCatalog();
  assert.equal(r.distinctKeys, 2);
  assert.ok(await CatalogItem.findOne({ key: 'ביצה קשה' }).lean());

  // the admin folds "ביצה קשה" under "ביצה"
  await createManualMerge({ canonicalKey: 'ביצה', phrases: ['ביצה קשה'] });
  let main = await CatalogItem.findOne({ key: 'ביצה' }).lean();
  assert.equal(await CatalogItem.findOne({ key: 'ביצה קשה' }), null); // alias row folded away
  assert.deepEqual(main.aliases, ['ביצה קשה']);
  assert.equal(main.usedCount, 5); // 2 + 3
  assert.equal(main.verified, true);

  // THE critical assertion: a full backfill re-applies the merge instead of undoing it
  r = await recomputeCatalog();
  assert.equal(r.mergesApplied, 1); // the hard-egg item entry (qty 3) was remapped
  main = await CatalogItem.findOne({ key: 'ביצה' }).lean();
  assert.equal(await CatalogItem.findOne({ key: 'ביצה קשה' }), null); // NOT resurrected
  assert.deepEqual(main.aliases, ['ביצה קשה']);
  assert.equal(main.usedCount, 5); // counts folded, not doubled

  // live capture of the alias phrasing bumps the main item, no new row
  await captureItemsToCatalog([hardEgg(2)], 'ביצה קשה', '2026-07-03');
  main = await CatalogItem.findOne({ key: 'ביצה' }).lean();
  assert.equal(main.usedCount, 7);
  assert.equal(await CatalogItem.findOne({ key: 'ביצה קשה' }), null);

  // the resolver's query shape finds the main item by the alias
  const hit = await CatalogItem.findOne({ $or: [{ key: 'ביצה קשה' }, { aliases: 'ביצה קשה' }] }).lean();
  assert.equal(hit.key, 'ביצה');
});

test('manual item: curated values survive a backfill; its rephrases resolve to it', { skip: !enabled }, async () => {
  await createManualItem({
    name: 'טרוביה',
    label: 'ממתיק סטיביה, 0 פחמ׳ לפי חישוב ידני',
    unit: 'שקית',
    carbs: 0,
    fat: 0,
    protein: 0,
    phrases: ['ממתיק טרוביה'],
  });
  let it = await CatalogItem.findOne({ key: 'טרוביה' }).lean();
  assert.equal(it.verified, true);
  assert.deepEqual(it.aliases, ['ממתיק טרוביה']);

  await recomputeCatalog(); // item was never logged — must survive untouched
  it = await CatalogItem.findOne({ key: 'טרוביה' }).lean();
  assert.ok(it, 'manual item survives backfill');
  assert.equal(it.label, 'ממתיק סטיביה, 0 פחמ׳ לפי חישוב ידני'); // curated label preserved
  assert.deepEqual(it.aliases, ['ממתיק טרוביה']);
});

test('multi-select merge under a BRAND-NEW main name seeds it from the top donor', { skip: !enabled }, async () => {
  await Day.create({
    user: uid,
    date: '2026-07-04',
    meals: [
      { desc: 'קפה שחור', carbs: 0, items: [{ name: 'קפה שחור', qty: 4, unit: 'כוס', carbs: 0.2, fat: 0, protein: 0.3 }] },
      { desc: 'אספרסו', carbs: 0, items: [{ name: 'אספרסו', qty: 1, unit: 'כוס', carbs: 0.1, fat: 0, protein: 0.1 }] },
    ],
  });
  await recomputeCatalog();

  // the admin selected both and typed a new main name
  await createManualMerge({ canonicalKey: 'קפה', phrases: ['קפה שחור', 'אספרסו'] });
  const main = await CatalogItem.findOne({ key: 'קפה' }).lean();
  assert.ok(main, 'new main item created');
  assert.equal(main.verified, true);
  assert.equal(main.carbs, 0.2); // seeded from the most-used donor (קפה שחור, 4 uses)
  assert.equal(main.usedCount, 5); // 4 + 1 folded in
  assert.deepEqual(main.aliases.sort(), ['אספרסו', 'קפה שחור']);
  assert.equal(await CatalogItem.findOne({ key: 'קפה שחור' }), null);
  assert.equal(await CatalogItem.findOne({ key: 'אספרסו' }), null);

  // and it survives a backfill under the new name
  await recomputeCatalog();
  const again = await CatalogItem.findOne({ key: 'קפה' }).lean();
  assert.equal(again.usedCount, 5);
  assert.equal(await CatalogItem.findOne({ key: 'קפה שחור' }), null);
});

test('rejected merges never remap; chains flatten to the ultimate canonical', { skip: !enabled }, async () => {
  await CatalogMerge.create({ aliasKey: 'קפה', canonicalKey: 'ביצה', status: 'rejected' });
  const remap = await aliasRemap();
  assert.equal(remap.has('קפה'), false); // rejected → no effect

  // chain: apply "ביצה" itself under "טרוביה" (nonsense food-wise, tests mechanics):
  // old merges pointing at "ביצה" must re-point to the new canonical
  await CatalogMerge.create({ aliasKey: 'ביצה', canonicalKey: 'טרוביה', status: 'pending' });
  const doc = await CatalogMerge.findOne({ aliasKey: 'ביצה' }).lean();
  await applyMerge(doc);
  const remap2 = await aliasRemap();
  assert.equal(remap2.get('ביצה קשה'), 'טרוביה'); // followed the chain, flattened
  assert.equal(remap2.get('ביצה'), 'טרוביה');
});

test('detaching a rephrase frees it: no remap, pulled from the item', { skip: !enabled }, async () => {
  // after the chain test, "ביצה קשה" is an alias riding under "טרוביה"
  const before = await aliasRemap();
  assert.ok(before.has('ביצה קשה'));

  await removeAlias('ביצה קשה');
  const remap = await aliasRemap();
  assert.equal(remap.has('ביצה קשה'), false); // independent again
  const carrier = await CatalogItem.findOne({ aliases: 'ביצה קשה' }).lean();
  assert.equal(carrier, null); // no item lists it anymore

  // logging the freed phrase now creates its own row (no remap in the way)
  await captureItemsToCatalog([hardEgg(1)], 'ביצה קשה', '2026-07-05');
  assert.ok(await CatalogItem.findOne({ key: 'ביצה קשה' }).lean());
});
