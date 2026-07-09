// Pure-parser tests for the local meal resolver — no DB, no network.
// Run from server/:  node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  splitSegments,
  parseSegment,
  parseMeal,
  buildLookup,
  resolveFromLookup,
} from '../src/lib/mealResolver.js';

test('splitSegments: commas, newlines, plus, standalone vav', () => {
  assert.deepEqual(splitSegments('ביצה, קפה'), ['ביצה', 'קפה']);
  assert.deepEqual(splitSegments('ביצה\nקפה + גבינה'), ['ביצה', 'קפה', 'גבינה']);
  assert.deepEqual(splitSegments('ביצה ו קפה'), ['ביצה', 'קפה']);
  // prefix-vav does NOT split (precision-first: goes to the AI instead)
  assert.deepEqual(splitSegments('ביצה וקפה'), ['ביצה וקפה']);
  assert.deepEqual(splitSegments('נקניקיה, נקניקיה, נקניקיה'), ['נקניקיה', 'נקניקיה', 'נקניקיה']);
});

test('parseSegment: quantities', () => {
  assert.deepEqual(parseSegment('3 ביצים'), { qty: 3, name: 'ביצים', nameKey: 'ביצים', ambiguous: false });
  assert.equal(parseSegment('חצי מלפפון').qty, 0.5);
  assert.equal(parseSegment('רבע אבוקדו').qty, 0.25);
  assert.equal(parseSegment('שתי ביצים').qty, 2);
  assert.equal(parseSegment('ביצה').qty, 1);
  assert.equal(parseSegment('ביצה וחצי').qty, 1.5);
  assert.equal(parseSegment('2ביצים').qty, 2); // digits stuck to letters
  assert.equal(parseSegment('1.5 כף טחינה').qty, 1.5);
});

test('parseSegment: ambiguity → falls back to AI', () => {
  assert.equal(parseSegment('קצת אגוזים').ambiguous, true);
  assert.equal(parseSegment('מלפפון גדול').ambiguous, true);
  assert.equal(parseSegment('100 גרם גבינה').ambiguous, true);
  assert.equal(parseSegment('כמה תותים').ambiguous, true);
  assert.equal(parseSegment('').ambiguous, true);
  // a percent inside a product name is NOT ambiguous ("קוטג' 5%")
  assert.equal(parseSegment("קוטג' 5%").ambiguous, false);
});

test('parseSegment: hyphenated digit stays inside the name ("מ-2")', () => {
  assert.deepEqual(parseSegment('1 חביתה מ-2 ביצים'), {
    qty: 1,
    name: 'חביתה מ-2 ביצים',
    nameKey: 'חביתה מ-2 ביצים',
    ambiguous: false,
  });
});

test('parseSegment: leading connectives stripped', () => {
  assert.equal(parseSegment('עם קפה').name, 'קפה');
  assert.equal(parseSegment('ועוד ביצה').name, 'ביצה');
});

test('parseMeal: ok only when every segment is clean', () => {
  assert.equal(parseMeal('ביצה, קפה').ok, true);
  assert.equal(parseMeal('ביצה, קצת אגוזים').ok, false);
  assert.equal(parseMeal('').ok, false);
});

test('buildLookup: aliases select the main item', () => {
  const egg = { key: 'ביצה', name: 'ביצה', unit: 'ביצה', carbs: 0.5, fat: 5, protein: 6, aliases: ['ביצה קשה', 'ביצים'] };
  const lookup = buildLookup([egg]);
  assert.equal(lookup.get('ביצה'), egg);
  assert.equal(lookup.get('ביצה קשה'), egg);
  assert.equal(lookup.get('ביצים'), egg);
});

test('buildLookup: unit-prefixed variants (singular + plural) select the item', () => {
  const espresso = { key: 'דאבל אספרסו עם טרוביה', name: 'דאבל אספרסו עם טרוביה', unit: 'מנה', carbs: 0 };
  const slice = { key: 'גוש חלב פרוסה', name: 'גוש חלב פרוסה', unit: 'פרוסה', carbs: 0 };
  const lookup = buildLookup([espresso, slice]);
  assert.equal(lookup.get('מנה דאבל אספרסו עם טרוביה'), espresso);
  assert.equal(lookup.get('מנות דאבל אספרסו עם טרוביה'), espresso);
  assert.equal(lookup.get('פרוסה גוש חלב פרוסה'), slice);
  assert.equal(lookup.get('פרוסות גוש חלב פרוסה'), slice);
  // the bare key still works, and an unrelated unit prefix does NOT match
  assert.equal(lookup.get('דאבל אספרסו עם טרוביה'), espresso);
  assert.equal(lookup.get('כוס דאבל אספרסו עם טרוביה'), undefined);
});

test('resolveFromLookup: shortcut-composed meal (unit prefixes, מ-2, plural) resolves without AI', () => {
  const lookup = buildLookup([
    { key: 'קפה שחור עם טרוביה', name: 'קפה שחור עם טרוביה', unit: 'מנה', carbs: 0, fat: 0, protein: 0 },
    { key: 'חביתה מ-2 ביצים', name: 'חביתה מ-2 ביצים', unit: '', carbs: 0.8, fat: 10, protein: 12 },
    { key: 'גוש חלב פרוסה', name: 'גוש חלב פרוסה', unit: 'פרוסה', carbs: 0, fat: 3, protein: 2 },
    { key: 'מלפפון חמוץ', name: 'מלפפון חמוץ', unit: 'מנה', carbs: 1, fat: 0, protein: 0 },
  ]);
  const r = resolveFromLookup(
    'מנה קפה שחור עם טרוביה, 1 חביתה מ-2 ביצים, 3 פרוסות גוש חלב פרוסה, מנה מלפפון חמוץ',
    lookup
  );
  assert.ok(r);
  assert.equal(r.items.length, 4);
  assert.equal(r.items[2].qty, 3);
  assert.equal(r.net_carbs, 1.8); // 0 + 0.8 + 3×0 + 1
  assert.equal(r.fat, 19); // 0 + 10 + 3×3 + 0
});

test('resolveFromLookup: full meal resolves, totals reconcile with breakdown', () => {
  const lookup = buildLookup([
    { key: 'ביצה', name: 'ביצה', unit: 'ביצה', carbs: 0.5, fat: 5, protein: 6, aliases: ['ביצים'] },
    { key: 'קפה שחור', name: 'קפה שחור', unit: 'כוס', carbs: 0, fat: 0, protein: 0.3 },
  ]);
  const r = resolveFromLookup('3 ביצים, קפה שחור', lookup);
  assert.ok(r);
  assert.equal(r.items.length, 2);
  assert.equal(r.items[0].qty, 3);
  assert.equal(r.net_carbs, 1.5); // 3×0.5 + 0
  assert.equal(r.fat, 15);
  assert.equal(r.protein, 18.3);
});

test('resolveFromLookup: ANY unmatched or ambiguous segment → null (no partial serving)', () => {
  const lookup = buildLookup([{ key: 'ביצה', name: 'ביצה', unit: 'ביצה', carbs: 0.5, fat: 5, protein: 6 }]);
  assert.equal(resolveFromLookup('ביצה, סלט ירקות ביתי', lookup), null);
  assert.equal(resolveFromLookup('ביצה גדולה', lookup), null);
  assert.equal(resolveFromLookup('קצת ביצה', lookup), null);
});

test('resolveFromLookup: null fat/protein on an entry keeps totals null (renders "?")', () => {
  const lookup = buildLookup([
    { key: 'ביצה', name: 'ביצה', unit: 'ביצה', carbs: 0.5, fat: null, protein: 6 },
    { key: 'קפה', name: 'קפה', unit: 'כוס', carbs: 0, fat: 0, protein: 0 },
  ]);
  const r = resolveFromLookup('ביצה, קפה', lookup);
  assert.ok(r);
  assert.equal(r.fat, null);
  assert.equal(r.protein, 6);
});
