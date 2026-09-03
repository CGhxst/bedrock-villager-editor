import { describe, it } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { BedrockDbManager } from "../src/core/bedrockDb";
import { createDigpKey } from "../src/core/chunkDigest";
import { NbtTags, writeBedrockNbt } from "../src/core/nbtHelper";
import { ParsedVillager } from "../src/core/types";
import { RestartRequiredStorageError } from "../src/core/storageFatalError";

function createTestVillagerNbt(x: number, y: number, z: number, dimId: number = 0, uniqueId: bigint = 777n) {
  return {
    type: "compound",
    name: "",
    value: {
      identifier: NbtTags.string("minecraft:villager_v2"),
      UniqueID: NbtTags.long(uniqueId),
      Profession: NbtTags.int(1),
      CareerLevel: NbtTags.int(1),
      DimensionId: NbtTags.int(dimId),
      Pos: NbtTags.list("float", [x, y, z])
    }
  };
}

describe("Spatial Chunk Actor Digest (digp) Transaction Safety & Composition", () => {
  it("only mutates digp on real spatial chunk boundary crossing", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "digp-trans-test-"));
    const worldDir = path.join(tempRoot, "world");
    fs.mkdirSync(path.join(worldDir, "db"), { recursive: true });

    const actorId8 = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x03, 0x09]);
    const key = Buffer.concat([Buffer.from("actorprefix", "utf8"), actorId8]);
    const initialNbt = createTestVillagerNbt(100.5, 65.0, -200.5); // chunk (6, -13)
    const val = writeBedrockNbt(initialNbt, "little");

    const mgr = new BedrockDbManager(worldDir);
    const db = await mgr.open(false, true);
    await db.put(key, val);

    const oldDigpKey = createDigpKey(6, -13, "overworld");
    await db.put(oldDigpKey, actorId8);
    await mgr.close();

    // 1. Rename villager without moving position: digp must NOT be written or changed
    const dump1 = await mgr.dumpVillagers();
    assert.strictEqual(dump1.villagerCount, 1);
    const v1 = dump1.villagers[0];
    assert.ok(v1);

    const renamed: ParsedVillager = {
      ...v1,
      customName: "Stationary Trader"
    };

    let digpPuts = 0;
    const mgrSpy = new BedrockDbManager(worldDir, {
      testHooks: {
        beforePut: (putKey) => {
          if (putKey.subarray(0, 4).toString("utf8") === "digp") {
            digpPuts++;
          }
        }
      }
    });

    const res1 = await mgrSpy.applyDirtyVillagers([{ baseline: v1, current: renamed }], { createBackup: false });
    assert.strictEqual(res1.success, true);
    assert.strictEqual(digpPuts, 0, "Zero digp puts performed on rename-only edit");

    const dbCheck1 = await mgr.open(true);
    const digpAfterRename = await dbCheck1.get(oldDigpKey);
    assert.ok(digpAfterRename);
    assert.ok(digpAfterRename.equals(actorId8), "digp preserved without mutation on rename-only edit");
    await mgr.close();

    // 2. Move villager within same chunk (e.g. 100.5 -> 105.5, both chunkX = 6): zero digp puts
    const dumpStep2 = await mgr.dumpVillagers();
    const vStep2 = dumpStep2.villagers[0];
    assert.ok(vStep2);

    const withinChunkMoved: ParsedVillager = {
      ...vStep2,
      position: { x: 105.5, y: 65.0, z: -202.0 }
    };
    digpPuts = 0;
    const resWithin = await mgrSpy.applyDirtyVillagers([{ baseline: vStep2, current: withinChunkMoved }], { createBackup: false });
    assert.strictEqual(resWithin.success, true);
    assert.strictEqual(digpPuts, 0, "Zero digp puts on same-chunk movement");

    // 3. Move villager across chunk boundary: chunk (6, -13) -> chunk (10, 10): Pos (165.0, 65.0, 165.0)
    const dump2 = await mgr.dumpVillagers();
    const v2 = dump2.villagers[0];
    assert.ok(v2);
    const moved: ParsedVillager = {
      ...v2,
      position: { x: 165.0, y: 65.0, z: 165.0 }
    };

    const res2 = await mgr.applyDirtyVillagers([{ baseline: v2, current: moved }], { createBackup: false });
    assert.strictEqual(res2.success, true);

    const dbCheck2 = await mgr.open(true);
    const oldDigpAfterMove = await dbCheck2.get(oldDigpKey);
    assert.ok(oldDigpAfterMove);
    assert.strictEqual(oldDigpAfterMove.length, 0, "Actor removed from old chunk digest");

    const newDigpKey = createDigpKey(10, 10, "overworld");
    const newDigpAfterMove = await dbCheck2.get(newDigpKey);
    assert.ok(newDigpAfterMove);
    assert.ok(newDigpAfterMove.equals(actorId8), "Actor added to new chunk digest");
    await mgr.close();

    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it("fails closed on unsupported custom dimension spatial moves without touching Overworld digp", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "digp-custom-dim-"));
    const worldDir = path.join(tempRoot, "world");
    fs.mkdirSync(path.join(worldDir, "db"), { recursive: true });

    const actorId8 = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x09, 0x99]);
    const key = Buffer.concat([Buffer.from("actorprefix", "utf8"), actorId8]);
    const initialNbt = createTestVillagerNbt(100.5, 65.0, -200.5, 3, 9999n); // DimensionId = 3
    const val = writeBedrockNbt(initialNbt, "little");

    const mgr = new BedrockDbManager(worldDir);
    const db = await mgr.open(false, true);
    await db.put(key, val);

    // Existing overworld digp at (6, -13)
    const owDigpKey = createDigpKey(6, -13, 0);
    const owDigpVal = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01]);
    await db.put(owDigpKey, owDigpVal);
    await mgr.close();

    const dump = await mgr.dumpVillagers();
    assert.strictEqual(dump.villagerCount, 1);
    const v = dump.villagers[0];
    assert.ok(v);
    assert.strictEqual(v.dimensionId, 3);

    const moved: ParsedVillager = {
      ...v,
      position: { x: 200.0, y: 65.0, z: 200.0 }
    };

    await assert.rejects(async () => {
      await mgr.applyDirtyVillagers([{ baseline: v, current: moved }], { createBackup: false });
    }, /Spatial villager moves in DimensionId 3 are not supported/i);

    // Verify DB state: actor and Overworld digp completely untouched
    const verifyDb = await mgr.open(true);
    const actorAfter = await verifyDb.get(key);
    assert.ok(actorAfter && actorAfter.equals(val), "Actor NBT unchanged");

    const owDigpAfter = await verifyDb.get(owDigpKey);
    assert.ok(owDigpAfter && owDigpAfter.equals(owDigpVal), "Overworld digp untouched");
    await mgr.close();

    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it("TWO MOVERS: coalesces removal of two villagers leaving the same chunk in one save", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "digp-two-movers-"));
    const worldDir = path.join(tempRoot, "world");
    fs.mkdirSync(path.join(worldDir, "db"), { recursive: true });

    const unrelatedId = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01]);
    const idA = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x0a]);
    const idB = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x0b]);
    const unrelatedId2 = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x02]);

    const keyA = Buffer.concat([Buffer.from("actorprefix", "utf8"), idA]);
    const keyB = Buffer.concat([Buffer.from("actorprefix", "utf8"), idB]);

    const nbtA = createTestVillagerNbt(100.5, 65.0, 100.5, 0, 10n); // chunk (6, 6)
    const nbtB = createTestVillagerNbt(105.0, 65.0, 105.0, 0, 11n); // chunk (6, 6)

    const mgr = new BedrockDbManager(worldDir);
    const db = await mgr.open(false, true);
    await db.put(keyA, writeBedrockNbt(nbtA, "little"));
    await db.put(keyB, writeBedrockNbt(nbtB, "little"));

    const sharedOldDigpKey = createDigpKey(6, 6, 0);
    const initialDigest = Buffer.concat([unrelatedId, idA, idB, unrelatedId2]);
    await db.put(sharedOldDigpKey, initialDigest);
    await mgr.close();

    const dump = await mgr.dumpVillagers();
    assert.strictEqual(dump.villagerCount, 2);
    const vA = dump.villagers.find(x => x.sessionVillagerId.includes(keyA.toString("hex").slice(-8)))!;
    const vB = dump.villagers.find(x => x.sessionVillagerId.includes(keyB.toString("hex").slice(-8)))!;

    // Move A to chunk (10, 10) and B to chunk (20, 20)
    const movedA: ParsedVillager = { ...vA, position: { x: 165.0, y: 65.0, z: 165.0 } };
    const movedB: ParsedVillager = { ...vB, position: { x: 325.0, y: 65.0, z: 325.0 } };

    const saveRes = await mgr.applyDirtyVillagers([
      { baseline: vA, current: movedA },
      { baseline: vB, current: movedB }
    ], { createBackup: false });

    assert.strictEqual(saveRes.success, true);
    assert.strictEqual(saveRes.modifiedCount, 2);

    const verifyDb = await mgr.open(true);
    const oldDigpAfter = await verifyDb.get(sharedOldDigpKey);
    assert.ok(oldDigpAfter);
    assert.deepStrictEqual(oldDigpAfter, Buffer.concat([unrelatedId, unrelatedId2]), "A and B cleanly removed; unrelated order preserved");

    const digpA = await verifyDb.get(createDigpKey(10, 10, 0));
    assert.ok(digpA && digpA.equals(idA));

    const digpB = await verifyDb.get(createDigpKey(20, 20, 0));
    assert.ok(digpB && digpB.equals(idB));

    await mgr.close();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it("TWO ARRIVALS: coalesces addition of two villagers entering the same new chunk in one save", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "digp-two-arrivals-"));
    const worldDir = path.join(tempRoot, "world");
    fs.mkdirSync(path.join(worldDir, "db"), { recursive: true });

    const unrelatedId = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x99]);
    const idA = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x0a]);
    const idB = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x0b]);

    const keyA = Buffer.concat([Buffer.from("actorprefix", "utf8"), idA]);
    const keyB = Buffer.concat([Buffer.from("actorprefix", "utf8"), idB]);

    const nbtA = createTestVillagerNbt(16.0, 65.0, 16.0, 0, 10n); // chunk (1, 1)
    const nbtB = createTestVillagerNbt(32.0, 65.0, 32.0, 0, 11n); // chunk (2, 2)

    const mgr = new BedrockDbManager(worldDir);
    const db = await mgr.open(false, true);
    await db.put(keyA, writeBedrockNbt(nbtA, "little"));
    await db.put(keyB, writeBedrockNbt(nbtB, "little"));

    // Target chunk (5, 5) initially contains unrelatedId
    const targetDigpKey = createDigpKey(5, 5, 0);
    await db.put(targetDigpKey, unrelatedId);
    await mgr.close();

    const dump = await mgr.dumpVillagers();
    const vA = dump.villagers.find(x => x.sessionVillagerId.includes(keyA.toString("hex").slice(-8)))!;
    const vB = dump.villagers.find(x => x.sessionVillagerId.includes(keyB.toString("hex").slice(-8)))!;

    // Both move into chunk (5, 5)
    const movedA: ParsedVillager = { ...vA, position: { x: 82.0, y: 65.0, z: 82.0 } };
    const movedB: ParsedVillager = { ...vB, position: { x: 85.0, y: 65.0, z: 85.0 } };

    const saveRes = await mgr.applyDirtyVillagers([
      { baseline: vA, current: movedA },
      { baseline: vB, current: movedB }
    ], { createBackup: false });

    assert.strictEqual(saveRes.success, true);

    const verifyDb = await mgr.open(true);
    const targetDigpAfter = await verifyDb.get(targetDigpKey);
    assert.ok(targetDigpAfter);
    assert.deepStrictEqual(targetDigpAfter, Buffer.concat([unrelatedId, idA, idB]), "Both A and B appended to target digest in coalesced write");
    await mgr.close();

    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it("SWAP: two villagers swapping chunks composes old and new digest mutations without conflict", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "digp-swap-"));
    const worldDir = path.join(tempRoot, "world");
    fs.mkdirSync(path.join(worldDir, "db"), { recursive: true });

    const idA = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x0a]);
    const idB = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x0b]);

    const keyA = Buffer.concat([Buffer.from("actorprefix", "utf8"), idA]);
    const keyB = Buffer.concat([Buffer.from("actorprefix", "utf8"), idB]);

    const nbtA = createTestVillagerNbt(16.0, 65.0, 16.0, 0, 10n); // chunk (1, 1)
    const nbtB = createTestVillagerNbt(32.0, 65.0, 32.0, 0, 11n); // chunk (2, 2)

    const mgr = new BedrockDbManager(worldDir);
    const db = await mgr.open(false, true);
    await db.put(keyA, writeBedrockNbt(nbtA, "little"));
    await db.put(keyB, writeBedrockNbt(nbtB, "little"));

    const digp1 = createDigpKey(1, 1, 0);
    const digp2 = createDigpKey(2, 2, 0);
    await db.put(digp1, idA);
    await db.put(digp2, idB);
    await mgr.close();

    const dump = await mgr.dumpVillagers();
    const vA = dump.villagers.find(x => x.sessionVillagerId.includes(keyA.toString("hex").slice(-8)))!;
    const vB = dump.villagers.find(x => x.sessionVillagerId.includes(keyB.toString("hex").slice(-8)))!;

    // Swap: A -> chunk (2, 2), B -> chunk (1, 1)
    const movedA: ParsedVillager = { ...vA, position: { x: 35.0, y: 65.0, z: 35.0 } };
    const movedB: ParsedVillager = { ...vB, position: { x: 18.0, y: 65.0, z: 18.0 } };

    const saveRes = await mgr.applyDirtyVillagers([
      { baseline: vA, current: movedA },
      { baseline: vB, current: movedB }
    ], { createBackup: false });

    assert.strictEqual(saveRes.success, true);

    const verifyDb = await mgr.open(true);
    const digp1After = await verifyDb.get(digp1);
    const digp2After = await verifyDb.get(digp2);

    assert.ok(digp1After && digp1After.equals(idB), "Chunk 1 digest now contains B");
    assert.ok(digp2After && digp2After.equals(idA), "Chunk 2 digest now contains A");
    await mgr.close();

    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it("rolls back all changes and classifies failed-put states properly", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "digp-error-test-"));
    const worldDir = path.join(tempRoot, "world");
    fs.mkdirSync(path.join(worldDir, "db"), { recursive: true });

    const actorId8 = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x04, 0x01]);
    const key = Buffer.concat([Buffer.from("actorprefix", "utf8"), actorId8]);
    const initialNbt = createTestVillagerNbt(100.5, 65.0, -200.5); // chunk (6, -13)
    const val = writeBedrockNbt(initialNbt, "little");

    const mgr = new BedrockDbManager(worldDir);
    const db = await mgr.open(false, true);
    await db.put(key, val);

    const oldDigpKey = createDigpKey(6, -13, "overworld");
    await db.put(oldDigpKey, actorId8);
    await mgr.close();

    const dump = await mgr.dumpVillagers();
    const v = dump.villagers[0];
    assert.ok(v);
    const moved: ParsedVillager = {
      ...v,
      position: { x: 165.0, y: 65.0, z: 165.0 }
    };

    // Instantiate manager with testHooks that fail verification read
    const mgrWithHook = new BedrockDbManager(worldDir, {
      testHooks: {
        beforeVerificationRead: async () => {
          throw new Error("Simulated verification read failure");
        }
      }
    });

    await assert.rejects(async () => {
      await mgrWithHook.applyDirtyVillagers([{ baseline: v, current: moved }], { createBackup: false });
    }, /Simulated verification read failure/);

    // Verify rollback restored actor and old digp
    const dbVerify = await mgr.open(true);
    const actorAfterRollback = await dbVerify.get(key);
    assert.ok(actorAfterRollback);
    assert.ok(actorAfterRollback.equals(val), "Actor NBT rolled back");

    const oldDigpAfterRollback = await dbVerify.get(oldDigpKey);
    assert.ok(oldDigpAfterRollback);
    assert.ok(oldDigpAfterRollback.equals(actorId8), "Old digp restored to original");

    const newDigpKey = createDigpKey(10, 10, "overworld");
    const newDigpAfterRollback = await dbVerify.get(newDigpKey);
    assert.strictEqual(newDigpAfterRollback, null, "New digp key deleted on rollback");

    await mgr.close();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it("malformed digest rejects immediately without modifying actor or digest records", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "digp-malformed-reject-"));
    const worldDir = path.join(tempRoot, "world");
    fs.mkdirSync(path.join(worldDir, "db"), { recursive: true });

    const actorId8 = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x05, 0x01]);
    const key = Buffer.concat([Buffer.from("actorprefix", "utf8"), actorId8]);
    const initialNbt = createTestVillagerNbt(100.5, 65.0, -200.5); // chunk (6, -13)
    const val = writeBedrockNbt(initialNbt, "little");

    const mgr = new BedrockDbManager(worldDir);
    const db = await mgr.open(false, true);
    await db.put(key, val);

    // Seed malformed 5-byte non-8-aligned old digest
    const oldDigpKey = createDigpKey(6, -13, "overworld");
    const malformedBytes = Buffer.from([0xaa, 0xbb, 0xcc, 0xdd, 0xee]);
    await db.put(oldDigpKey, malformedBytes);
    await mgr.close();

    const dump = await mgr.dumpVillagers();
    const v = dump.villagers[0];
    assert.ok(v);
    const moved: ParsedVillager = { ...v, position: { x: 165.0, y: 65.0, z: 165.0 } };

    await assert.rejects(async () => {
      await mgr.applyDirtyVillagers([{ baseline: v, current: moved }], { createBackup: false });
    }, /8-byte aligned/i);

    const verifyDb = await mgr.open(true);
    const actorAfter = await verifyDb.get(key);
    assert.ok(actorAfter && actorAfter.equals(val), "Actor NBT completely untouched");
    const digpAfter = await verifyDb.get(oldDigpKey);
    assert.ok(digpAfter && digpAfter.equals(malformedBytes), "Malformed bytes left uncorrupted");
    await mgr.close();

    fs.rmSync(tempRoot, { recursive: true, force: true });
  });
});
