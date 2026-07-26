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

console.log('Done!');
