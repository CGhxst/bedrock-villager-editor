import { describe, it } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { BedrockDbManager } from "../src/core/bedrockDb";
import { NbtTags, parseBedrockNbt, writeBedrockNbt } from "../src/core/nbtHelper";
import { parseVillagerNbt } from "../src/core/villagerParser";
import { writeVillagerToNbt } from "../src/core/villagerWriter";
import { WorldSession } from "../src/core/session/WorldSession";
import { clonePreservingBinary } from "../src/core/clone";

function createCustomTradeRecipe(buyItemId = "minecraft:custom_ruby", sellItemId = "minecraft:custom_gem") {
  return {
    buyA: NbtTags.compound({
      Name: NbtTags.string(buyItemId),
      Count: NbtTags.byte(10)
    }),
    sell: NbtTags.compound({
      Name: NbtTags.string(sellItemId),
      Count: NbtTags.byte(1)
    }),
    maxUses: NbtTags.int(16),
    uses: NbtTags.int(0),
    traderExp: NbtTags.int(1),
    rewardExp: NbtTags.byte(1),
    priceMultiplierA: NbtTags.float(0.05),
    tier: NbtTags.int(1)
  };
}

describe("V18 Profession Patch Preservation Suite", () => {
  // Section 5: DEFAULT-SOURCE PHANTOM-TAG REGRESSION TEST (Pure NBT Roundtrip)
  it("DEFAULT PROFESSION SOURCE: unrelated edit does not synthesize root Profession for trade-bearing villager", async () => {
    const rawActorNbt = {
      type: "compound",
      name: "",
      value: {
        identifier: NbtTags.string("minecraft:villager_v2"),
        UniqueID: NbtTags.long(1122334455n),
        Pos: NbtTags.list("float", [100.5, 65.0, -200.5]),
        CareerLevel: NbtTags.int(2),
        Offers: {
          type: "compound",
          value: {
            Recipes: NbtTags.list("compound", [createCustomTradeRecipe()])
          }
        },
        SentinelUnknownTag: NbtTags.int(777)
      }
    };

    const parsed = parseVillagerNbt(rawActorNbt, "6163746f7270726566697831", 0);
    assert.ok(parsed);
    assert.strictEqual(parsed.profession, "unemployed");
    assert.strictEqual(parsed.professionSource, "default");
    assert.strictEqual(parsed.trades.length, 1);

    const baseline = clonePreservingBinary(parsed);

    // Perform an unrelated edit (rename)
    parsed.customName = "Renamed Unemployed";

    const writtenNbt = writeVillagerToNbt(parsed, baseline);
    const rootVal = writtenNbt.value || writtenNbt;

    // Assert before encode: zero profession tags synthesized
    assert.strictEqual(rootVal.Profession, undefined);
    assert.strictEqual(rootVal.profession, undefined);
    assert.strictEqual(rootVal.ProfessionName, undefined);
    assert.strictEqual(rootVal.professionName, undefined);
    assert.strictEqual(rootVal.Career, undefined);
    assert.strictEqual(rootVal.career, undefined);
    assert.strictEqual(rootVal.PreferredProfession, undefined);
    assert.strictEqual(rootVal.preferredProfession, undefined);
    assert.strictEqual(rootVal.Offers?.value?.Profession, undefined);
    assert.strictEqual(rootVal.Offers?.value?.profession, undefined);
    assert.strictEqual(rootVal.Offers?.value?.Career, undefined);
    assert.strictEqual(rootVal.Offers?.value?.career, undefined);
    assert.strictEqual(rootVal.Definitions, undefined);
    assert.strictEqual(rootVal.definitions, undefined);
    assert.strictEqual(rootVal.SentinelUnknownTag.value, 777);

    // Encode -> Decode -> Reparse
    const encoded = writeBedrockNbt(writtenNbt, "little");
    const reDecoded = await parseBedrockNbt(encoded);
    const reParsed = parseVillagerNbt(reDecoded.parsed, "6163746f7270726566697831", 0);

    assert.ok(reParsed);
    assert.strictEqual(reParsed.customName, "Renamed Unemployed");
    assert.strictEqual(reParsed.profession, "unemployed");
    assert.strictEqual(reParsed.professionSource, "default");
    assert.strictEqual(reParsed.trades.length, 1);
    assert.strictEqual(reParsed.rawNbt.value.Profession, undefined);
    assert.strictEqual(reParsed.rawNbt.value.SentinelUnknownTag.value, 777);
  });

  // Section 6: INTEGRATED LevelDB SAVE TEST
  it("INTEGRATED LEVELDB: default-source villager rename roundtrip leaves DB record free of stored profession tags", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "prof-default-db-"));
    const worldDir = path.join(tempRoot, "test_world");
    fs.mkdirSync(path.join(worldDir, "db"), { recursive: true });

    const uid = 8899001122n;
    const actorId8 = Buffer.alloc(8);
    actorId8.writeBigInt64LE(uid, 0);
    const actorKey = Buffer.concat([Buffer.from("actorprefix", "utf8"), actorId8]);

    const rawActorNbt = {
      type: "compound",
      name: "",
      value: {
        identifier: NbtTags.string("minecraft:villager_v2"),
        UniqueID: NbtTags.long(uid),
        Pos: NbtTags.list("float", [50.0, 64.0, -50.0]),
        CareerLevel: NbtTags.int(1),
        Offers: {
          type: "compound",
          value: {
            Recipes: NbtTags.list("compound", [createCustomTradeRecipe()])
          }
        },
        SentinelUnknownTag: NbtTags.int(777)
      }
    };

    const actorBytes = writeBedrockNbt(rawActorNbt, "little");

    const mgr = new BedrockDbManager(worldDir);
    const db = await mgr.open(false, true);
    await db.put(actorKey, actorBytes);
    await mgr.close();

    const dump = await mgr.dumpVillagers();
    assert.strictEqual(dump.villagers.length, 1);
    const v = dump.villagers[0];
    assert.ok(v);
    assert.strictEqual(v.profession, "unemployed");
    assert.strictEqual(v.professionSource, "default");

    // Perform rename via WorldSession
    const session = new WorldSession(dump);
    const res = session.executeRequest({
      kind: "PATCH_VILLAGER",
      villagerId: v.sessionVillagerId,
      description: "Rename villager",
      patch: { customName: "Bob The Default" }
    });
    assert.strictEqual(res.success, true);

    const saveRes = await mgr.applyDirtyVillagers(session.getDirtyWrites(), { createBackup: false });
    assert.strictEqual(saveRes.success, true);

    // Reopen and inspect raw bytes directly from LevelDB
    const checkDb = await mgr.open(true);
    const savedBytes = await checkDb.get(actorKey);
    assert.ok(savedBytes);
    const parsedSaved = await parseBedrockNbt(savedBytes);
    const rootVal = parsedSaved.parsed.value || parsedSaved.parsed;

    assert.strictEqual(rootVal.CustomName.value, "Bob The Default");
    assert.strictEqual(rootVal.Profession, undefined);
    assert.strictEqual(rootVal.profession, undefined);
    assert.strictEqual(rootVal.Definitions, undefined);
    assert.strictEqual(rootVal.SentinelUnknownTag.value, 777);
    await mgr.close();

    // Semantic reload verification
    const reloadDump = await mgr.dumpVillagers();
    const reloaded = reloadDump.villagers[0];
    assert.ok(reloaded);
    assert.strictEqual(reloaded.customName, "Bob The Default");
    assert.strictEqual(reloaded.profession, "unemployed");
    assert.strictEqual(reloaded.professionSource, "default");
  });

  // Section 7: TRADE-EDIT VERSION OF THE TEST
  it("TRADE EDIT ON DEFAULT SOURCE: modifying trade properties does not synthesize root Profession tag", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "prof-trade-edit-db-"));
    const worldDir = path.join(tempRoot, "test_world");
    fs.mkdirSync(path.join(worldDir, "db"), { recursive: true });

    const uid = 3344556677n;
    const actorId8 = Buffer.alloc(8);
    actorId8.writeBigInt64LE(uid, 0);
    const actorKey = Buffer.concat([Buffer.from("actorprefix", "utf8"), actorId8]);

    const rawActorNbt = {
      type: "compound",
      name: "",
      value: {
        identifier: NbtTags.string("minecraft:villager_v2"),
        UniqueID: NbtTags.long(uid),
        Pos: NbtTags.list("float", [10.0, 64.0, 10.0]),
        CareerLevel: NbtTags.int(1),
        Offers: {
          type: "compound",
          value: {
            Recipes: NbtTags.list("compound", [createCustomTradeRecipe()])
          }
        },
        SentinelUnknownTag: NbtTags.int(666)
      }
    };

    const actorBytes = writeBedrockNbt(rawActorNbt, "little");

    const mgr = new BedrockDbManager(worldDir);
    const db = await mgr.open(false, true);
    await db.put(actorKey, actorBytes);
    await mgr.close();

    const dump = await mgr.dumpVillagers();
    assert.strictEqual(dump.villagers.length, 1);
    const v = dump.villagers[0];
    assert.ok(v);

    // Perform trade edit: set max uses to 9999 and restock
    const session = new WorldSession(dump);
    session.executeRequest({
      kind: "BULK_SET_MAX_USES",
      villagerIds: [v.sessionVillagerId],
      description: "Set high stock",
      maxUses: 9999
    });
    session.executeRequest({
      kind: "BULK_RESTOCK",
      villagerIds: [v.sessionVillagerId],
      description: "Restock trade"
    });

    const saveRes = await mgr.applyDirtyVillagers(session.getDirtyWrites(), { createBackup: false });
    assert.strictEqual(saveRes.success, true);

    // Verify DB bytes
    const checkDb = await mgr.open(true);
    const savedBytes = await checkDb.get(actorKey);
    assert.ok(savedBytes);
    const parsedSaved = await parseBedrockNbt(savedBytes);
    const rootVal = parsedSaved.parsed.value || parsedSaved.parsed;

    assert.strictEqual(rootVal.Profession, undefined);
    assert.strictEqual(rootVal.profession, undefined);
    assert.strictEqual(rootVal.Definitions, undefined);
    assert.strictEqual(rootVal.SentinelUnknownTag.value, 666);
    assert.strictEqual(rootVal.Offers.value.Recipes.value.value[0].maxUses.value, 9999);
    assert.strictEqual(rootVal.Offers.value.Recipes.value.value[0].uses.value, 0);
    await mgr.close();

    const reloadDump = await mgr.dumpVillagers();
    const reloaded = reloadDump.villagers[0];
    assert.ok(reloaded);
    assert.strictEqual(reloaded.profession, "unemployed");
    assert.strictEqual(reloaded.professionSource, "default");
    assert.strictEqual(reloaded.trades[0]?.maxUses, 9999);
  });

  // Section 8: TradesInferred PRESERVATION TEST
  it("TRADES INFERRED PRESERVATION: unrelated edit preserves inferred profession without synthesizing explicit tag", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "prof-inferred-db-"));
    const worldDir = path.join(tempRoot, "test_world");
    fs.mkdirSync(path.join(worldDir, "db"), { recursive: true });

    const uid = 5566778899n;
    const actorId8 = Buffer.alloc(8);
    actorId8.writeBigInt64LE(uid, 0);
    const actorKey = Buffer.concat([Buffer.from("actorprefix", "utf8"), actorId8]);

    // Trade with paper -> emerald (Librarian signature)
    const librarianRecipe = {
      buyA: NbtTags.compound({
        Name: NbtTags.string("minecraft:paper"),
        Count: NbtTags.byte(24)
      }),
      sell: NbtTags.compound({
        Name: NbtTags.string("minecraft:emerald"),
        Count: NbtTags.byte(1)
      }),
      maxUses: NbtTags.int(16),
      uses: NbtTags.int(0),
      traderExp: NbtTags.int(2),
      rewardExp: NbtTags.byte(1),
      priceMultiplierA: NbtTags.float(0.05),
      tier: NbtTags.int(1)
    };

    const rawActorNbt = {
      type: "compound",
      name: "",
      value: {
        identifier: NbtTags.string("minecraft:villager_v2"),
        UniqueID: NbtTags.long(uid),
        Pos: NbtTags.list("float", [20.0, 64.0, 20.0]),
        CareerLevel: NbtTags.int(1),
        Offers: {
          type: "compound",
          value: {
            Recipes: NbtTags.list("compound", [librarianRecipe])
          }
        },
        SentinelUnknownTag: NbtTags.int(888)
      }
    };

    const actorBytes = writeBedrockNbt(rawActorNbt, "little");

    const mgr = new BedrockDbManager(worldDir);
    const db = await mgr.open(false, true);
    await db.put(actorKey, actorBytes);
    await mgr.close();

    const dump = await mgr.dumpVillagers();
    assert.strictEqual(dump.villagers.length, 1);
    const v = dump.villagers[0];
    assert.ok(v);
    assert.strictEqual(v.profession, "librarian");
    assert.strictEqual(v.professionSource, "TradesInferred");

    // Perform rename
    const session = new WorldSession(dump);
    session.executeRequest({
      kind: "PATCH_VILLAGER",
      villagerId: v.sessionVillagerId,
      description: "Rename inferred librarian",
      patch: { customName: "Learned Librarian" }
    });

    const saveRes = await mgr.applyDirtyVillagers(session.getDirtyWrites(), { createBackup: false });
    assert.strictEqual(saveRes.success, true);

    // Verify DB bytes: NO stored profession tag was synthesized
    const checkDb = await mgr.open(true);
    const savedBytes = await checkDb.get(actorKey);
    assert.ok(savedBytes);
    const parsedSaved = await parseBedrockNbt(savedBytes);
    const rootVal = parsedSaved.parsed.value || parsedSaved.parsed;

    assert.strictEqual(rootVal.CustomName.value, "Learned Librarian");
    assert.strictEqual(rootVal.Profession, undefined);
    assert.strictEqual(rootVal.profession, undefined);
    assert.strictEqual(rootVal.Definitions, undefined);
    assert.strictEqual(rootVal.SentinelUnknownTag.value, 888);
    await mgr.close();

    const reloadDump = await mgr.dumpVillagers();
    const reloaded = reloadDump.villagers[0];
    assert.ok(reloaded);
    assert.strictEqual(reloaded.customName, "Learned Librarian");
    assert.strictEqual(reloaded.profession, "librarian");
    assert.strictEqual(reloaded.professionSource, "TradesInferred");
  });

  // Section 9: WorkstationBlock PRESERVATION TEST
  it("WORKSTATION BLOCK PRESERVATION: unrelated edit preserves workstation-derived profession without synthesizing explicit tag", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "prof-ws-derived-db-"));
    const worldDir = path.join(tempRoot, "test_world");
    fs.mkdirSync(path.join(worldDir, "db"), { recursive: true });

    const uid = 7788990011n;
    const actorId8 = Buffer.alloc(8);
    actorId8.writeBigInt64LE(uid, 0);
    const actorKey = Buffer.concat([Buffer.from("actorprefix", "utf8"), actorId8]);

    const rawActorNbt = {
      type: "compound",
      name: "",
      value: {
        identifier: NbtTags.string("minecraft:villager_v2"),
        UniqueID: NbtTags.long(uid),
        Pos: NbtTags.list("float", [30.0, 64.0, 30.0]),
        DwellerComponent: NbtTags.compound({
          DwellerPositions: NbtTags.list("compound", [
            {
              role: NbtTags.string("jobsite"),
              block_pos: NbtTags.list("int", [35, 64, 35])
            }
          ])
        }),
        SentinelUnknownTag: NbtTags.int(999)
      }
    };

    const actorBytes = writeBedrockNbt(rawActorNbt, "little");

    const mgr = new BedrockDbManager(worldDir);
    const db = await mgr.open(false, true);
    await db.put(actorKey, actorBytes);
    await mgr.close();

    const dump = await mgr.dumpVillagers();
    assert.strictEqual(dump.villagers.length, 1);
    const v = dump.villagers[0];
    assert.ok(v);

    // Perform rename
    const session = new WorldSession(dump);
    session.executeRequest({
      kind: "PATCH_VILLAGER",
      villagerId: v.sessionVillagerId,
      description: "Rename workstation-linked villager",
      patch: { customName: "Scholar" }
    });

    const saveRes = await mgr.applyDirtyVillagers(session.getDirtyWrites(), { createBackup: false });
    assert.strictEqual(saveRes.success, true);

    // Verify DB bytes: NO stored profession tag synthesized
    const checkDb = await mgr.open(true);
    const savedBytes = await checkDb.get(actorKey);
    assert.ok(savedBytes);
    const parsedSaved = await parseBedrockNbt(savedBytes);
    const rootVal = parsedSaved.parsed.value || parsedSaved.parsed;

    assert.strictEqual(rootVal.CustomName.value, "Scholar");
    assert.strictEqual(rootVal.Profession, undefined);
    assert.strictEqual(rootVal.profession, undefined);
    assert.strictEqual(rootVal.Definitions, undefined);
    assert.strictEqual(rootVal.SentinelUnknownTag.value, 999);
    assert.strictEqual(rootVal.DwellerComponent.value.DwellerPositions.value.value.length, 1);
    await mgr.close();
  });

  // Section 10: EXPLICIT PROFESSION CHANGE FROM DEFAULT SOURCE TEST
  it("EXPLICIT PROFESSION EDIT: user-requested profession change creates explicit root Profession tag", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "prof-explicit-change-db-"));
    const worldDir = path.join(tempRoot, "test_world");
    fs.mkdirSync(path.join(worldDir, "db"), { recursive: true });

    const uid = 9900112233n;
    const actorId8 = Buffer.alloc(8);
    actorId8.writeBigInt64LE(uid, 0);
    const actorKey = Buffer.concat([Buffer.from("actorprefix", "utf8"), actorId8]);

    const rawActorNbt = {
      type: "compound",
      name: "",
      value: {
        identifier: NbtTags.string("minecraft:villager_v2"),
        UniqueID: NbtTags.long(uid),
        Pos: NbtTags.list("float", [40.0, 64.0, 40.0]),
        CareerLevel: NbtTags.int(1),
        SentinelUnknownTag: NbtTags.int(555)
      }
    };

    const actorBytes = writeBedrockNbt(rawActorNbt, "little");

    const mgr = new BedrockDbManager(worldDir);
    const db = await mgr.open(false, true);
    await db.put(actorKey, actorBytes);
    await mgr.close();

    const dump = await mgr.dumpVillagers();
    assert.strictEqual(dump.villagers.length, 1);
    const v = dump.villagers[0];
    assert.ok(v);
    assert.strictEqual(v.profession, "unemployed");
    assert.strictEqual(v.professionSource, "default");

    // Explicitly change profession to librarian
    const session = new WorldSession(dump);
    session.executeRequest({
      kind: "PATCH_VILLAGER",
      villagerId: v.sessionVillagerId,
      description: "Promote unemployed to librarian",
      patch: { profession: "librarian" }
    });

    const saveRes = await mgr.applyDirtyVillagers(session.getDirtyWrites(), { createBackup: false });
    assert.strictEqual(saveRes.success, true);

    // Verify DB bytes: explicit root Profession tag was written (numeric ID 5 for librarian)
    const checkDb = await mgr.open(true);
    const savedBytes = await checkDb.get(actorKey);
    assert.ok(savedBytes);
    const parsedSaved = await parseBedrockNbt(savedBytes);
    const rootVal = parsedSaved.parsed.value || parsedSaved.parsed;

    assert.strictEqual(rootVal.Profession.value, 5);
    assert.strictEqual(rootVal.SentinelUnknownTag.value, 555);
    await mgr.close();

    const reloadDump = await mgr.dumpVillagers();
    const reloaded = reloadDump.villagers[0];
    assert.ok(reloaded);
    assert.strictEqual(reloaded.profession, "librarian");
    assert.strictEqual(reloaded.professionSource, "root:Profession");
  });
});
