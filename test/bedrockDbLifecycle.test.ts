import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { BedrockDbManager } from "../src/core/bedrockDb";
import { NbtTags } from "../src/core/nbtHelper";
import { DirtyVillagerWrite, ParsedVillager } from "../src/core/types";
import {
  isRestartRequiredStorageError,
  RestartRequiredStorageError
} from "../src/core/storageFatalError";

function createDummyActorRecord(id: string, name: string): { key: Buffer; val: Buffer } {
  const nbt = {
    type: "compound",
    name: "",
    value: {
      identifier: NbtTags.string("minecraft:villager_v2"),
      UniqueID: NbtTags.long(id),
      CustomName: NbtTags.string(name),
      Profession: NbtTags.int(1),
      Pos: NbtTags.list("float", [10, 64, 20]),
      Offers: {
        type: "compound",
        value: {
          Recipes: NbtTags.list("compound", [])
        }
      }
    }
  };
  const { writeBedrockNbt } = require("../src/core/nbtHelper");
  const val = writeBedrockNbt(nbt, "little");
  const key = Buffer.from(`actorprefix${id.padStart(16, "0")}`, "utf8");
  return { key, val };
}

function createParsedVillagerFromRecord(
  id: string,
  name: string,
  rec: { key: Buffer; val: Buffer }
): ParsedVillager {
  return {
    sessionVillagerId: `session_${id}`,
    dbKeyHex: rec.key.toString("hex"),
    originalDbValueHash: "dummyhash",
    identifier: "minecraft:villager_v2",
    customName: name,
    profession: "librarian",
    professionDisplayName: "Librarian",
    professionSource: "root:Profession",
    professionKnown: true,
    careerLevel: 1,
    careerLevelName: "Novice",
    experience: 0,
    isCured: false,
    isZombie: false,
    position: { x: 10, y: 64, z: 20 },
    dimension: "overworld",
    dimensionId: 0,
    linkedWorkstation: null,
    linkedBed: null,
    trades: [],
    rawNbt: {} as any,
    nbtEncoding: {
      format: "little",
      prefixHex: undefined
    }
  };
}

function persistentCloseHooks(succeedOnAttempt: number = 3) {
  let attempts = 0;

  return {
    get attempts() {
      return attempts;
    },
    hooks: {
      closeDb: async (db: any) => {
        attempts++;
        if (attempts < succeedOnAttempt) {
          throw new Error("Injected persistent close failure");
        }
        await db.close();
      }
    }
  };
}

test("DB LIFECYCLE: dumpVillagers hard-stops after persistent operational close failure", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "db-lifecycle-dump-"));
  const dbDir = path.join(tempDir, "db");
  fs.mkdirSync(dbDir, { recursive: true });

  const rec = createDummyActorRecord("2001", "Villager2001");
  const seed = new BedrockDbManager(tempDir);
  const db = await seed.open(false, true);
  await db.put(rec.key, rec.val);
  await seed.close();

  const closeController = persistentCloseHooks(3);
  const manager = new BedrockDbManager(tempDir, {
    testHooks: closeController.hooks
  });

  await assert.rejects(
    async () => {
      await manager.dumpVillagers();
    },
    (error: unknown) => {
      assert.ok(isRestartRequiredStorageError(error));
      const fatal = error as RestartRequiredStorageError;
      assert.strictEqual(fatal.code, "STORAGE_CLOSE_FAILED");
      return true;
    }
  );

  assert.strictEqual(closeController.attempts, 2, "1 direct close + 1 retry close attempted");

  // Explicit close for cleanup
  await manager.close();
  assert.strictEqual(closeController.attempts, 3);
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test("DB LIFECYCLE: hasWriteConflicts hard-stops after persistent operational close failure", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "db-lifecycle-conflicts-"));
  const dbDir = path.join(tempDir, "db");
  fs.mkdirSync(dbDir, { recursive: true });

  const rec = createDummyActorRecord("2002", "Villager2002");
  const v = createParsedVillagerFromRecord("2002", "Villager2002", rec);

  const seed = new BedrockDbManager(tempDir);
  const db = await seed.open(false, true);
  await db.put(rec.key, rec.val);
  await seed.close();

  const closeController = persistentCloseHooks(3);
  const manager = new BedrockDbManager(tempDir, {
    testHooks: closeController.hooks
  });

  const writes: DirtyVillagerWrite[] = [
    { current: { ...v, customName: "Renamed2002" }, baseline: v }
  ];

  await assert.rejects(
    async () => {
      await manager.hasWriteConflicts(writes);
    },
    (error: unknown) => {
      assert.ok(isRestartRequiredStorageError(error));
      const fatal = error as RestartRequiredStorageError;
      assert.strictEqual(fatal.code, "STORAGE_CLOSE_FAILED");
      return true;
    }
  );

  assert.strictEqual(closeController.attempts, 2);

  await manager.close();
  assert.strictEqual(closeController.attempts, 3);
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test("DB LIFECYCLE: createBackup hard-stops after persistent operational close failure", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "db-lifecycle-backup-"));
  const dbDir = path.join(tempDir, "db");
  fs.mkdirSync(dbDir, { recursive: true });

  const rec = createDummyActorRecord("2003", "Villager2003");
  const seed = new BedrockDbManager(tempDir);
  const db = await seed.open(false, true);
  await db.put(rec.key, rec.val);
  await seed.close();

  const closeController = persistentCloseHooks(3);
  const manager = new BedrockDbManager(tempDir, {
    testHooks: closeController.hooks
  });

  // Hold open handle
  await manager.open(true, false);

  await assert.rejects(
    async () => {
      await manager.createBackup();
    },
    (error: unknown) => {
      assert.ok(isRestartRequiredStorageError(error));
      const fatal = error as RestartRequiredStorageError;
      assert.strictEqual(fatal.code, "STORAGE_CLOSE_FAILED");
      return true;
    }
  );

  assert.strictEqual(closeController.attempts, 2);

  await manager.close();
  assert.strictEqual(closeController.attempts, 3);
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test("DB LIFECYCLE: restoreBackup hard-stops when pre-restore close cannot be confirmed", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "db-lifecycle-restore-"));
  const dbDir = path.join(tempDir, "db");
  fs.mkdirSync(dbDir, { recursive: true });

  const rec = createDummyActorRecord("2004", "Villager2004");
  const seed = new BedrockDbManager(tempDir);
  const db = await seed.open(false, true);
  await db.put(rec.key, rec.val);
  await seed.close();

  const closeController = persistentCloseHooks(3);
  const manager = new BedrockDbManager(tempDir, {
    testHooks: closeController.hooks
  });

  // Hold open handle
  await manager.open(true, false);

  await assert.rejects(
    async () => {
      // restoreBackupById calls restoreBackup after id resolution, but direct restoreBackup tests pre-restore close
      await manager.restoreBackup(path.join(tempDir, "dummy-backup.zip"));
    },
    (error: unknown) => {
      assert.ok(isRestartRequiredStorageError(error));
      const fatal = error as RestartRequiredStorageError;
      assert.strictEqual(fatal.code, "STORAGE_CLOSE_FAILED");
      return true;
    }
  );

  assert.strictEqual(closeController.attempts, 2);

  await manager.close();
  assert.strictEqual(closeController.attempts, 3);
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test("DB LIFECYCLE: applyDirtyVillagers hard-stops when pre-write close cannot be confirmed", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "db-lifecycle-apply-"));
  const dbDir = path.join(tempDir, "db");
  fs.mkdirSync(dbDir, { recursive: true });

  const rec = createDummyActorRecord("2005", "Villager2005");
  const v = createParsedVillagerFromRecord("2005", "Villager2005", rec);

  const seed = new BedrockDbManager(tempDir);
  const db = await seed.open(false, true);
  await db.put(rec.key, rec.val);
  await seed.close();

  const closeController = persistentCloseHooks(3);
  const manager = new BedrockDbManager(tempDir, {
    testHooks: closeController.hooks
  });

  // Hold open handle
  await manager.open(true, false);

  const writes: DirtyVillagerWrite[] = [
    { current: { ...v, customName: "Renamed2005" }, baseline: v }
  ];

  await assert.rejects(
    async () => {
      await manager.applyDirtyVillagers(writes, { createBackup: false });
    },
    (error: unknown) => {
      assert.ok(isRestartRequiredStorageError(error));
      const fatal = error as RestartRequiredStorageError;
      assert.strictEqual(fatal.code, "STORAGE_CLOSE_FAILED");
      return true;
    }
  );

  assert.strictEqual(closeController.attempts, 2);

  await manager.close();
  assert.strictEqual(closeController.attempts, 3);
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test("DB LIFECYCLE: transient close retry succeeds without hard-stop", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "db-lifecycle-transient-"));
  const dbDir = path.join(tempDir, "db");
  fs.mkdirSync(dbDir, { recursive: true });

  const rec = createDummyActorRecord("2006", "Villager2006");
  const seed = new BedrockDbManager(tempDir);
  const db = await seed.open(false, true);
  await db.put(rec.key, rec.val);
  await seed.close();

  let attempts = 0;
  const manager = new BedrockDbManager(tempDir, {
    testHooks: {
      closeDb: async (targetDb: any) => {
        attempts++;
        if (attempts === 1) {
          throw new Error("Injected transient close failure");
        }
        await targetDb.close();
      }
    }
  });

  // Open DB
  await manager.open(true, false);

  // createBackup should retry once and succeed without throwing STORAGE_CLOSE_FAILED
  const backupPath = await manager.createBackup();
  assert.ok(backupPath && fs.existsSync(backupPath));
  assert.strictEqual(attempts, 2, "Second attempt succeeded");

  fs.rmSync(tempDir, { recursive: true, force: true });
});
