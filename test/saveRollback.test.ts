import assert from "node:assert";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { BedrockDbManager } from "../src/core/bedrockDb";
import { NbtTags, writeBedrockNbt } from "../src/core/nbtHelper";
import { DirtyVillagerWrite, ParsedVillager } from "../src/core/types";
import {
  isRestartRequiredStorageError,
  RestartRequiredStorageError
} from "../src/core/storageFatalError";

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

function createDummyActorRecord(id: string, name: string): { key: Buffer; val: Buffer; nbt: any } {
  const nbt = {
    type: "compound",
    name: "",
    value: {
      identifier: NbtTags.string("minecraft:villager_v2"),
      UniqueID: NbtTags.long(id),
      CustomName: NbtTags.string(name),
      Profession: NbtTags.int(5),
      Pos: NbtTags.list("float", [10, 64, 20]),
      Offers: {
        type: "compound",
        value: {
          Recipes: NbtTags.list("compound", [
            {
              buyA: NbtTags.compound({ Name: NbtTags.string("minecraft:emerald"), Count: NbtTags.byte(24) }),
              sell: NbtTags.compound({ Name: NbtTags.string("minecraft:book"), Count: NbtTags.byte(1) }),
              maxUses: NbtTags.int(16),
              uses: NbtTags.int(0),
              tier: NbtTags.int(1),
              traderExp: NbtTags.int(1),
              rewardExp: NbtTags.byte(1),
              priceMultiplierA: NbtTags.float(0.05)
            }
          ])
        }
      }
    }
  };

  const key = Buffer.from(`actorprefix${id}`, "utf8");
  const val = writeBedrockNbt(nbt, "little");
  return { key, val, nbt };
}

function createParsedVillagerFromRecord(id: string, name: string, record: { key: Buffer; val: Buffer; nbt: any }): ParsedVillager {
  return {
    sessionVillagerId: `v_${id}`,
    dbKeyHex: record.key.toString("hex"),
    originalDbValueHash: sha256(record.val),
    nbtEncoding: { format: "little" },
    identifier: "minecraft:villager_v2",
    customName: name,
    dimension: "overworld",
    dimensionId: 0,
    position: { x: 10, y: 64, z: 20 },
    profession: "librarian",
    professionDisplayName: "Librarian",
    professionKnown: true,
    careerLevel: 1,
    careerLevelName: "Novice",
    experience: 0,
    isCured: false,
    isZombie: false,
    trades: [
      {
        id: "t1",
        tier: 1,
        buyA: { id: "minecraft:emerald", count: 24 },
        buyB: null,
        sell: { id: "minecraft:book", count: 1 },
        maxUses: 16,
        uses: 0,
        traderExp: 1,
        rewardExp: true,
        priceMultiplierA: 0.05,
        rawRecipe: record.nbt.value.Offers.value.Recipes.value.value[0]
      }
    ],
    linkedWorkstation: null,
    linkedBed: null,
    rawNbt: record.nbt
  };
}

test("SAVE ROLLBACK 1: Missing actor record during save throws conflict error", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "rollback-test-1-"));
  const dbDir = path.join(tempDir, "db");
  fs.mkdirSync(dbDir, { recursive: true });

  const manager = new BedrockDbManager(tempDir);
  const db = await manager.open(false, true);
  await manager.close();

  const rec1 = createDummyActorRecord("111", "Villager1");
  const v1 = createParsedVillagerFromRecord("111", "Villager1", rec1);

  const writes: DirtyVillagerWrite[] = [
    { current: { ...v1, customName: "Renamed1" }, baseline: v1 }
  ];

  await assert.rejects(
    async () => {
      await manager.applyDirtyVillagers(writes, { createBackup: false });
    },
    /no longer exists/
  );

  fs.rmSync(tempDir, { recursive: true, force: true });
});

test("SAVE ROLLBACK 2: Live hash mismatch throws pre-save conflict error", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "rollback-test-2-"));
  const dbDir = path.join(tempDir, "db");
  fs.mkdirSync(dbDir, { recursive: true });

  const rec1 = createDummyActorRecord("222", "Villager2");
  const v1 = createParsedVillagerFromRecord("222", "Villager2", rec1);

  const manager = new BedrockDbManager(tempDir);
  const db = await manager.open(false, true);
  await db.put(rec1.key, rec1.val);
  await manager.close();

  // Simulate stale baseline with bad hash
  const staleBaseline: ParsedVillager = {
    ...v1,
    originalDbValueHash: "0000000000000000000000000000000000000000000000000000000000000000"
  };

  const writes: DirtyVillagerWrite[] = [
    { current: { ...v1, customName: "Renamed2" }, baseline: staleBaseline }
  ];

  await assert.rejects(
    async () => {
      await manager.applyDirtyVillagers(writes, { createBackup: false });
    },
    /Save conflict/
  );

  fs.rmSync(tempDir, { recursive: true, force: true });
});

test("SAVE ROLLBACK 3: Forward write failure on second record triggers automatic rollback of first record", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "rollback-test-3-"));
  const dbDir = path.join(tempDir, "db");
  fs.mkdirSync(dbDir, { recursive: true });

  const rec1 = createDummyActorRecord("301", "VillagerA");
  const rec2 = createDummyActorRecord("302", "VillagerB");

  const v1 = createParsedVillagerFromRecord("301", "VillagerA", rec1);
  const v2 = createParsedVillagerFromRecord("302", "VillagerB", rec2);

  const seedManager = new BedrockDbManager(tempDir);
  const db = await seedManager.open(false, true);
  await db.put(rec1.key, rec1.val);
  await db.put(rec2.key, rec2.val);
  await seedManager.close();

  const managerWithHook = new BedrockDbManager(tempDir, {
    testHooks: {
      beforePut: (_key, _val, index) => {
        if (index === 2) {
          throw new Error("Simulated disk error on 2nd write");
        }
      }
    }
  });

  const writes: DirtyVillagerWrite[] = [
    { current: { ...v1, customName: "RenamedA" }, baseline: v1 },
    { current: { ...v2, customName: "RenamedB" }, baseline: v2 }
  ];

  await assert.rejects(
    async () => {
      await managerWithHook.applyDirtyVillagers(writes, { createBackup: false });
    },
    /Simulated disk error on 2nd write/
  );

  // Verify that record 1 was safely rolled back to original bytes and DB is readable
  const verifyManager = new BedrockDbManager(tempDir);
  const checkDb = await verifyManager.open(true, false);
  const readBack1 = await checkDb.get(rec1.key);
  const readBack2 = await checkDb.get(rec2.key);
  await verifyManager.close();

  assert.strictEqual(readBack1?.equals(rec1.val), true, "Record 1 must be reverted to original");
  assert.strictEqual(readBack2?.equals(rec2.val), true, "Record 2 was untouched");

  fs.rmSync(tempDir, { recursive: true, force: true });
});

test("SAVE ROLLBACK 4: Conditional rollback preserves external modifications during conflict", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "rollback-test-4-"));
  const dbDir = path.join(tempDir, "db");
  fs.mkdirSync(dbDir, { recursive: true });

  const rec1 = createDummyActorRecord("401", "VillagerA");
  const rec2 = createDummyActorRecord("402", "VillagerB");

  const v1 = createParsedVillagerFromRecord("401", "VillagerA", rec1);
  const v2 = createParsedVillagerFromRecord("402", "VillagerB", rec2);

  const seedManager = new BedrockDbManager(tempDir);
  const db = await seedManager.open(false, true);
  await db.put(rec1.key, rec1.val);
  await db.put(rec2.key, rec2.val);
  await seedManager.close();

  const externalThirdPartyBytes = Buffer.from("external-third-party-actor-bytes", "utf8");

  // After record 1 is written, record 2 fails to write.
  // When rollback attempts to inspect record 1, simulate an external modifier that replaced record 1 with different bytes.
  let manager: BedrockDbManager;
  manager = new BedrockDbManager(tempDir, {
    testHooks: {
      afterPut: async (_key, _val, index) => {
        if (index === 1) {
          // Simulate concurrent external mutation on record 1
          await (manager as any).db.put(rec1.key, externalThirdPartyBytes);
        }
      },
      beforePut: (_key, _val, index) => {
        if (index === 2) {
          throw new Error("Simulated failure on 2nd write");
        }
      }
    }
  });

  const writes: DirtyVillagerWrite[] = [
    { current: { ...v1, customName: "RenamedA" }, baseline: v1 },
    { current: { ...v2, customName: "RenamedB" }, baseline: v2 }
  ];

  await assert.rejects(
    async () => {
      await manager.applyDirtyVillagers(writes, { createBackup: false });
    },
    /SAVE FAILED AND AUTOMATIC ROLLBACK COULD NOT FULLY RESTORE/
  );

  // Verify external bytes were NOT overwritten by rollback
  const verifyManager = new BedrockDbManager(tempDir);
  const checkDb = await verifyManager.open(true, false);
  const finalVal1 = await checkDb.get(rec1.key);
  await verifyManager.close();

  assert.strictEqual(finalVal1?.equals(externalThirdPartyBytes), true, "External bytes must be preserved");

  fs.rmSync(tempDir, { recursive: true, force: true });
});

test("SAVE LIFECYCLE: preparation failure releases LevelDB handle", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "rollback-test-5-"));
  const dbDir = path.join(tempDir, "db");
  fs.mkdirSync(dbDir, { recursive: true });

  const rec1 = createDummyActorRecord("501", "Villager501");
  const v1 = createParsedVillagerFromRecord("501", "Villager501", rec1);

  const seedManager = new BedrockDbManager(tempDir);
  const db = await seedManager.open(false, true);
  await db.put(rec1.key, rec1.val);
  await seedManager.close();

  const manager = new BedrockDbManager(tempDir, {
    testHooks: {
      afterPreparation: async () => {
        throw new Error("Preparation failure simulated");
      }
    }
  });

  const writes: DirtyVillagerWrite[] = [
    { current: { ...v1, customName: "Renamed501" }, baseline: v1 }
  ];

  await assert.rejects(async () => {
    await manager.applyDirtyVillagers(writes, { createBackup: false });
  }, /Preparation failure simulated/);

  // Assert LevelDB handle was cleanly released and a new manager can immediately open
  const verifyManager = new BedrockDbManager(tempDir);
  const verifyDb = await verifyManager.open(true, false);
  assert.ok(verifyDb);
  const finalVal = await verifyDb.get(rec1.key);
  await verifyManager.close();

  assert.strictEqual(finalVal?.equals(rec1.val), true);
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test("SAVE ROLLBACK 6: Failure during post-save verification rolls back all written keys", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "rollback-test-6-"));
  const dbDir = path.join(tempDir, "db");
  fs.mkdirSync(dbDir, { recursive: true });

  const rec1 = createDummyActorRecord("601", "Villager601");
  const v1 = createParsedVillagerFromRecord("601", "Villager601", rec1);

  const seedManager = new BedrockDbManager(tempDir);
  const db = await seedManager.open(false, true);
  await db.put(rec1.key, rec1.val);
  await seedManager.close();

  const manager = new BedrockDbManager(tempDir, {
    testHooks: {
      beforeSemanticVerify: async () => {
        throw new Error("Verification failure simulated");
      }
    }
  });

  const writes: DirtyVillagerWrite[] = [
    { current: { ...v1, customName: "Renamed601" }, baseline: v1 }
  ];

  await assert.rejects(async () => {
    await manager.applyDirtyVillagers(writes, { createBackup: false });
  }, /Verification failure simulated/);

  // Assert original value is intact after rollback
  const verifyManager = new BedrockDbManager(tempDir);
  const checkDb = await verifyManager.open(true, false);
  const finalVal = await checkDb.get(rec1.key);
  await verifyManager.close();

  assert.strictEqual(finalVal?.equals(rec1.val), true);
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test("SAVE ROLLBACK 7: Successful write with close failure returns success with closeWarning and allows retry", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "rollback-test-7-"));
  const dbDir = path.join(tempDir, "db");
  fs.mkdirSync(dbDir, { recursive: true });

  const rec1 = createDummyActorRecord("701", "Villager701");
  const v1 = createParsedVillagerFromRecord("701", "Villager701", rec1);

  const seedManager = new BedrockDbManager(tempDir);
  const db = await seedManager.open(false, true);
  await db.put(rec1.key, rec1.val);
  await seedManager.close();

  let closeAttempts = 0;
  const manager = new BedrockDbManager(tempDir, {
    testHooks: {
      closeDb: async (dbHandle) => {
        closeAttempts++;
        if (closeAttempts === 1) {
          throw new Error("Injected LevelDB close failure");
        }
        await dbHandle.close();
      }
    }
  });

  const writes: DirtyVillagerWrite[] = [
    { current: { ...v1, customName: "Renamed701" }, baseline: v1 }
  ];

  const result = await manager.applyDirtyVillagers(writes, { createBackup: false });
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.modifiedCount, 1);
  assert.strictEqual(result.verifiedCount, 1);
  assert.ok(result.closeWarning && result.closeWarning.includes("LevelDB reported an error while closing"));
  assert.strictEqual(closeAttempts, 1, "First close attempt failed inside closeDb");

  // Retry close on manager - should succeed on second attempt
  await manager.close();
  assert.strictEqual(closeAttempts, 2, "Second close attempt succeeded");

  // Subsequent clean manager can open same DB
  const cleanManager = new BedrockDbManager(tempDir);
  const cleanDb = await cleanManager.open(true, false);
  assert.ok(cleanDb);
  await cleanManager.close();

  fs.rmSync(tempDir, { recursive: true, force: true });
});

test("SAVE LIFECYCLE: close failure preserves DB handle and allows retry", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "lifecycle-close-test-"));
  const dbDir = path.join(tempDir, "db");
  fs.mkdirSync(dbDir, { recursive: true });

  let closeAttempts = 0;
  const manager = new BedrockDbManager(tempDir, {
    testHooks: {
      closeDb: async (dbHandle) => {
        closeAttempts++;
        if (closeAttempts === 1) {
          throw new Error("Injected direct close error");
        }
        await dbHandle.close();
      }
    }
  });

  await manager.open(false, true);

  await assert.rejects(
    async () => {
      await manager.close();
    },
    /Injected direct close error/
  );

  // Retry close
  await manager.close();
  assert.strictEqual(closeAttempts, 2);

  // New manager can open cleanly
  const newManager = new BedrockDbManager(tempDir);
  const newDb = await newManager.open(true, false);
  assert.ok(newDb);
  await newManager.close();

  fs.rmSync(tempDir, { recursive: true, force: true });
});

test("SAVE ROLLBACK 8: Fatal error when rollback write itself fails (beforeRollbackPut)", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "rollback-test-8-"));
  const dbDir = path.join(tempDir, "db");
  fs.mkdirSync(dbDir, { recursive: true });

  const rec1 = createDummyActorRecord("801", "Villager801");
  const rec2 = createDummyActorRecord("802", "Villager802");

  const v1 = createParsedVillagerFromRecord("801", "Villager801", rec1);
  const v2 = createParsedVillagerFromRecord("802", "Villager802", rec2);

  const seedManager = new BedrockDbManager(tempDir);
  const db = await seedManager.open(false, true);
  await db.put(rec1.key, rec1.val);
  await db.put(rec2.key, rec2.val);
  await seedManager.close();

  const manager = new BedrockDbManager(tempDir, {
    testHooks: {
      beforePut: (_key, _val, index) => {
        if (index === 2) {
          throw new Error("Simulated 2nd forward write failure");
        }
      },
      beforeRollbackPut: (_key, _val) => {
        throw new Error("Simulated rollback write failure");
      }
    }
  });

  const writes: DirtyVillagerWrite[] = [
    { current: { ...v1, customName: "Renamed801" }, baseline: v1 },
    { current: { ...v2, customName: "Renamed802" }, baseline: v2 }
  ];

  await assert.rejects(
    async () => {
      await manager.applyDirtyVillagers(writes, { createBackup: false });
    },
    /SAVE FAILED AND AUTOMATIC ROLLBACK COULD NOT FULLY RESTORE/
  );

  await manager.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test("SAVE ROLLBACK 9: External change before second pre-put check fails as conflict and rolls back first write", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "rollback-test-9-"));
  const dbDir = path.join(tempDir, "db");
  fs.mkdirSync(dbDir, { recursive: true });

  const rec1 = createDummyActorRecord("901", "Villager901");
  const rec2 = createDummyActorRecord("902", "Villager902");

  const v1 = createParsedVillagerFromRecord("901", "Villager901", rec1);
  const v2 = createParsedVillagerFromRecord("902", "Villager902", rec2);

  const seedManager = new BedrockDbManager(tempDir);
  const db = await seedManager.open(false, true);
  await db.put(rec1.key, rec1.val);
  await db.put(rec2.key, rec2.val);
  await seedManager.close();

  const externalActor2Bytes = Buffer.from("external-actor-2-bytes-mutated", "utf8");

  let manager: BedrockDbManager;
  manager = new BedrockDbManager(tempDir, {
    testHooks: {
      beforePrePutCheck: async (_key, index) => {
        if (index === 2) {
          // External process mutates actor 2 immediately before pre-put check
          await (manager as any).db.put(rec2.key, externalActor2Bytes);
        }
      }
    }
  });

  const writes: DirtyVillagerWrite[] = [
    { current: { ...v1, customName: "Renamed901" }, baseline: v1 },
    { current: { ...v2, customName: "Renamed902" }, baseline: v2 }
  ];

  await assert.rejects(
    async () => {
      await manager.applyDirtyVillagers(writes, { createBackup: false });
    },
    /Save conflict: actor .* changed immediately before write/
  );

  // Verify actor 1 was rolled back to original bytes and actor 2 retained external bytes
  const verifyManager = new BedrockDbManager(tempDir);
  const checkDb = await verifyManager.open(true, false);
  const finalVal1 = await checkDb.get(rec1.key);
  const finalVal2 = await checkDb.get(rec2.key);
  await verifyManager.close();

  assert.strictEqual(finalVal1?.equals(rec1.val), true, "Actor 1 rolled back to original");
  assert.strictEqual(finalVal2?.equals(externalActor2Bytes), true, "Actor 2 retained external bytes");

  fs.rmSync(tempDir, { recursive: true, force: true });
});

test("SAVE ROLLBACK 10: Byte readback mismatch triggers conditional rollback and preserves third-party mutation", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "rollback-test-10-"));
  const dbDir = path.join(tempDir, "db");
  fs.mkdirSync(dbDir, { recursive: true });

  const rec1 = createDummyActorRecord("1001", "Villager1001");
  const v1 = createParsedVillagerFromRecord("1001", "Villager1001", rec1);

  const seedManager = new BedrockDbManager(tempDir);
  const db = await seedManager.open(false, true);
  await db.put(rec1.key, rec1.val);
  await seedManager.close();

  const thirdPartyBytes = Buffer.from("third-party-concurrent-mutation", "utf8");

  let manager: BedrockDbManager;
  manager = new BedrockDbManager(tempDir, {
    testHooks: {
      beforeVerificationRead: async (_key) => {
        // External process writes third-party bytes before verification read
        await (manager as any).db.put(rec1.key, thirdPartyBytes);
      }
    }
  });

  const writes: DirtyVillagerWrite[] = [
    { current: { ...v1, customName: "Renamed1001" }, baseline: v1 }
  ];

  await assert.rejects(
    async () => {
      await manager.applyDirtyVillagers(writes, { createBackup: false });
    },
    /SAVE FAILED AND AUTOMATIC ROLLBACK COULD NOT FULLY RESTORE/
  );

  // Assert third-party bytes were NOT overwritten by rollback
  const verifyManager = new BedrockDbManager(tempDir);
  const checkDb = await verifyManager.open(true, false);
  const finalVal = await checkDb.get(rec1.key);
  await verifyManager.close();

  assert.strictEqual(finalVal?.equals(thirdPartyBytes), true, "Third-party bytes preserved");
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test("SAVE WRITE STATE 1: put reports failure after committing editor bytes; item is journaled and rolled back", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "write-state-1-"));
  const dbDir = path.join(tempDir, "db");
  fs.mkdirSync(dbDir, { recursive: true });

  const rec1 = createDummyActorRecord("1101", "Villager1101");
  const v1 = createParsedVillagerFromRecord("1101", "Villager1101", rec1);

  const seedManager = new BedrockDbManager(tempDir);
  const db = await seedManager.open(false, true);
  await db.put(rec1.key, rec1.val);
  await seedManager.close();

  const manager = new BedrockDbManager(tempDir, {
    testHooks: {
      putDb: async (targetDb, key, value, index) => {
        if (index === 1) {
          await targetDb.put(key, value);
          throw new Error("Injected put callback failure after commit");
        }
        await targetDb.put(key, value);
      }
    }
  });

  const writes: DirtyVillagerWrite[] = [
    { current: { ...v1, customName: "Renamed1101" }, baseline: v1 }
  ];

  await assert.rejects(async () => {
    await manager.applyDirtyVillagers(writes, { createBackup: false });
  }, /Injected put callback failure after commit/);

  // Assert rollback successfully restored original bytes
  const verifyManager = new BedrockDbManager(tempDir);
  const checkDb = await verifyManager.open(true, false);
  const finalVal = await checkDb.get(rec1.key);
  await verifyManager.close();

  assert.strictEqual(finalVal?.equals(rec1.val), true, "Original bytes restored by rollback");
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test("SAVE WRITE STATE 2: put failure with original bytes still live remains an ordinary write failure", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "write-state-2-"));
  const dbDir = path.join(tempDir, "db");
  fs.mkdirSync(dbDir, { recursive: true });

  const rec1 = createDummyActorRecord("1201", "Villager1201");
  const v1 = createParsedVillagerFromRecord("1201", "Villager1201", rec1);

  const seedManager = new BedrockDbManager(tempDir);
  const db = await seedManager.open(false, true);
  await db.put(rec1.key, rec1.val);
  await seedManager.close();

  const manager = new BedrockDbManager(tempDir, {
    testHooks: {
      putDb: async () => {
        throw new Error("Injected direct put failure before commit");
      }
    }
  });

  const writes: DirtyVillagerWrite[] = [
    { current: { ...v1, customName: "Renamed1201" }, baseline: v1 }
  ];

  let thrownError: unknown = null;
  try {
    await manager.applyDirtyVillagers(writes, { createBackup: false });
  } catch (error) {
    thrownError = error;
  }

  assert.ok(thrownError);
  assert.strictEqual(isRestartRequiredStorageError(thrownError), false, "Must not be fatal restart required");
  assert.ok((thrownError as Error).message.includes("Injected direct put failure before commit"));

  const verifyManager = new BedrockDbManager(tempDir);
  const checkDb = await verifyManager.open(true, false);
  const finalVal = await checkDb.get(rec1.key);
  await verifyManager.close();

  assert.strictEqual(finalVal?.equals(rec1.val), true, "Original bytes untouched");
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test("SAVE WRITE STATE 3: failed put plus failed verification read is restart-required", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "write-state-3-"));
  const dbDir = path.join(tempDir, "db");
  fs.mkdirSync(dbDir, { recursive: true });

  const rec1 = createDummyActorRecord("1301", "Villager1301");
  const v1 = createParsedVillagerFromRecord("1301", "Villager1301", rec1);

  const seedManager = new BedrockDbManager(tempDir);
  const db = await seedManager.open(false, true);
  await db.put(rec1.key, rec1.val);
  await seedManager.close();

  const manager = new BedrockDbManager(tempDir, {
    testHooks: {
      putDb: async () => {
        throw new Error("Injected put failure");
      },
      readAfterFailedPut: async () => {
        throw new Error("Injected read failure after failed put");
      }
    }
  });

  const writes: DirtyVillagerWrite[] = [
    { current: { ...v1, customName: "Renamed1301" }, baseline: v1 }
  ];

  await assert.rejects(
    async () => {
      await manager.applyDirtyVillagers(writes, { createBackup: false });
    },
    (error: unknown) => {
      assert.ok(isRestartRequiredStorageError(error));
      const fatal = error as RestartRequiredStorageError;
      assert.strictEqual(fatal.code, "SAVE_WRITE_STATE_UNKNOWN");
      return true;
    }
  );

  fs.rmSync(tempDir, { recursive: true, force: true });
});

test("SAVE WRITE STATE 4: failed put followed by third-party bytes preserves external actor and hard-stops", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "write-state-4-"));
  const dbDir = path.join(tempDir, "db");
  fs.mkdirSync(dbDir, { recursive: true });

  const rec1 = createDummyActorRecord("1401", "Villager1401");
  const v1 = createParsedVillagerFromRecord("1401", "Villager1401", rec1);

  const seedManager = new BedrockDbManager(tempDir);
  const db = await seedManager.open(false, true);
  await db.put(rec1.key, rec1.val);
  await seedManager.close();

  const thirdPartyBytes = Buffer.from("concurrent-external-mutation-1401", "utf8");

  const manager = new BedrockDbManager(tempDir, {
    testHooks: {
      putDb: async (targetDb, key) => {
        await targetDb.put(key, thirdPartyBytes);
        throw new Error("Injected put failure");
      }
    }
  });

  const writes: DirtyVillagerWrite[] = [
    { current: { ...v1, customName: "Renamed1401" }, baseline: v1 }
  ];

  await assert.rejects(
    async () => {
      await manager.applyDirtyVillagers(writes, { createBackup: false });
    },
    (error: unknown) => {
      assert.ok(isRestartRequiredStorageError(error));
      const fatal = error as RestartRequiredStorageError;
      assert.strictEqual(fatal.code, "SAVE_WRITE_STATE_UNKNOWN");
      return true;
    }
  );

  const verifyManager = new BedrockDbManager(tempDir);
  const checkDb = await verifyManager.open(true, false);
  const finalVal = await checkDb.get(rec1.key);
  await verifyManager.close();

  assert.strictEqual(finalVal?.equals(thirdPartyBytes), true, "Third-party bytes preserved without rollback overwrite");
  fs.rmSync(tempDir, { recursive: true, force: true });
});
