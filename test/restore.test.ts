import archiver from "archiver";
import assert from "node:assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import test from "node:test";
import { atomicReplaceWorldDirectory, AtomicFs, defaultAtomicFs } from "../src/core/atomicWorldReplace";
import { BedrockDbManager } from "../src/core/bedrockDb";
import {
  isRestartRequiredStorageError,
  RestartRequiredStorageError
} from "../src/core/storageFatalError";

async function createDummyWorld(parentDir: string, worldName: string): Promise<string> {
  const worldDir = path.join(parentDir, worldName);
  const dbDir = path.join(worldDir, "db");
  fs.mkdirSync(dbDir, { recursive: true });

  fs.writeFileSync(path.join(worldDir, "levelname.txt"), `${worldName}\n`, "utf8");
  const mgr = new BedrockDbManager(worldDir);
  const db = await mgr.open(false, true);
  await db.put(Buffer.from("testkey"), Buffer.from("testval"));
  await mgr.close();
  return worldDir;
}

async function createZipArchive(sourceDir: string, zipPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver("zip", { zlib: { level: 6 } });
    output.on("close", resolve);
    archive.on("error", reject);
    archive.pipe(output);
    archive.directory(sourceDir, false);
    archive.finalize();
  });
}

// BACKUP RESTORE 1: Successful staged restore
test("BACKUP RESTORE 1: Successful staged restore restores world contents cleanly", async () => {
  const tempBase = fs.mkdtempSync(path.join(os.tmpdir(), "restore-test-1-"));
  const worldDir = await createDummyWorld(tempBase, "WorldA");

  const manager = new BedrockDbManager(worldDir);
  const backupZip = await manager.createBackup();

  // Modify live world
  fs.writeFileSync(path.join(worldDir, "levelname.txt"), "WorldA Modified\n", "utf8");

  // Restore
  await manager.restoreBackup(backupZip);

  // Assert restored state
  const restoredName = fs.readFileSync(path.join(worldDir, "levelname.txt"), "utf8").trim();
  assert.strictEqual(restoredName, "WorldA");

  // Cleanup
  fs.rmSync(tempBase, { recursive: true, force: true });
});

// BACKUP RESTORE 2: Invalid extracted backup leaves live world untouched
test("BACKUP RESTORE 2: Invalid backup without db directory leaves live world untouched", async () => {
  const tempBase = fs.mkdtempSync(path.join(os.tmpdir(), "restore-test-2-"));
  const worldDir = await createDummyWorld(tempBase, "WorldB");

  const manager = new BedrockDbManager(worldDir);

  // Create invalid zip (no db folder)
  const invalidDir = path.join(tempBase, "invalid-src");
  fs.mkdirSync(invalidDir, { recursive: true });
  fs.writeFileSync(path.join(invalidDir, "readme.txt"), "no db here", "utf8");

  const backupRoot = manager.getBackupRoot();
  if (!fs.existsSync(backupRoot)) fs.mkdirSync(backupRoot, { recursive: true });

  const invalidZip = path.join(backupRoot, `WorldB_backup_invalid-${Date.now()}.zip`);
  await createZipArchive(invalidDir, invalidZip);

  // Attempt restore: should fail
  await assert.rejects(async () => {
    await manager.restoreBackup(invalidZip);
  }, /Backup restore failed|Backup is invalid/i);

  // Live world must remain untouched
  const liveName = fs.readFileSync(path.join(worldDir, "levelname.txt"), "utf8").trim();
  assert.strictEqual(liveName, "WorldB");
  assert.strictEqual(fs.existsSync(path.join(worldDir, "db", "CURRENT")), true);

  // Cleanup
  fs.rmSync(tempBase, { recursive: true, force: true });
  if (fs.existsSync(invalidZip)) fs.unlinkSync(invalidZip);
});

// BACKUP RESTORE 3: Failure after original directory moves automatically rolls back
test("BACKUP RESTORE 3: Injected swap failure automatically restores original live directory", async () => {
  const tempBase = fs.mkdtempSync(path.join(os.tmpdir(), "restore-test-3-"));
  const liveDir = await createDummyWorld(tempBase, "LiveWorld");
  const stagingDir = await createDummyWorld(tempBase, "StagingWorld");
  const previousDir = path.join(tempBase, "PreviousWorld");

  // Marker file in live world
  fs.writeFileSync(path.join(liveDir, "live_marker.txt"), "original live data", "utf8");

  // Inject a renameSync that succeeds on live -> previous, but fails on staging -> live
  let renameCallCount = 0;
  const mockFs = {
    ...defaultAtomicFs,
    renameSync: (oldP: fs.PathLike, newP: fs.PathLike) => {
      renameCallCount++;
      if (renameCallCount === 2) {
        throw new Error("Injected disk error during staging -> live swap");
      }
      fs.renameSync(oldP, newP);
    }
  };

  assert.throws(() => {
    atomicReplaceWorldDirectory(liveDir, stagingDir, previousDir, mockFs);
  }, /Injected disk error/);

  // Live directory must have been recovered automatically
  assert.strictEqual(fs.existsSync(liveDir), true, "Live directory must exist after rollback");
  assert.strictEqual(
    fs.readFileSync(path.join(liveDir, "live_marker.txt"), "utf8"),
    "original live data",
    "Live marker must be intact"
  );
  assert.strictEqual(fs.existsSync(previousDir), false, "Previous directory must have been moved back to live");

  fs.rmSync(tempBase, { recursive: true, force: true });
});

// BACKUP RESTORE 4: Nonexistent backup file throws clean error without touching live world
test("BACKUP RESTORE 4: Nonexistent backup zip throws error without modifying live world", async () => {
  const tempBase = fs.mkdtempSync(path.join(os.tmpdir(), "restore-test-4-"));
  const worldDir = await createDummyWorld(tempBase, "WorldD");

  const manager = new BedrockDbManager(worldDir);
  const nonExistentZip = path.join(tempBase, "does_not_exist.zip");

  await assert.rejects(async () => {
    await manager.restoreBackup(nonExistentZip);
  }, /Backup file does not exist/);

  // Live world must remain intact
  const liveName = fs.readFileSync(path.join(worldDir, "levelname.txt"), "utf8").trim();
  assert.strictEqual(liveName, "WorldD");
  assert.strictEqual(fs.existsSync(path.join(worldDir, "db")), true);

  fs.rmSync(tempBase, { recursive: true, force: true });
});

// BACKUP RESTORE 5: Non-empty invalid LevelDB directory is rejected before live swap
test("BACKUP RESTORE 5: Non-empty invalid LevelDB directory is rejected before live swap", async () => {
  const tempBase = fs.mkdtempSync(path.join(os.tmpdir(), "restore-test-5-"));
  const worldDir = await createDummyWorld(tempBase, "WorldE");

  // Write live marker
  fs.writeFileSync(path.join(worldDir, "live_marker.txt"), "important-live-state", "utf8");

  const manager = new BedrockDbManager(worldDir);

  // Create invalid backup with non-empty fake db folder
  const invalidDir = path.join(tempBase, "invalid-src");
  const fakeDbDir = path.join(invalidDir, "db");
  fs.mkdirSync(fakeDbDir, { recursive: true });
  fs.writeFileSync(path.join(fakeDbDir, "fake-file.txt"), "not a real leveldb database", "utf8");

  const backupRoot = manager.getBackupRoot();
  if (!fs.existsSync(backupRoot)) fs.mkdirSync(backupRoot, { recursive: true });

  const invalidZip = path.join(backupRoot, `WorldE_backup_fake_db-${Date.now()}.zip`);
  await createZipArchive(invalidDir, invalidZip);

  // Restore should reject during LevelDB open check
  await assert.rejects(async () => {
    await manager.restoreBackup(invalidZip);
  }, /LevelDB database could not be validated safely/);

  // Live world must remain unchanged and still open cleanly
  assert.strictEqual(
    fs.readFileSync(path.join(worldDir, "live_marker.txt"), "utf8"),
    "important-live-state"
  );

  const verifyManager = new BedrockDbManager(worldDir);
  const checkDb = await verifyManager.open(true, false);
  assert.ok(checkDb);
  await verifyManager.close();

  fs.rmSync(tempBase, { recursive: true, force: true });
  if (fs.existsSync(invalidZip)) fs.unlinkSync(invalidZip);
});

// BACKUP RESTORE 6: Post-commit cleanup failure leaves restored live world intact
test("BACKUP RESTORE 6: Post-commit cleanup failure injected through manager.restoreBackup leaves restored live world intact without triggering rollback", async () => {
  const tempBase = fs.mkdtempSync(path.join(os.tmpdir(), "restore-test-6-"));
  const worldDir = await createDummyWorld(tempBase, "WorldF");

  const manager = new BedrockDbManager(worldDir, {
    restoreCleanupFs: {
      existsSync: fs.existsSync,
      rmSync: () => {
        throw new Error("Injected cleanup failure");
      }
    }
  });
  const backupZip = await manager.createBackup();

  // Modify live world
  fs.writeFileSync(path.join(worldDir, "levelname.txt"), "WorldF Pre-Restore Modified\n", "utf8");

  // Restore live world through real path with injected cleanup failure
  await manager.restoreBackup(backupZip);

  // Live world successfully contains restored state
  const restoredName = fs.readFileSync(path.join(worldDir, "levelname.txt"), "utf8").trim();
  assert.strictEqual(restoredName, "WorldF");

  fs.rmSync(tempBase, { recursive: true, force: true });
});

// BACKUP RESTORE 7: Real fatal restore rollback throws RestartRequiredStorageError
test("BACKUP RESTORE 7: Fatal restore rollback with atomicFs injection throws RestartRequiredStorageError and leaves recovery state", async () => {
  const tempBase = fs.mkdtempSync(path.join(os.tmpdir(), "restore-test-7-"));
  const worldDir = await createDummyWorld(tempBase, "WorldG");

  let renameCalls = 0;
  const customAtomicFs: AtomicFs = {
    existsSync: fs.existsSync,
    statSync: fs.statSync,
    readdirSync: fs.readdirSync,
    rmSync: fs.rmSync,
    renameSync: (oldP, newP) => {
      renameCalls++;
      if (renameCalls === 1) {
        // live -> previous succeeds
        return fs.renameSync(oldP, newP);
      }
      if (renameCalls === 2) {
        // staging -> live fails
        throw new Error("Injected install failure");
      }
      if (renameCalls === 3) {
        // previous -> live rollback ALSO fails
        throw new Error("Injected rollback failure");
      }
      return fs.renameSync(oldP, newP);
    }
  };

  const manager = new BedrockDbManager(worldDir, {
    atomicFs: customAtomicFs
  });
  const backupZip = await manager.createBackup();

  let thrownError: unknown = null;
  try {
    await manager.restoreBackup(backupZip);
  } catch (error) {
    thrownError = error;
  }

  assert.ok(thrownError, "Restore must reject on fatal rollback");
  assert.ok(
    isRestartRequiredStorageError(thrownError),
    "Error must be a RestartRequiredStorageError"
  );
  assert.strictEqual(thrownError.code, "RESTORE_ROLLBACK_FAILED");
  assert.ok(
    thrownError.publicMessage.includes("BACKUP RESTORE AND AUTOMATIC ROLLBACK FAILED"),
    "Public message must state that restore and rollback failed"
  );
  assert.ok(
    !thrownError.publicMessage.includes("Injected install failure"),
    "Public message must not leak technical install error"
  );
  assert.ok(
    !thrownError.publicMessage.includes("Injected rollback failure"),
    "Public message must not leak technical rollback error"
  );

  const debug = thrownError.debugDetail as { restoreError?: string; rollbackError?: string };
  assert.ok(debug && typeof debug === "object");
  assert.ok(debug.restoreError?.includes("Injected install failure"));
  assert.ok(debug.rollbackError?.includes("Injected rollback failure"));

  // Check that the previous directory remains available for recovery
  const previousDirs = fs
    .readdirSync(tempBase)
    .filter((f) => f.includes("restore-previous"));
  assert.ok(previousDirs.length > 0, "Previous directory must remain preserved on fatal rollback");

  fs.rmSync(tempBase, { recursive: true, force: true });
});

// BACKUP RESTORE 8: Staging close failure halts before atomic swap and retains child manager
test("BACKUP RESTORE 8: Staging close failure halts before atomic swap and retains child manager", async () => {
  const tempBase = fs.mkdtempSync(path.join(os.tmpdir(), "restore-test-8-"));
  const worldDir = await createDummyWorld(tempBase, "WorldH");

  let stagingCloseAttempt = 0;
  const manager = new BedrockDbManager(worldDir, {
    stagingTestHooks: {
      closeDb: async (dbHandle) => {
        stagingCloseAttempt++;
        if (stagingCloseAttempt === 1) {
          throw new Error("Injected staging close failure");
        }
        await dbHandle.close();
      }
    }
  });

  const backupZip = await manager.createBackup();

  // Modify live world
  fs.writeFileSync(path.join(worldDir, "live_unchanged.txt"), "must-stay", "utf8");

  let thrownError: unknown = null;
  try {
    await manager.restoreBackup(backupZip);
  } catch (error) {
    thrownError = error;
  }

  assert.ok(thrownError, "Restore must reject when staging close fails");
  assert.ok(
    isRestartRequiredStorageError(thrownError),
    "Error must be RestartRequiredStorageError"
  );
  assert.strictEqual(thrownError.code, "STORAGE_CLOSE_FAILED");

  // Live world remains untouched
  assert.strictEqual(
    fs.readFileSync(path.join(worldDir, "live_unchanged.txt"), "utf8"),
    "must-stay"
  );

  // Close parent manager: this should retry child closing and succeed on 2nd attempt
  await manager.close();

  fs.rmSync(tempBase, { recursive: true, force: true });
});
