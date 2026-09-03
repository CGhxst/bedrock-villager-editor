import { describe, it } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { BedrockDbManager } from "../src/core/bedrockDb";
import { NbtTags, parseBedrockNbt, writeBedrockNbt } from "../src/core/nbtHelper";
import { ParsedVillager, WorldVillagerDump } from "../src/core/types";
import { WorldSession } from "../src/core/session/WorldSession";
import { toVillagerViewModel } from "../src/core/viewModel";

function createMockDump(villagers: ParsedVillager[]): WorldVillagerDump {
  return {
    worldName: "test-world",
    worldPath: "/test",
    exportedAt: new Date().toISOString(),
    villagerCount: villagers.length,
    summary: {
      byProfession: {},
      withTrades: 0,
      withoutWorkstation: 0,
      zombies: 0,
      cured: 0
    },
    villagers
  };
}

function createActorWithDwellerPositions(
  uid: bigint,
  wsPos?: [number, number, number],
  bedPos?: [number, number, number]
) {
  const positions: any[] = [];
  if (wsPos) {
    positions.push({
      role: NbtTags.string("jobsite"),
      block_pos: NbtTags.list("int", wsPos),
      custom_tag: NbtTags.string("preserve_ws_dweller_tag")
    });
  }
  if (bedPos) {
    positions.push({
      role: NbtTags.string("bed"),
      block_pos: NbtTags.list("int", bedPos),
      custom_tag: NbtTags.string("preserve_bed_dweller_tag")
    });
  }

  return {
    type: "compound",
    name: "",
    value: {
      identifier: NbtTags.string("minecraft:villager_v2"),
      UniqueID: NbtTags.long(uid),
      Pos: NbtTags.list("float", [100.5, 65.0, -200.5]),
      Profession: NbtTags.int(1),
      CareerLevel: NbtTags.int(2),
      DwellerComponent: {
        type: "compound",
        name: "DwellerComponent",
        value: {
          DwellerPositions: NbtTags.list("compound", positions),
          VillageID: { type: "byteArray", value: [1, 2, 3, 4] }
        }
      }
    }
  };
}

function createPoiRecordNbt(villagerId: bigint, wsPos: [number, number, number], bedPos: [number, number, number]) {
  return {
    type: "compound",
    name: "",
    value: {
      POI: NbtTags.list("compound", [
        {
          VillagerID: NbtTags.long(villagerId),
          instances: NbtTags.list("compound", [
            {
              Skip: NbtTags.byte(0),
              Type: NbtTags.int(2), // Workstation
              X: NbtTags.int(wsPos[0]),
              Y: NbtTags.int(wsPos[1]),
              Z: NbtTags.int(wsPos[2]),
              Name: NbtTags.string("minecraft:lectern")
            },
            {
              Skip: NbtTags.byte(0),
              Type: NbtTags.int(0), // Bed
              X: NbtTags.int(bedPos[0]),
              Y: NbtTags.int(bedPos[1]),
              Z: NbtTags.int(bedPos[2]),
              Name: NbtTags.string("minecraft:bed")
            }
          ])
        }
      ])
    }
  };
}

describe("Inspection-Only Village POI & Actor-NBT Link Suite", () => {
  // 1. POI Links Read-Only Discovery
  it("POI LINKS READ-ONLY: discovers links for inspection and performs zero POI writes on save", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "poi-readonly-test-"));
    const worldDir = path.join(tempRoot, "test_world");
    fs.mkdirSync(path.join(worldDir, "db"), { recursive: true });

    const uid = 123456789n;
    const actorId8 = Buffer.alloc(8);
    actorId8.writeBigInt64LE(uid, 0);
    const actorKey = Buffer.concat([Buffer.from("actorprefix", "utf8"), actorId8]);

    const rawActorNbt = {
      type: "compound",
      name: "",
      value: {
        identifier: NbtTags.string("minecraft:villager_v2"),
        UniqueID: NbtTags.long(uid),
        Pos: NbtTags.list("float", [100.5, 65.0, -200.5]),
        Profession: NbtTags.int(1),
        CareerLevel: NbtTags.int(2),
        CustomName: NbtTags.string("PoiVillager")
      }
    };

    const actorBytes = writeBedrockNbt(rawActorNbt, "little");
    const poiKey = Buffer.from("VILLAGE_0_POI", "utf8");
    const poiBytes = writeBedrockNbt(createPoiRecordNbt(uid, [10, 64, 20], [15, 64, 25]), "little");

    let poiPuts = 0;
    let poiDeletes = 0;

    const mgr = new BedrockDbManager(worldDir, {
      testHooks: {
        beforePut: (key) => {
          const kStr = key.toString("utf8");
          if (kStr.startsWith("VILLAGE_") && kStr.endsWith("_POI")) {
            poiPuts++;
          }
        }
      }
    });

    const db = await mgr.open(false, true);
    await db.put(actorKey, actorBytes);
    await db.put(poiKey, poiBytes);
    await mgr.close();

    const dump = await mgr.dumpVillagers();
    assert.strictEqual(dump.villagers.length, 1);
    const v = dump.villagers[0];
    assert.ok(v);

    // 1. Verify discovered link metadata
    assert.ok(v.linkedWorkstation);
    assert.deepStrictEqual(v.linkedWorkstation.position, { x: 10, y: 64, z: 20 });
    assert.strictEqual(v.workstationLinkSource, "village_poi");

    assert.ok(v.linkedBed);
    assert.deepStrictEqual(v.linkedBed.position, { x: 15, y: 64, z: 25 });
    assert.strictEqual(v.bedLinkSource, "village_poi");

    // Verify ViewModel representation
    const vm = toVillagerViewModel(v, false);
    assert.strictEqual(vm.workstationLinkSource, "village_poi");
    assert.strictEqual(vm.bedLinkSource, "village_poi");

    // Perform an allowed unrelated edit (e.g. rename)
    const session = new WorldSession(createMockDump([v]));
    const renameRes = session.executeRequest({
      kind: "PATCH_VILLAGER",
      villagerId: v.sessionVillagerId,
      description: "Rename villager",
      patch: { customName: "RenamedPoiVillager" }
    });
    assert.strictEqual(renameRes.success, true);

    const writes = session.getDirtyWrites();
    const saveRes = await mgr.applyDirtyVillagers(writes, { createBackup: false });
    assert.strictEqual(saveRes.success, true);

    // 2. Verify DB bytes: POI unchanged and zero POI writes occurred
    const checkDb = await mgr.open(true);
    const livePoi = await checkDb.get(poiKey);
    assert.ok(livePoi && livePoi.equals(poiBytes), "POI bytes unchanged");
    assert.strictEqual(poiPuts, 0, "Zero POI puts occurred");
    assert.strictEqual(poiDeletes, 0, "Zero POI deletes occurred");
    await mgr.close();
  });

  // Duplicate Actor Link Regression Test
  it("DUPLICATE ACTOR LINKS: preserves multiple workstation entries, bed entry, list order, and custom tags on unrelated edit", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "duplicate-actor-link-"));
    const worldDir = path.join(tempRoot, "test_world");
    fs.mkdirSync(path.join(worldDir, "db"), { recursive: true });

    const uid = 987654321n;
    const actorId8 = Buffer.alloc(8);
    actorId8.writeBigInt64LE(uid, 0);
    const actorKey = Buffer.concat([Buffer.from("actorprefix", "utf8"), actorId8]);

    // Create actor with two workstation entries and one bed entry
    const rawActor = {
      type: "compound",
      name: "",
      value: {
        identifier: NbtTags.string("minecraft:villager_v2"),
        UniqueID: NbtTags.long(uid),
        Pos: NbtTags.list("float", [100.5, 65.0, -200.5]),
        Profession: NbtTags.int(1),
        CareerLevel: NbtTags.int(2),
        CustomName: NbtTags.string("DupVillager"),
        DwellerComponent: {
          type: "compound",
          name: "DwellerComponent",
          value: {
            DwellerPositions: NbtTags.list("compound", [
              {
                role: NbtTags.string("jobsite"),
                block_pos: NbtTags.list("int", [100, 64, 200]),
                custom_tag_1: NbtTags.string("tag_ws_1")
              },
              {
                role: NbtTags.string("jobsite"),
                block_pos: NbtTags.list("int", [102, 64, 202]),
                custom_tag_2: NbtTags.string("tag_ws_2")
              },
              {
                role: NbtTags.string("bed"),
                block_pos: NbtTags.list("int", [105, 64, 205]),
                custom_tag_bed: NbtTags.string("tag_bed")
              }
            ]),
            VillageID: { type: "byteArray", value: [1, 2, 3, 4] }
          }
        }
      }
    };

    const actorBytes = writeBedrockNbt(rawActor, "little");

    const mgr = new BedrockDbManager(worldDir);
    const db = await mgr.open(false, true);
    await db.put(actorKey, actorBytes);
    await mgr.close();

    const dump = await mgr.dumpVillagers();
    const v = dump.villagers[0];
    assert.ok(v);

    // Perform an allowed unrelated edit: promotion and rename
    const session = new WorldSession(createMockDump([v]));
    const editRes = session.executeRequest({
      kind: "PATCH_VILLAGER",
      villagerId: v.sessionVillagerId,
      description: "Promote and rename",
      patch: { customName: "Master DupVillager", careerLevel: 5 }
    });
    assert.strictEqual(editRes.success, true);

    const writes = session.getDirtyWrites();
    const saveRes = await mgr.applyDirtyVillagers(writes, { createBackup: false });
    assert.strictEqual(saveRes.success, true);

    // Reload and verify all DwellerPositions entries remain identical
    const reload = await mgr.dumpVillagers();
    const reloaded = reload.villagers[0];
    assert.ok(reloaded);
    assert.strictEqual(reloaded.customName, "Master DupVillager");
    assert.strictEqual(reloaded.careerLevel, 5);

    const reloadedRaw = reloaded.rawNbt?.value || reloaded.rawNbt;
    const dwellerPositions = reloadedRaw.DwellerComponent?.value?.DwellerPositions?.value?.value || [];
    assert.strictEqual(dwellerPositions.length, 3, "All 3 DwellerPositions entries preserved");

    // Check entry 0
    const entry0 = dwellerPositions[0]?.value || dwellerPositions[0];
    assert.strictEqual(entry0?.role?.value || entry0?.role, "jobsite");
    assert.strictEqual(entry0?.custom_tag_1?.value || entry0?.custom_tag_1, "tag_ws_1");

    // Check entry 1
    const entry1 = dwellerPositions[1]?.value || dwellerPositions[1];
    assert.strictEqual(entry1?.role?.value || entry1?.role, "jobsite");
    assert.strictEqual(entry1?.custom_tag_2?.value || entry1?.custom_tag_2, "tag_ws_2");

    // Check entry 2
    const entry2 = dwellerPositions[2]?.value || dwellerPositions[2];
    assert.strictEqual(entry2?.role?.value || entry2?.role, "bed");
    assert.strictEqual(entry2?.custom_tag_bed?.value || entry2?.custom_tag_bed, "tag_bed");
  });

  // Actor + POI Mirrored Link Regression Test
  it("ACTOR + POI MIRRORED LINK: actor link and POI link remain intact and unchanged on unrelated edit", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mirrored-link-test-"));
    const worldDir = path.join(tempRoot, "test_world");
    fs.mkdirSync(path.join(worldDir, "db"), { recursive: true });

    const uid = 445566n;
    const actorId8 = Buffer.alloc(8);
    actorId8.writeBigInt64LE(uid, 0);
    const actorKey = Buffer.concat([Buffer.from("actorprefix", "utf8"), actorId8]);

    const rawActor = createActorWithDwellerPositions(uid, [100, 64, 100], [105, 64, 105]);
    const actorBytes = writeBedrockNbt(rawActor, "little");

    const poiKey = Buffer.from("VILLAGE_0_POI", "utf8");
    const poiBytes = writeBedrockNbt(createPoiRecordNbt(uid, [100, 64, 100], [105, 64, 105]), "little");

    const mgr = new BedrockDbManager(worldDir);
    const db = await mgr.open(false, true);
    await db.put(actorKey, actorBytes);
    await db.put(poiKey, poiBytes);
    await mgr.close();

    const dump = await mgr.dumpVillagers();
    const v = dump.villagers[0];
    assert.ok(v);

    // Perform unrelated edit
    const session = new WorldSession(createMockDump([v]));
    const editRes = session.executeRequest({
      kind: "PATCH_VILLAGER",
      villagerId: v.sessionVillagerId,
      description: "Rename",
      patch: { customName: "MirroredVillager" }
    });
    assert.strictEqual(editRes.success, true);

    const writes = session.getDirtyWrites();
    const saveRes = await mgr.applyDirtyVillagers(writes, { createBackup: false });
    assert.strictEqual(saveRes.success, true);

    // Verify POI bytes in DB remain 100% byte identical
    const checkDb = await mgr.open(true);
    const livePoi = await checkDb.get(poiKey);
    assert.ok(livePoi && livePoi.equals(poiBytes), "POI bytes remain exact unchanged");
    await mgr.close();

    // Verify reloaded villager still reports links accurately
    const reload = await mgr.dumpVillagers();
    const reloaded = reload.villagers[0];
    assert.ok(reloaded);
    assert.deepStrictEqual(reloaded.linkedWorkstation?.position, { x: 100, y: 64, z: 100 });
    assert.deepStrictEqual(reloaded.linkedBed?.position, { x: 105, y: 64, z: 105 });
  });

  // POI Sanitized Fixture Read-Only Test
  it("POI FIXTURE READ-ONLY: sanitized Bedrock fixture parses workstation and bed correctly and remains completely immutable", async () => {
    const fixturePath = path.join(process.cwd(), "test", "fixtures", "poi", "sanitized_poi.json");
    assert.ok(fs.existsSync(fixturePath), "Sanitized POI fixture exists");

    const fixtureContent = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "poi-fixture-readonly-"));
    const worldDir = path.join(tempRoot, "test_world");
    fs.mkdirSync(path.join(worldDir, "db"), { recursive: true });

    // Extract villager UID 9001n from fixture
    const uid = 9001n;

    const actorId8 = Buffer.alloc(8);
    actorId8.writeBigInt64LE(uid, 0);
    const actorKey = Buffer.concat([Buffer.from("actorprefix", "utf8"), actorId8]);

    const rawActor = {
      type: "compound",
      name: "",
      value: {
        identifier: NbtTags.string("minecraft:villager_v2"),
        UniqueID: NbtTags.long(uid),
        Pos: NbtTags.list("float", [0.0, 64.0, 0.0]),
        Profession: NbtTags.int(1),
        CareerLevel: NbtTags.int(1)
      }
    };

    const poiKey = Buffer.from("VILLAGE_0_POI", "utf8");
    const poiBytes = writeBedrockNbt(fixtureContent, "little");
    const actorBytes = writeBedrockNbt(rawActor, "little");

    const mgr = new BedrockDbManager(worldDir);
    const db = await mgr.open(false, true);
    await db.put(actorKey, actorBytes);
    await db.put(poiKey, poiBytes);
    await mgr.close();

    const dump = await mgr.dumpVillagers();
    const v = dump.villagers.find((vil) => vil.sessionVillagerId.includes(actorKey.toString("hex").slice(-8)));
    assert.ok(v, "Fixture villager parsed successfully");

    assert.ok(v.linkedWorkstation || v.linkedBed, "Discovered fixture link");
    assert.strictEqual(v.workstationLinkSource, "village_poi");

    const dbCheck = await mgr.open(true);
    const livePoi = await dbCheck.get(poiKey);
    assert.ok(livePoi && livePoi.equals(poiBytes), "Fixture POI bytes in DB remain 100% byte identical");
    await mgr.close();
  });

  // Static Banned Mutation Patterns Test
  it("STATIC BAN: zero active production mutation code for links in src/", () => {
    const srcDir = path.join(process.cwd(), "src");
    function searchDir(dir: string): string[] {
      let matches: string[] = [];
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          matches = matches.concat(searchDir(full));
        } else if (e.name.endsWith(".ts") || e.name.endsWith(".js")) {
          const code = fs.readFileSync(full, "utf8");
          if (code.includes("patchPoiNbtUnlink(")) {
            matches.push(`Found patchPoiNbtUnlink in ${e.name}`);
          }
          if (code.includes('kind: "village_poi"')) {
            matches.push(`Found kind: "village_poi" in ${e.name}`);
          }
          if (code.includes("Unlink workstation from Village POI")) {
            matches.push(`Found Unlink workstation from Village POI in ${e.name}`);
          }
          if (code.includes("Unlink bed from Village POI")) {
            matches.push(`Found Unlink bed from Village POI in ${e.name}`);
          }
          if (code.includes("patchDwellerComponent(")) {
            matches.push(`Found patchDwellerComponent in ${e.name}`);
          }
          if (code.includes('"SET_JOB_SITE"') || code.includes('"UNLINK_JOB_SITE"') || code.includes('"SET_BED"') || code.includes('"UNLINK_BED"')) {
            matches.push(`Found link mutation command string in ${e.name}`);
          }
          if (code.includes("btnUnlinkWorkstation") || code.includes("btnUnlinkBed")) {
            matches.push(`Found btnUnlink reference in ${e.name}`);
          }
        }
      }
      return matches;
    }

    const violations = searchDir(srcDir);
    assert.deepStrictEqual(violations, [], `Forbidden link mutation patterns found in production source: ${violations.join(", ")}`);
  });
});
