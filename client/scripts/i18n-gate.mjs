// i18n completeness gate. Fails (exit 1) if any Hebrew Unicode (֐–׿)
// remains in client CODE (.js/.jsx/.ts/.tsx) outside a small allow-list of files
// that legitimately contain Hebrew (bilingual detection regexes / date helpers).
// Run: `npm run i18n:check`. Catches UI strings that were never extracted into
// the locale bundles. (Locale JSON files aren't scanned here — their he/en key
// parity is enforced separately when the bundles are built.)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const HEBREW = /[֐-׿]/;

// Code files allowed to contain Hebrew (with a reason). Paths relative to src/.
const ALLOW = new Set([
  'lib/analytics.js', // bilingual coffee-detection regexes need Hebrew patterns
  'lib/helpers.js', // strips the Intl "יום " weekday prefix for the diary label
]);

function walk(dir) {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) out.push(...walk(full));
    else if (/\.(jsx?|tsx?)$/.test(name)) out.push(full);
  }
  return out;
}

const offenders = [];
for (const file of walk(SRC)) {
  const rel = path.relative(SRC, file);
  if (ALLOW.has(rel)) continue;
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (HEBREW.test(line)) offenders.push(`${rel}:${i + 1}: ${line.trim().slice(0, 100)}`);
  });
}

if (offenders.length) {
  console.error(`✗ i18n gate: ${offenders.length} line(s) still contain Hebrew outside locale files:\n`);
  console.error(offenders.join('\n'));
  console.error('\nExtract these into src/locales/{he,en}.json via t(), or add the file to ALLOW with a reason.');
  process.exit(1);
}
console.log('✓ i18n gate: no stray Hebrew in client source.');
