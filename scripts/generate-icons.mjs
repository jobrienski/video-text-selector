#!/usr/bin/env node
// Placeholder icon generator. Renders a flat lavender square with white "VTS"
// text at 16/48/128 px. Replace public/icons/*.png with real artwork any time —
// the manifest just references those file paths.

import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, "..", "public", "icons");

const sizes = [16, 48, 128];

// One-color background matching the selection highlight; high-contrast text.
const BG = "#b496dc"; // ~rgba(180, 150, 220, 1.0) — same hue as the ::selection bar
const FG = "#ffffff";

function svg(size) {
  // Tuned per-size so the "VTS" reads clearly at every scale.
  // At 16px, three letters need to be near-uniform thickness and small.
  const fontPx =
    size >= 96 ? Math.round(size * 0.52)
    : size >= 32 ? Math.round(size * 0.48)
    : Math.round(size * 0.55);
  const weight = size >= 48 ? 700 : 800;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <rect width="${size}" height="${size}" rx="${Math.round(size * 0.15)}" fill="${BG}"/>
    <text x="50%" y="50%" text-anchor="middle" dominant-baseline="central"
      font-family="-apple-system, system-ui, 'Segoe UI', Roboto, sans-serif"
      font-weight="${weight}" font-size="${fontPx}" fill="${FG}"
      letter-spacing="${size >= 48 ? -size * 0.02 : 0}">VTS</text>
  </svg>`;
}

await mkdir(outDir, { recursive: true });

for (const size of sizes) {
  const file = resolve(outDir, `icon${size}.png`);
  await sharp(Buffer.from(svg(size))).png({ compressionLevel: 9 }).toFile(file);
  console.log(`wrote ${file}`);
}

console.log(`\nGenerated ${sizes.length} icons in ${outDir}`);
console.log("Replace these PNGs at any time — the manifest references the same paths.");
