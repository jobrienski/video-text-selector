#!/usr/bin/env node
// Build → zip the dist/ folder into release/video-text-selector-v{version}.zip,
// with manifest.json at the root of the zip (no dist/ wrapper). Suitable for
// uploading directly to the Chrome Web Store Developer Dashboard.

import { createWriteStream } from "node:fs";
import { mkdir, readFile, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// archiver ships as CJS; createRequire is the safest way to load it from an
// ESM script under "type": "module".
const require = createRequire(import.meta.url);
const archiver = require("archiver");

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const distDir = resolve(repoRoot, "dist");
const releaseDir = resolve(repoRoot, "release");

// Verify dist/ exists.
try {
  const s = await stat(resolve(distDir, "manifest.json"));
  if (!s.isFile()) throw new Error("not a file");
} catch {
  console.error("error: dist/manifest.json not found. Run `npm run build` first.");
  process.exit(1);
}

// Read name + version from the built manifest — what ships is what's installed.
const manifest = JSON.parse(await readFile(resolve(distDir, "manifest.json"), "utf8"));
const slug = String(manifest.name)
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-|-$/g, "");
const version = manifest.version;
if (!slug || !version) {
  console.error(`error: manifest missing name or version (name=${manifest.name}, version=${version})`);
  process.exit(1);
}

await mkdir(releaseDir, { recursive: true });
const outPath = resolve(releaseDir, `${slug}-v${version}.zip`);

const output = createWriteStream(outPath);
const archive = archiver("zip", { zlib: { level: 9 } });

const done = new Promise((res, rej) => {
  output.on("close", res);
  archive.on("warning", (err) => (err.code === "ENOENT" ? console.warn(err) : rej(err)));
  archive.on("error", rej);
});

archive.pipe(output);
// `false` makes the contents of dist/ land at the root of the zip (manifest.json
// at top-level, not inside a dist/ subfolder). The Web Store requires this.
archive.directory(distDir, false);
await archive.finalize();
await done;

const finalStat = await stat(outPath);
const sizeMB = (finalStat.size / 1024 / 1024).toFixed(2);
console.log(`Wrote ${outPath}`);
console.log(`  size: ${sizeMB} MB`);
console.log(`  name: ${manifest.name}`);
console.log(`  version: ${version}`);
console.log("\nReady to upload to https://chrome.google.com/webstore/devconsole");
