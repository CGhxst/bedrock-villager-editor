const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const root = path.resolve(__dirname, "..");
const publicDir = path.join(root, "public");
const assetsDir = path.join(publicDir, "assets");
const manifestPath = path.join(publicDir, "asset-manifest.json");

const assets = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
      continue;
    }

    const bytes = fs.readFileSync(full);
    assets.push({
      path: path.relative(publicDir, full).replace(/\\/g, "/"),
      sizeBytes: bytes.length,
      sha256: crypto.createHash("sha256").update(bytes).digest("hex")
    });
  }
}

if (!fs.existsSync(assetsDir)) {
  throw new Error("public/assets directory is missing.");
}

walk(assetsDir);

assets.sort((a, b) => a.path.localeCompare(b.path));

fs.writeFileSync(
  manifestPath,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      assets
    },
    null,
    2
  ) + "\n",
  "utf8"
);

console.log(`Wrote asset manifest with ${assets.length} file(s).`);
