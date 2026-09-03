import assert from "node:assert";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { BedrockDbManager } from "../src/core/bedrockDb";
import { NbtTags, writeBedrockNbt } from "../src/core/nbtHelper";
import { DirtyVillagerWrite, ParsedVillager } from "../src/core/types";

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

test("CONFLICT INTEGRATION 1: BedrockDbManager.hasWriteConflicts accurately checks live LevelDB state", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "conflict-integration-"));
  const dbDir = path.join(tempDir, "db");
  fs.mkdirSync(dbDir, { recursive: true });

  const manager = new BedrockDbManager(tempDir);
  const db = await manager.open(false, true);

  const actorNbt = {
    type: "compound",
    name: "",
    value: {
      identifier: NbtTags.string("minecraft:villager_v2"),
      UniqueID: NbtTags.long("777"),
      CustomName: NbtTags.string("ConflictTest")
    }
  };

  const key = Buffer.from("actorprefix777", "utf8");
  const originalBytes = writeBedrockNbt(actorNbt, "little");
  await db.put(key, originalBytes);
  await manager.close();

  const mockVillager: ParsedVillager = {
    sessionVillagerId: "v_777",
    dbKeyHex: key.toString("hex"),
    originalDbValueHash: sha256(originalBytes),
    nbtEncoding: { format: "little" },
    identifier: "minecraft:villager_v2",
    customName: "ConflictTest",
    dimension: "overworld",
    dimensionId: 0,
    position: { x: 0, y: 64, z: 0 },
    profession: "unemployed",
    professionDisplayName: "Unemployed",
    professionKnown: true,
    careerLevel: 1,
    careerLevelName: "Novice",
    experience: 0,
    isCured: false,
    isZombie: false,
    trades: [],
    linkedWorkstation: null,
    linkedBed: null,
    rawNbt: actorNbt
  };

  const write: DirtyVillagerWrite = {
    current: { ...mockVillager, customName: "Renamed" },
    baseline: mockVillager
  };

  // 1. Check conflicts when live DB is identical -> should be false
  const conflict1 = await manager.hasWriteConflicts([write]);
  assert.strictEqual(conflict1, false, "Must have no conflicts when live DB bytes match original hash");

  // 2. Modify one byte on live DB
  const writableDb = await manager.open(false, false);
  const modifiedBytes = Buffer.from(originalBytes);
  const lastIdx = modifiedBytes.length - 1;
  const lastByte = modifiedBytes[lastIdx];
  if (lastByte !== undefined) {
    modifiedBytes[lastIdx] = lastByte ^ 0xff;
  }
  await writableDb.put(key, modifiedBytes);
  await manager.close();

  // 3. Check conflicts again -> should be true
  const conflict2 = await manager.hasWriteConflicts([write]);
  assert.strictEqual(conflict2, true, "Must detect conflict when live DB bytes differ");

  fs.rmSync(tempDir, { recursive: true, force: true });
});
