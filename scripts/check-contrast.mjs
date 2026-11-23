// Pondside contrast check: reads the tokens from src/index.css and reports the
// WCAG ratio of every text pairing in both themes. Exits non-zero on a failure.
// Run: node scripts/check-contrast.mjs
import { readFileSync } from 'node:fs';
const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
const block = sel => css.slice(css.indexOf(sel), css.indexOf('}', css.indexOf(sel)));
const tokens = sel => Object.fromEntries([...block(sel).matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map(m => [m[1], m[2]]));
const themes = { dark: tokens(':root, [data-theme="dark"] {'), light: tokens('[data-theme="light"] {') };
const lum = hex => { const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4); return .2126 * r + .7152 * g + .0722 * b; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + .05) / (y + .05); };
// [foreground, background, minimum]. --ink-faint is non-text (3:1 as a UI boundary).
const pairs = [
  ...['bg', 'surface', 'raised'].flatMap(bg => [['ink', bg, 4.5], ['ink-dim', bg, 4.5], ['water', bg, 4.5], ['leaf', bg, 4.5], ['gold', bg, 4.5], ['danger', bg, 4.5],
    ...['crimson', 'sapphire', 'emerald', 'amber', 'violet'].map(c => [`color-${c}`, bg, 4.5])]),
  ['gold-ink', 'gold', 4.5], ['bg', 'ink', 4.5], ['bg', 'water', 4.5],
  ['ink-faint', 'bg', 3], ['ink-faint', 'surface', 3], ['water', 'raised', 3],
];
let failed = 0;
for (const [name, t] of Object.entries(themes)) {
  console.log(`\n${name}`);
  for (const [fg, bg, min] of pairs) {
    const r = ratio(t[fg], t[bg]); const ok = r >= min; if (!ok) failed++;
    console.log(`  ${ok ? 'pass' : 'FAIL'}  ${r.toFixed(2).padStart(5)}:1  (min ${min})  --${fg} on --${bg}`);
  }
}
if (failed) { console.error(`\n${failed} pairing(s) below the minimum.`); process.exit(1); }
console.log('\nAll pairings pass.');
