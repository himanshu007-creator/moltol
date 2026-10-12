/** Fails the build when English and Hindi copy drift apart. Run in `prebuild`. */
import { en } from '../src/lib/copy/en.ts';
import { hi } from '../src/lib/copy/hi.ts';

const enKeys = new Set(Object.keys(en));
const hiKeys = new Set(Object.keys(hi));
const errors: string[] = [];

for (const k of enKeys) if (!hiKeys.has(k)) errors.push(`missing in hi: ${k}`);
for (const k of hiKeys) if (!enKeys.has(k)) errors.push(`extra in hi: ${k}`);

const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
for (const k of enKeys) {
  const e = (en as Record<string, string>)[k]!;
  const h = (hi as Record<string, string>)[k];
  if (h === undefined) continue;
  if (vars(e) !== vars(h)) errors.push(`placeholders differ: ${k}`);
  // language names stay in their own script; brands and numerals stay Latin
  const latinOk = ['English'].includes(h) || /^[\d\s₹%.,'"·()-]*$|^(PayPal|MolTol)/.test(h);
  if (!/[\u0900-\u097F]/.test(h) && !latinOk) errors.push(`hi value has no Devanagari: ${k}`);
}

if (errors.length) {
  console.error(`check-copy: ${errors.length} problem(s)\n  ${errors.join('\n  ')}`);
  process.exit(1);
}
console.log(`check-copy ok: ${enKeys.size} keys in en and hi`);
