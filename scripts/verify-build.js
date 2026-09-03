const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const root = path.resolve(__dirname, "..");

const required = [
  "dist/src/electron/main.js",
  "dist/src/main/preload.js",
  "dist/public/index.html",
  "dist/public/app.js",
  "dist/public/icons.js",
  "dist/public/style.css",
  "dist/public/asset-manifest.json",
  "dist/public/assets/items/emerald.png",
  "dist/public/assets/items/book_normal.png",
  "dist/public/assets/items/book_enchanted.png",
  "dist/public/assets/items/bread.png",
  "dist/public/assets/blocks/lectern_top.png"
];

for (const relative of required) {
  const full = path.join(root, relative);

  if (!fs.existsSync(full)) {
    throw new Error(
      `Missing required build artifact: ${relative}`
    );
  }
}

// Verify Asset Manifest Content and Hashes
const manifestFile = path.join(root, "dist/public/asset-manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));

if (!Array.isArray(manifest.assets) || manifest.assets.length === 0) {
  throw new Error("Asset manifest is missing or contains no assets.");
}

for (const asset of manifest.assets) {
  if (!asset.path.startsWith("assets/")) {
    throw new Error(`Asset manifest path does not start with assets/: ${asset.path}`);
  }

  const assetFull = path.join(root, "dist/public", asset.path);
  if (!fs.existsSync(assetFull)) {
    throw new Error(`Manifested asset does not exist on disk: ${asset.path}`);
  }

  const bytes = fs.readFileSync(assetFull);
  if (bytes.length !== asset.sizeBytes) {
    throw new Error(
      `Asset size mismatch for ${asset.path}: expected ${asset.sizeBytes}, got ${bytes.length}`
    );
  }

  const actualSha = crypto.createHash("sha256").update(bytes).digest("hex");
  if (actualSha !== asset.sha256) {
    throw new Error(
      `Asset sha256 mismatch for ${asset.path}: expected ${asset.sha256}, got ${actualSha}`
    );
  }
}

console.log(`Build artifact verification passed. Verified ${manifest.assets.length} assets with SHA-256 integrity.`);
