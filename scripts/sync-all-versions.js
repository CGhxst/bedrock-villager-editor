const fs = require("fs");
const path = require("path");

function parseVersionSegments(v) {
  return v.split(".").map(part => {
    const num = parseInt(part, 10);
    return isNaN(num) ? 0 : num;
  });
}

function compareVersionsDesc(a, b) {
  const segA = parseVersionSegments(a);
  const segB = parseVersionSegments(b);
  const len = Math.max(segA.length, segB.length);
  for (let i = 0; i < len; i++) {
    const valA = segA[i] || 0;
    const valB = segB[i] || 0;
    if (valA !== valB) {
      return valB - valA; // Descending (newest first)
    }
  }
  return b.localeCompare(a);
}

function buildAssetSelectionMap(baseDataDir, customDestDirs) {
  const destItemsDir = customDestDirs?.destItemsDir || path.join(__dirname, "../public/assets/items");
  const destBlocksDir = customDestDirs?.destBlocksDir || path.join(__dirname, "../public/assets/blocks");

  const rawVersions = fs.existsSync(baseDataDir)
    ? fs.readdirSync(baseDataDir).filter(v => fs.statSync(path.join(baseDataDir, v)).isDirectory())
    : [];
  const versions = rawVersions.sort(compareVersionsDesc);

  const selection = new Map();

  for (const ver of versions) {
    const verDir = path.join(baseDataDir, ver);

    const vItems = path.join(verDir, "items");
    if (fs.existsSync(vItems)) {
      const files = fs.readdirSync(vItems).sort();
      for (const f of files) {
        if (f.endsWith(".png")) {
          const relKey = `items/${f}`;
          if (!selection.has(relKey)) {
            selection.set(relKey, {
              sourcePath: path.join(vItems, f),
              sourceVersion: ver,
              destPath: path.join(destItemsDir, f)
            });
          }
        }
      }
    }

    const vBlocks = path.join(verDir, "blocks");
    if (fs.existsSync(vBlocks)) {
      const files = fs.readdirSync(vBlocks).sort();
      for (const f of files) {
        if (f.endsWith(".png")) {
          const relKey = `blocks/${f}`;
          if (!selection.has(relKey)) {
            selection.set(relKey, {
              sourcePath: path.join(vBlocks, f),
              sourceVersion: ver,
              destPath: path.join(destBlocksDir, f)
            });
          }
        }
      }
    }
  }

  // Special legacy aliases
  const specialCopies = [
    { src: "1.16.4/items/scute.png", destRel: "items/turtle_scute.png", ver: "1.16.4" },
    { src: "1.16.4/items/scute.png", destRel: "items/scute.png", ver: "1.16.4" },
    { src: "1.16.4/items/book_writable.png", destRel: "items/writable_book.png", ver: "1.16.4" },
    { src: "1.16.4/items/book_written.png", destRel: "items/written_book.png", ver: "1.16.4" },
    { src: "1.14.4/items/stone_axe.png", destRel: "items/stone_axe.png", ver: "1.14.4" },
    { src: "1.14.4/items/stone_pickaxe.png", destRel: "items/stone_pickaxe.png", ver: "1.14.4" },
    { src: "1.14.4/items/stone_shovel.png", destRel: "items/stone_shovel.png", ver: "1.14.4" },
    { src: "1.14.4/items/stone_sword.png", destRel: "items/stone_sword.png", ver: "1.14.4" },
    { src: "1.14.4/items/stone_hoe.png", destRel: "items/stone_hoe.png", ver: "1.14.4" },
    { src: "1.14.4/items/spruce_boat.png", destRel: "items/spruce_boat.png", ver: "1.14.4" },
    { src: "1.14.4/items/oak_boat.png", destRel: "items/oak_boat.png", ver: "1.14.4" },
    { src: "1.14.4/items/birch_boat.png", destRel: "items/birch_boat.png", ver: "1.14.4" },
    { src: "1.14.4/items/jungle_boat.png", destRel: "items/jungle_boat.png", ver: "1.14.4" },
    { src: "1.14.4/items/acacia_boat.png", destRel: "items/acacia_boat.png", ver: "1.14.4" },
    { src: "1.14.4/items/dark_oak_boat.png", destRel: "items/dark_oak_boat.png", ver: "1.14.4" },
    { src: "1.14.4/items/rabbit_foot.png", destRel: "items/rabbit_foot.png", ver: "1.14.4" },
    { src: "1.14.4/items/rabbit_hide.png", destRel: "items/rabbit_hide.png", ver: "1.14.4" },
    { src: "1.14.4/items/lead.png", destRel: "items/lead.png", ver: "1.14.4" },
    { src: "1.14.4/items/name_tag.png", destRel: "items/name_tag.png", ver: "1.14.4" },
    { src: "1.14.4/items/saddle.png", destRel: "items/saddle.png", ver: "1.14.4" }
  ];

  for (const sc of specialCopies) {
    const fullSrc = path.join(baseDataDir, sc.src);
    if (fs.existsSync(fullSrc) && !selection.has(sc.destRel)) {
      selection.set(sc.destRel, {
        sourcePath: fullSrc,
        sourceVersion: sc.ver,
        destPath: path.join(customDestDirs?.publicDir || path.join(__dirname, "../public"), "assets", sc.destRel)
      });
    }
  }

  // Supplemental assets for items rendered dynamically in-engine (e.g. Shield entity GUI render)
  const supplementalDir = customDestDirs?.supplementalDir || (!customDestDirs ? path.join(__dirname, "supplemental-assets") : null);
  if (supplementalDir && fs.existsSync(supplementalDir)) {
    const suppItemsDir = path.join(supplementalDir, "items");
    if (fs.existsSync(suppItemsDir)) {
      for (const f of fs.readdirSync(suppItemsDir)) {
        if (f.endsWith(".png")) {
          const relKey = `items/${f}`;
          if (!selection.has(relKey)) {
            selection.set(relKey, {
              sourcePath: path.join(suppItemsDir, f),
              sourceVersion: "official-gui-render",
              destPath: path.join(destItemsDir, f)
            });
          }
        }
      }
    }
  }

  return { selection, versions };
}

function syncAssets(baseDataDir, customDestDirs) {
  const destItemsDir = customDestDirs?.destItemsDir || path.join(__dirname, "../public/assets/items");
  const destBlocksDir = customDestDirs?.destBlocksDir || path.join(__dirname, "../public/assets/blocks");
  const provenanceFile = customDestDirs?.provenanceFile || path.join(__dirname, "../public/assets/asset-provenance.json");

  if (!fs.existsSync(destItemsDir)) fs.mkdirSync(destItemsDir, { recursive: true });
  if (!fs.existsSync(destBlocksDir)) fs.mkdirSync(destBlocksDir, { recursive: true });

  const { selection, versions } = buildAssetSelectionMap(baseDataDir, customDestDirs);

  const provenance = {
    policy: "newest-supported-version-first",
    generatedAt: new Date().toISOString(),
    assets: {}
  };

  let synchronizedCount = 0;

  const sortedKeys = Array.from(selection.keys()).sort();
  for (const relKey of sortedKeys) {
    const entry = selection.get(relKey);
    const destDir = path.dirname(entry.destPath);
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

    let needsWrite = true;
    if (fs.existsSync(entry.destPath)) {
      const srcBuf = fs.readFileSync(entry.sourcePath);
      const dstBuf = fs.readFileSync(entry.destPath);
      if (srcBuf.equals(dstBuf)) {
        needsWrite = false;
      }
    }

    if (needsWrite) {
      fs.copyFileSync(entry.sourcePath, entry.destPath);
      synchronizedCount++;
    }

    provenance.assets[relKey] = { sourceVersion: entry.sourceVersion };
  }

  fs.writeFileSync(provenanceFile, JSON.stringify(provenance, null, 2) + "\n", "utf8");
  return { synchronizedCount, totalAssets: sortedKeys.length, versions };
}

if (require.main === module) {
  const baseDataDir = path.join(__dirname, "../node_modules/minecraft-assets/minecraft-assets/data");
  const result = syncAssets(baseDataDir);
  console.log(`Processed versions: ${result.versions.join(", ")}`);
  console.log(`Finished: synchronized ${result.synchronizedCount} asset(s), total ${result.totalAssets}. Wrote asset-provenance.json (textures sourced through the minecraft-assets package).`);
}

module.exports = {
  parseVersionSegments,
  compareVersionsDesc,
  buildAssetSelectionMap,
  syncAssets
};
