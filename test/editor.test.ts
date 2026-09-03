import assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import test from "node:test";
import { BedrockDbManager } from "../src/core/bedrockDb";
import { clonePreservingBinary } from "../src/core/clone";
import { NbtTags, parseBedrockNbt, writeBedrockNbt } from "../src/core/nbtHelper";
import { WorldSession } from "../src/core/session/WorldSession";
import { parseVillagerNbt } from "../src/core/villagerParser";
import { writeVillagerToNbt } from "../src/core/villagerWriter";

test("Villager Parser & Lossless Patcher round-trip with enchantments and trades", async () => {
  const rawVillagerNbt = {
    type: "compound",
    name: "",
    value: {
      identifier: NbtTags.string("minecraft:villager_v2"),
      UniqueID: NbtTags.long("1234567890123456"),
      CustomName: NbtTags.string("Test Librarian"),
      Profession: NbtTags.int(5), // librarian
      CareerLevel: NbtTags.int(1),
      TradeExperience: NbtTags.int(10),
      DimensionId: NbtTags.int(0),
      Pos: NbtTags.list("float", [100.5, 64.0, -200.5]),
      UnknownFutureTag: NbtTags.string("preservation_test_value"),
      Offers: NbtTags.compound({
        Recipes: NbtTags.list("compound", [
          {
            buyA: NbtTags.compound({
              Name: NbtTags.string("minecraft:emerald"),
              Count: NbtTags.byte(24),
              Damage: NbtTags.short(0)
            }),
            buyB: NbtTags.compound({
              Name: NbtTags.string("minecraft:book"),
              Count: NbtTags.byte(1),
              Damage: NbtTags.short(0)
            }),
            sell: NbtTags.compound({
              Name: NbtTags.string("minecraft:enchanted_book"),
              Count: NbtTags.byte(1),
              Damage: NbtTags.short(0),
              tag: NbtTags.compound({
                ench: NbtTags.list("compound", [
                  {
                    id: NbtTags.short(26), // Mending
                    lvl: NbtTags.short(1)
                  }
                ])
              })
            }),
            maxUses: NbtTags.int(12),
            uses: NbtTags.int(3),
            tier: NbtTags.int(1),
            traderExp: NbtTags.int(1),
            rewardExp: NbtTags.byte(1),
            priceMultiplierA: NbtTags.float(0.05),
            UnknownRecipeTag: NbtTags.int(42)
          }
        ])
      }),
      DwellerComponent: NbtTags.compound({
        DwellerPositions: NbtTags.list("compound", [
          {
            role: NbtTags.string("jobsite"),
            block_pos: NbtTags.list("int", [102, 64, -201])
          },
          {
            role: NbtTags.string("bed"),
            block_pos: NbtTags.list("int", [98, 64, -195])
          }
        ])
      })
    }
  };

  // 1. Parse into structured model
  const parsed = parseVillagerNbt(rawVillagerNbt, "6163746f727072656669783132333435", 0);
  assert.ok(parsed, "Parsed villager should not be null");
  assert.strictEqual(parsed.profession, "librarian");
  assert.strictEqual(parsed.careerLevel, 1);
  assert.strictEqual(parsed.customName, "Test Librarian");
  assert.strictEqual(parsed.position.x, 100.5);
  assert.strictEqual(parsed.trades.length, 1);
  assert.strictEqual(parsed.trades[0]?.buyA.id, "minecraft:emerald");
  assert.strictEqual(parsed.trades[0]?.buyA.count, 24);
  assert.strictEqual(parsed.trades[0]?.sell.id, "minecraft:enchanted_book");
  assert.strictEqual(parsed.trades[0]?.sell.enchantments?.[0]?.name, "mending");
  assert.strictEqual(parsed.linkedWorkstation?.position.x, 102);
  assert.strictEqual(parsed.linkedBed?.position.x, 98);

  const baseline = clonePreservingBinary(parsed);

  // 2. Modify specific fields
  parsed.trades[0]!.buyA.count = 1;
  parsed.trades[0]!.maxUses = 9999;
  parsed.trades[0]!.uses = 0;
  parsed.careerLevel = 5;
  parsed.experience = 300;
  parsed.linkedWorkstation = {
    type: "minecraft:lectern",
    dimension: "overworld",
    position: { x: 105, y: 65, z: -205 }
  };

  // 3. Write back losslessly to NBT
  const updatedNbt = writeVillagerToNbt(parsed, baseline);
  assert.strictEqual(
    updatedNbt.value.UnknownFutureTag.value,
    "preservation_test_value",
    "Unknown entity tags must survive"
  );
  const firstRecipe = updatedNbt.value.Offers.value.Recipes.value.value[0];
  const firstRecipeVal = firstRecipe.value || firstRecipe;
  assert.strictEqual(
    firstRecipeVal.UnknownRecipeTag.value,
    42,
    "Unknown recipe tags must survive"
  );

  const nbtBytes = writeBedrockNbt(updatedNbt, "little");
  assert.ok(nbtBytes.length > 0, "NBT bytes should be non-empty");

  // 4. Re-parse from raw serialized bytes
  const reParsed = await parseBedrockNbt(nbtBytes);
  const reParsedVillager = parseVillagerNbt(reParsed.parsed, "6163746f727072656669783132333435", 0);
  assert.ok(reParsedVillager, "Re-parsed villager should not be null");
  assert.strictEqual(reParsedVillager.trades[0]?.buyA.count, 1, "Emerald price should now be 1");
  assert.strictEqual(reParsedVillager.trades[0]?.maxUses, 9999, "Max uses should be 9999");
  assert.strictEqual(reParsedVillager.trades[0]?.uses, 0, "Uses should be reset to 0");
  assert.strictEqual(reParsedVillager.careerLevel, 5, "Career level should be 5");
  assert.strictEqual(reParsedVillager.linkedWorkstation?.position.x, 102, "Linked WS X should remain original 102");
});

test("Lossless Patcher correctly clears names and preserves workstation", () => {
  const rawNbt = {
    type: "compound",
    name: "",
    value: {
      identifier: NbtTags.string("minecraft:zombie_villager_v2"),
      CustomName: NbtTags.string("Old Name"),
      NameTag: NbtTags.string("Old Name"),
      ConversionTime: NbtTags.int(120),
      DwellerComponent: NbtTags.compound({
        DwellerPositions: NbtTags.list("compound", [
          { role: NbtTags.string("jobsite"), block_pos: NbtTags.list("int", [10, 60, 20]) }
        ])
      })
    }
  };

  const parsed = parseVillagerNbt(rawNbt, "hex123", 0);
  assert.ok(parsed);
  assert.strictEqual(parsed.isZombie, true);
  assert.strictEqual(parsed.customName, "Old Name");

  const baseline = clonePreservingBinary(parsed);

  // Clear name
  parsed.customName = null;

  const patched = writeVillagerToNbt(parsed, baseline);

  // Assertions:
  assert.strictEqual(patched.value.identifier.value, "minecraft:zombie_villager_v2", "Zombie identifier preserved");
  assert.strictEqual(patched.value.ConversionTime.value, 120, "Conversion time preserved");
  assert.strictEqual(patched.value.CustomName, undefined, "CustomName tag removed when cleared");
  assert.strictEqual(patched.value.NameTag, undefined, "NameTag removed when cleared");
  assert.strictEqual(
    patched.value.DwellerComponent.value.DwellerPositions.value.value.length,
    1,
    "DwellerPositions preserved safely"
  );
});

test("Bedrock LevelDB dump and applyDirtyVillagers round-trip in test world", async () => {
  const testWorldDir = path.join(__dirname, "test_world");
  const testDbDir = path.join(testWorldDir, "db");

  if (fs.existsSync(testWorldDir)) {
    fs.rmSync(testWorldDir, { recursive: true, force: true });
  }
  fs.mkdirSync(testDbDir, { recursive: true });
  fs.writeFileSync(path.join(testWorldDir, "levelname.txt"), "Test Survival World\n", "utf8");

  // Create mock LevelDB with an entity
  const manager = new BedrockDbManager(testWorldDir);
  const db = await manager.open(false, true);

  const mockNbt = {
    type: "compound",
    name: "",
    value: {
      identifier: NbtTags.string("minecraft:villager_v2"),
      UniqueID: NbtTags.long("987654321"),
      CustomName: NbtTags.string("Farmer Joe"),
      Profession: NbtTags.int(1),
      Pos: NbtTags.list("float", [50, 70, 30]),
      Offers: NbtTags.compound({
        Recipes: NbtTags.list("compound", [
          {
            buyA: NbtTags.compound({ Name: NbtTags.string("minecraft:wheat"), Count: NbtTags.byte(20) }),
            sell: NbtTags.compound({ Name: NbtTags.string("minecraft:emerald"), Count: NbtTags.byte(1) }),
            maxUses: NbtTags.int(16),
            uses: NbtTags.int(16) // locked out
          }
        ])
      })
    }
  };

  const key = Buffer.from("actorprefix987654321", "utf8");
  const val = writeBedrockNbt(mockNbt, "little");

  await db.put(key, val);
  await manager.close();

  // 1. Dump villagers
  const dump = await manager.dumpVillagers();
  assert.strictEqual(dump.worldName, "Test Survival World");
  assert.strictEqual(dump.villagerCount, 1);
  assert.strictEqual(dump.villagers[0]?.customName, "Farmer Joe");
  assert.strictEqual(dump.villagers[0]?.profession, "farmer");
  assert.strictEqual(dump.villagers[0]?.trades[0]?.uses, 16);

  // 2. Modify through WorldSession
  const session = new WorldSession(dump);
  const vId = dump.villagers[0]!.sessionVillagerId;
  const tId = dump.villagers[0]!.trades[0]!.id!;

  session.executeRequest({
    kind: "PATCH_VILLAGER",
    description: "Rename to Super Farmer Joe",
    villagerId: vId,
    patch: { customName: "Super Farmer Joe" }
  });

  session.executeRequest({
    kind: "TRADE_RESTOCK",
    description: "Restock uses",
    villagerId: vId,
    tradeId: tId
  });

  session.executeRequest({
    kind: "TRADE_SET_ITEM",
    description: "Cheaper wheat",
    villagerId: vId,
    tradeId: tId,
    slot: "buyA",
    item: { id: "minecraft:wheat", count: 5 }
  });

  // 3. Apply dirty writes
  const result = await manager.applyDirtyVillagers(session.getDirtyWrites(), { createBackup: true });
  assert.strictEqual(result.modifiedCount, 1);
  assert.ok(result.backupPath && fs.existsSync(result.backupPath), "Backup should exist");

  // 4. Re-dump and verify
  const reDump = await manager.dumpVillagers();
  assert.strictEqual(reDump.villagers[0]?.customName, "Super Farmer Joe");
  assert.strictEqual(reDump.villagers[0]?.trades[0]?.uses, 0);
  assert.strictEqual(reDump.villagers[0]?.trades[0]?.buyA.count, 5);

  await manager.close();

  // Cleanup test world
  try {
    fs.rmSync(testWorldDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  } catch {}
  const backupDir = path.join(process.cwd(), "villager_editor_backups");
  if (fs.existsSync(backupDir)) {
    try {
      fs.rmSync(backupDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } catch {}
  }
});
