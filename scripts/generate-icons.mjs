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
for (const size of [192, 512]) {
  const buf = await sharp(svgBuffer).resize(size, size).png().toBuffer();
  writeFileSync(join(root, 'public', `pwa-${size}.png`), buf);
  console.log(`✓ public/pwa-${size}.png`);
}

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
