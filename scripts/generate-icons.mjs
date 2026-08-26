/**
 * Converts public/logo.svg → build/icon.png (512px) and build/icon.ico (multi-size).
 * Run once before packaging: npm run generate-icons
 */
import sharp from 'sharp';
import pngToIco from 'png-to-ico';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const svgBuffer = readFileSync(join(root, 'public', 'logo.svg'));
mkdirSync(join(root, 'build'), { recursive: true });

const icoSizes = [16, 32, 48, 64, 128, 256];

/**
 * logo.svg draws a rounded tile inset 16px inside its 512 box, which is right
 * for the mark in the UI and wrong for a home-screen icon: iOS applies its own
 * squircle mask and composites anything transparent onto **white**, so the inset
 * margin and the area outside the corner radius came back as white edges and
 * white corners around the icon.
 *
 * So the installed icons are rendered from a full-bleed variant — same artwork,
 * tile pushed to all four edges with no corner radius — and the platform rounds
 * it. Derived from the one source rather than kept as a second file, so the mark
 * can't drift between them.
 */
const fullBleed = (() => {
  const svg = svgBuffer.toString('utf8');
  const out = svg
    .replace(
      /<rect x="16" y="16" width="480" height="480" rx="112"/,
      '<rect x="0" y="0" width="512" height="512"',
    )
    .replace(
      /<rect x="16" y="16" width="480" height="240" rx="112"/,
      '<rect x="0" y="0" width="512" height="256"',
    );
  if (out === svg) throw new Error('logo.svg no longer has the tile rects this rewrite expects — update generate-icons.mjs.');
  return Buffer.from(out, 'utf8');
})();

console.log('Generating icon sizes:', icoSizes.join(', '), '+ 512px PNG…');

const pngBuffers = await Promise.all(
  icoSizes.map(size =>
    sharp(svgBuffer).resize(size, size).png().toBuffer()
  )
);

// Largest PNG for reference / App.icns on macOS
const png512 = await sharp(svgBuffer).resize(512, 512).png().toBuffer();
writeFileSync(join(root, 'build', 'icon.png'), png512);
console.log('✓ build/icon.png (512px)');

const icoBuffer = await pngToIco(pngBuffers);
writeFileSync(join(root, 'build', 'icon.ico'), icoBuffer);
console.log('✓ build/icon.ico (multi-size)');

// ── PWA icons (public/, so Vite copies them into dist/) ──────────────────────
// The installable web build needs real PNGs at fixed sizes; Android and iOS both
// refuse to install from an SVG alone.
// `.flatten()` guarantees no alpha channel survives: iOS reads any transparency
// in a touch icon as white, which is the whole bug this avoids.
for (const size of [192, 512]) {
  const buf = await sharp(fullBleed).resize(size, size).flatten({ background: '#0a0c12' }).png().toBuffer();
  writeFileSync(join(root, 'public', `pwa-${size}.png`), buf);
  console.log(`✓ public/pwa-${size}.png (full bleed)`);
}

// iOS ignores the manifest for home-screen installs and takes apple-touch-icon
// verbatim at 180×180, rounding the corners itself.
const apple = await sharp(fullBleed).resize(180, 180).flatten({ background: '#0a0c12' }).png().toBuffer();
writeFileSync(join(root, 'public', 'pwa-apple-180.png'), apple);
console.log('✓ public/pwa-apple-180.png (iOS home screen)');

// Maskable variant: Android crops icons to whatever shape the launcher uses, so
// the logo is inset to ~60% on an opaque background. Handing it the plain icon
// would let a circular mask clip the mark's edges.
const inner = await sharp(svgBuffer).resize(320, 320).png().toBuffer();
const maskable = await sharp({
  create: { width: 512, height: 512, channels: 4, background: '#0a0c12' },
})
  .composite([{ input: inner, gravity: 'centre' }])
  .png()
  .toBuffer();
writeFileSync(join(root, 'public', 'pwa-maskable-512.png'), maskable);
console.log('✓ public/pwa-maskable-512.png (safe-zone inset)');

console.log('Done!');
