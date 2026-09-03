const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const assert = require("node:assert");

const { BedrockDbManager } = require("../dist/src/core/bedrockDb");
const { WorldSession } = require("../dist/src/core/session/WorldSession");
const { NbtTags, writeBedrockNbt } = require("../dist/src/core/nbtHelper");
const { createDigpKey } = require("../dist/src/core/chunkDigest");

async function runSyntheticWorldIntegrationValidation() {
  console.log("=== STARTING SYNTHETIC LEVELDB INTEGRATION VALIDATION ===");

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "synthetic-world-validation-"));
  const worldDir = path.join(tempRoot, "THE_World_SyntheticFixture");
  const dbDir = path.join(worldDir, "db");
  fs.mkdirSync(dbDir, { recursive: true });

  fs.writeFileSync(path.join(worldDir, "levelname.txt"), "The World (Synthetic Test Fixture)\n", "utf8");

  // Create realistic Bedrock LevelDB actors
  const mgr = new BedrockDbManager(worldDir);
  const db = await mgr.open(false, true);

  // Villager 1: Master Librarian with enchanted books and little format
  const v1Nbt = {
    type: "compound",
    name: "",
    value: {
      identifier: NbtTags.string("minecraft:villager_v2"),
      UniqueID: NbtTags.long(9001n),
      CustomName: NbtTags.string("Master Archivist"),
      Profession: NbtTags.int(1), // Librarian
      CareerLevel: NbtTags.int(5),
      TradeExperience: NbtTags.int(250),
      Pos: NbtTags.list("float", [100.5, 65.0, -200.5]),
      DwellerComponent: NbtTags.compound({
        DwellingIDs: NbtTags.list("long", [8888n]),
        PreferredProfession: NbtTags.string("minecraft:librarian"),
        VillageUUID: NbtTags.string("village-1234"),
        DwellerPositions: NbtTags.list("compound", [
          {
            type: NbtTags.string("job_site"),
            block_pos: NbtTags.list("int", [100, 65, -200]),
            dim: NbtTags.int(0),
            block_type: NbtTags.string("minecraft:lectern")
          }
        ])
      }),
      Offers: {
        type: "compound",
        value: {
          Recipes: NbtTags.list("compound", [
            {
              buyA: NbtTags.compound({ Name: NbtTags.string("minecraft:paper"), Count: NbtTags.byte(24) }),
              sell: NbtTags.compound({ Name: NbtTags.string("minecraft:emerald"), Count: NbtTags.byte(1) }),
              maxUses: NbtTags.int(16),
              uses: NbtTags.int(2),
              tier: NbtTags.int(1),
              traderExp: NbtTags.int(2),
              rewardExp: NbtTags.byte(1),
              priceMultiplierA: NbtTags.float(0.05)
            },
            {
              buyA: NbtTags.compound({ Name: NbtTags.string("minecraft:emerald"), Count: NbtTags.byte(32) }),
              buyB: NbtTags.compound({ Name: NbtTags.string("minecraft:book"), Count: NbtTags.byte(1) }),
              sell: NbtTags.compound({
                Name: NbtTags.string("minecraft:enchanted_book"),
                Count: NbtTags.byte(1),
                tag: NbtTags.compound({
                  ench: NbtTags.list("compound", [
                    { id: NbtTags.short(9), lvl: NbtTags.short(5) } // Silk Touch / Efficiency
                  ])
                })
              }),
              maxUses: NbtTags.int(12),
              uses: NbtTags.int(0),
              tier: NbtTags.int(2),
              traderExp: NbtTags.int(5),
              rewardExp: NbtTags.byte(1),
              priceMultiplierA: NbtTags.float(0.2)
            }
          ])
        }
      }
    }
  };

  // Villager 2: Armorer with littleVarint and prefix
  const v2Nbt = {
    type: "compound",
    name: "",
    value: {
      identifier: NbtTags.string("minecraft:villager_v2"),
      UniqueID: { type: "long", value: 9002n },
      Profession: NbtTags.int(4), // Armorer
      CareerLevel: NbtTags.int(2),
      TradeExperience: NbtTags.int(70),
      Pos: NbtTags.list("float", [105.0, 65.0, -195.0]),
      Offers: {
        type: "compound",
        value: {
          Recipes: NbtTags.list("compound", [
            {
              buyA: NbtTags.compound({ Name: NbtTags.string("minecraft:coal"), Count: NbtTags.byte(15) }),
              sell: NbtTags.compound({ Name: NbtTags.string("minecraft:emerald"), Count: NbtTags.byte(1) }),
              maxUses: NbtTags.int(16),
              uses: NbtTags.int(16), // Locked trade
              tier: NbtTags.int(1),
              traderExp: NbtTags.int(2),
              rewardExp: NbtTags.byte(1),
              priceMultiplierA: NbtTags.float(0.05)
            }
          ])
        }
      }
    }
  };

  // Real 19-byte binary actor keys: 11 bytes "actorprefix" + 8-byte int64 actor ID
  const actorId1 = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x23, 0x29]);
  const actorId2 = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x23, 0x2a]);
  const key1 = Buffer.concat([Buffer.from("actorprefix", "utf8"), actorId1]);
  const key2 = Buffer.concat([Buffer.from("actorprefix", "utf8"), actorId2]);

  assert.strictEqual(key1.length, 19, "Actor key 1 must be 19 bytes");
  assert.strictEqual(key2.length, 19, "Actor key 2 must be 19 bytes");

  const val1 = writeBedrockNbt(v1Nbt, "little");

  const rawBody2 = writeBedrockNbt(v2Nbt, "littleVarint");
  const prefix2 = Buffer.from([0x00, 0x00, 0x00, 0x00]);
  const val2 = Buffer.concat([prefix2, rawBody2]);

  await db.put(key1, val1);
  await db.put(key2, val2);

  // Initial digp for chunk (6, -13) containing Pos: (100.5, 65, -200.5)
  const cx1 = Math.floor(100.5 / 16); // 6
  const cz1 = Math.floor(-200.5 / 16); // -13
  const digpKey1 = createDigpKey(cx1, cz1, "overworld");
  await db.put(digpKey1, actorId1);

  await mgr.close();

  console.log("1. Seeded realistic LevelDB world with 2 villagers and initial chunk digest.");

  // Test 1: Dump & Initial Session
  const sessionMgr = new BedrockDbManager(worldDir);
  const dump = await sessionMgr.dumpVillagers();
  assert.strictEqual(dump.villagerCount, 2, "Must dump exactly 2 villagers");
  assert.strictEqual(dump.worldName, "The World (Synthetic Test Fixture)");

  console.log("2. Successfully dumped 2 villagers from LevelDB.");

  const session = new WorldSession(dump);
  assert.strictEqual(session.getDirtyCount(), 0);

  // Test 2: Execute Commands (Restock + Discount + Master Tier + Rename + Unlink + Spatial Move)
  const v1 = session.getVillager(dump.villagers[0].sessionVillagerId);
  const v2 = session.getVillager(dump.villagers[1].sessionVillagerId);
  assert.ok(v1 && v2);

  // Command 1: Restock v2 locked trade
  session.executeRequest({
    kind: "BULK_RESTOCK",
    description: "Restock all trades",
    villagerIds: [v2.sessionVillagerId]
  });

  // Command 2: Bulk cost to 1 for all
  session.executeRequest({
    kind: "BULK_SET_COST_QUANTITY_ONE",
    description: "Set all trade costs to 1",
    villagerIds: [v1.sessionVillagerId, v2.sessionVillagerId]
  });

  // Command 3: Rename v2 and set to Master tier
  session.executeRequest({
    kind: "PATCH_VILLAGER",
    description: "Promote and rename Armorer",
    villagerId: v2.sessionVillagerId,
    patch: { customName: "Grand Armorer", careerLevel: 5 }
  });

  // Command 4: Spatial move of v1 across chunk boundary to chunk (10, -10): Pos (165.0, 70.0, -155.0)
  session.executeRequest({
    kind: "PATCH_VILLAGER",
    description: "Move villager to new chunk",
    villagerId: v1.sessionVillagerId,
    patch: { position: { x: 165.0, y: 70.0, z: -155.0 } }
  });

  assert.strictEqual(session.getDirtyCount(), 2, "Both villagers are dirty");
  console.log("3. Applied 4 transactional session commands including spatial move.");

  // Test 3: Undo / Redo
  session.undo();
  assert.deepStrictEqual(session.getVillager(v1.sessionVillagerId).position, { x: 100.5, y: 65.0, z: -200.5 });
  session.redo();
  assert.deepStrictEqual(session.getVillager(v1.sessionVillagerId).position, { x: 165.0, y: 70.0, z: -155.0 });
  console.log("4. Tested Undo & Redo consistency.");

  // Test 4: Save Preview & Write Conflict Detection
  const preview = session.getSavePreview();
  assert.strictEqual(preview.modifiedVillagersCount, 2);
  const hasConflicts = await sessionMgr.hasWriteConflicts(session.getDirtyWrites());
  assert.strictEqual(hasConflicts, false, "No conflicts before saving");
  console.log("5. Verified Save Preview & zero write conflicts.");

  // Test 5: Save with Backup & Post-Save Byte Verification
  const saveResult = await sessionMgr.applyDirtyVillagers(session.getDirtyWrites(), { createBackup: true });
  assert.strictEqual(saveResult.success, true);
  assert.strictEqual(saveResult.modifiedCount, 2);
  assert.strictEqual(saveResult.verifiedCount, 2);
  assert.ok(saveResult.backupPath, "Backup zip was created");
  console.log("6. Save executed successfully with backup & verification.");

  // Test 6: Reopen and Verify NBT Integrity and chunk digest update
  const verifyDump = await sessionMgr.dumpVillagers();
  const v1Reloaded = verifyDump.villagers.find(x => x.sessionVillagerId === v1.sessionVillagerId);
  const v2Reloaded = verifyDump.villagers.find(x => x.sessionVillagerId === v2.sessionVillagerId);

  assert.strictEqual(v1Reloaded.trades[0].buyA.count, 1, "v1 trade cost discounted to 1");
  assert.ok(v1Reloaded.linkedWorkstation !== null, "v1 workstation remains linked (read-only inspection)");
  assert.deepStrictEqual(v1Reloaded.linkedWorkstation.position, { x: 100, y: 65, z: -200 });
  assert.deepStrictEqual(v1Reloaded.position, { x: 165.0, y: 70.0, z: -155.0 }, "v1 position moved");
  assert.strictEqual(v2Reloaded.customName, "Grand Armorer", "v2 renamed");
  assert.strictEqual(v2Reloaded.careerLevel, 5, "v2 level is Master");
  assert.strictEqual(v2Reloaded.trades[0].uses, 0, "v2 trade uses restocked to 0");
  assert.strictEqual(v2Reloaded.nbtEncoding.format, "littleVarint", "v2 encoding format preserved");
  assert.strictEqual(v2Reloaded.nbtEncoding.prefixHex, "00000000", "v2 4-byte prefix preserved");

  // Verify digp key updates in DB directly
  const verifyDb = await sessionMgr.open(true);
  const oldDigpAfter = await verifyDb.get(digpKey1);
  assert.strictEqual(oldDigpAfter.length, 0, "Old chunk digest has 0 bytes (actor removed)");
  const newDigpKey = createDigpKey(10, -10, "overworld");
  const newDigpAfter = await verifyDb.get(newDigpKey);
  assert.strictEqual(newDigpAfter.length, 8, "New chunk digest has 8 bytes");
  assert.ok(newDigpAfter.equals(actorId1), "New chunk digest contains actor 1 ID");
  await sessionMgr.close();

  console.log("7. Reopened world: Verified all fields, trade recipes, restocks, NBT format, and spatial chunk digest sync.");

  // Test 7: Restore from Backup
  const backupId = sessionMgr.getBackupIdForPath(saveResult.backupPath);
  await sessionMgr.restoreBackupById(backupId);
  console.log("8. Restored world from pre-save backup.");

  const restoredDump = await sessionMgr.dumpVillagers();
  const v1Restored = restoredDump.villagers.find(x => x.sessionVillagerId === v1.sessionVillagerId);
  const v2Restored = restoredDump.villagers.find(x => x.sessionVillagerId === v2.sessionVillagerId);

  assert.strictEqual(v1Restored.trades[0].buyA.count, 24, "v1 original cost restored");
  assert.ok(v1Restored.linkedWorkstation !== null, "v1 original workstation link restored");
  assert.deepStrictEqual(v1Restored.position, { x: 100.5, y: 65.0, z: -200.5 }, "v1 original position restored");
  assert.strictEqual(v2Restored.customName, null, "v2 original un-named state restored");
  assert.strictEqual(v2Restored.careerLevel, 2, "v2 original career level restored");
  assert.strictEqual(v2Restored.trades[0].uses, 16, "v2 original locked trade uses restored");

  // Exact-byte & digest verification of restored database
  const restoredDb = await sessionMgr.open(true);
  const restoredActor1Bytes = await restoredDb.get(key1);
  const restoredActor2Bytes = await restoredDb.get(key2);
  const restoredOldDigpBytes = await restoredDb.get(digpKey1);
  const restoredNewDigpBytes = await restoredDb.get(newDigpKey);

  assert.ok(restoredActor1Bytes && restoredActor1Bytes.equals(val1), "Actor 1 bytes exact pre-save restored");
  assert.ok(restoredActor2Bytes && restoredActor2Bytes.equals(val2), "Actor 2 bytes exact pre-save restored");
  assert.ok(restoredOldDigpBytes && restoredOldDigpBytes.equals(actorId1), "Old digp bytes exact pre-save restored");
  assert.strictEqual(restoredNewDigpBytes, null, "New digp key absent after backup restore");
  await sessionMgr.close();

  console.log("9. Verified full pre-save state (actors + old/new digp digests) accurately restored from zip.");

  // Cleanup
  fs.rmSync(tempRoot, { recursive: true, force: true });
  console.log("=== SYNTHETIC LEVELDB INTEGRATION VALIDATION PASSED ===");
}

runSyntheticWorldIntegrationValidation().catch((err) => {
  console.error("VALIDATION FAILED:", err);
  process.exit(1);
});
