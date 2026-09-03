import { describe, it } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
const { syncAssets } = require(path.join(process.cwd(), "scripts/sync-all-versions"));

describe("Asset Sync Determinism & Idempotence", () => {
  it("selects newest-first deterministically and remains idempotent across multiple runs", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "asset-sync-test-"));
    const fakeDataDir = path.join(tempRoot, "data");
    const fakePublic = path.join(tempRoot, "public");
    const destItems = path.join(fakePublic, "assets", "items");
    const destBlocks = path.join(fakePublic, "assets", "blocks");
    const provenanceFile = path.join(fakePublic, "assets", "asset-provenance.json");

    // Create fake versions: 1.19, 1.20, 1.21
    const v119 = path.join(fakeDataDir, "1.19", "items");
    const v120 = path.join(fakeDataDir, "1.20", "items");
    const v121 = path.join(fakeDataDir, "1.21", "items");
    const v119Blocks = path.join(fakeDataDir, "1.19", "blocks");

    fs.mkdirSync(v119, { recursive: true });
    fs.mkdirSync(v120, { recursive: true });
    fs.mkdirSync(v121, { recursive: true });
    fs.mkdirSync(v119Blocks, { recursive: true });

    // foo.png in 1.20 (bytes A) and 1.21 (bytes B)
    fs.writeFileSync(path.join(v120, "foo.png"), "BYTES_A_1.20");
    fs.writeFileSync(path.join(v121, "foo.png"), "BYTES_B_1.21");

    // bar.png in 1.19 (bytes C)
    fs.writeFileSync(path.join(v119Blocks, "bar.png"), "BYTES_C_1.19");

    const customDestDirs = {
      destItemsDir: destItems,
      destBlocksDir: destBlocks,
      publicDir: fakePublic,
      provenanceFile
    };

    // Pre-populate destination with stale foo.png (BYTES_A_1.20)
    fs.mkdirSync(destItems, { recursive: true });
    fs.writeFileSync(path.join(destItems, "foo.png"), "BYTES_A_1.20");

    // Run 1: Must overwrite stale destination foo.png with 1.21 newest bytes
    const res1 = syncAssets(fakeDataDir, customDestDirs);
    assert.strictEqual(res1.totalAssets, 2);

    const destFoo1 = fs.readFileSync(path.join(destItems, "foo.png"), "utf8");
    assert.strictEqual(destFoo1, "BYTES_B_1.21", "Overwritten with newest 1.21 version");

    const destBar1 = fs.readFileSync(path.join(destBlocks, "bar.png"), "utf8");
    assert.strictEqual(destBar1, "BYTES_C_1.19");

    const prov1 = JSON.parse(fs.readFileSync(provenanceFile, "utf8"));
    assert.strictEqual(prov1.assets["items/foo.png"].sourceVersion, "1.21");
    assert.strictEqual(prov1.assets["blocks/bar.png"].sourceVersion, "1.19");

    // Run 2: Idempotent re-run on unchanged data
    const res2 = syncAssets(fakeDataDir, customDestDirs);
    assert.strictEqual(res2.synchronizedCount, 0, "Zero copies required when destination is up-to-date");
    assert.strictEqual(res2.totalAssets, 2);

    const prov2 = JSON.parse(fs.readFileSync(provenanceFile, "utf8"));
    assert.deepStrictEqual(prov2.assets, prov1.assets, "Provenance map is identical on second run");

    fs.rmSync(tempRoot, { recursive: true, force: true });
  });
});
