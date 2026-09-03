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

let shouldWrite = true;
if (fs.existsSync(manifestPath)) {
  try {
    const existing = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    if (
      existing &&
      Array.isArray(existing.assets) &&
      existing.assets.length === assets.length &&
      JSON.stringify(existing.assets) === JSON.stringify(assets)
    ) {
      shouldWrite = false;
    }
  } catch {
    shouldWrite = true;
  }
}

if (shouldWrite) {
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
} else {
  console.log(`Asset manifest is up to date (${assets.length} file(s)).`);
}
