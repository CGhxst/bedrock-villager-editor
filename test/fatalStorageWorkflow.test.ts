import assert from "node:assert";
import test from "node:test";
import { RestartRequiredStorageError } from "../src/core/storageFatalError";
import { StorageHealth } from "../src/main/storageHealth";
import {
  handleCommittedRestartRequiredStorageFailure,
  handleRestartRequiredStorageFailure
} from "../src/main/fatalStorageWorkflow";

test("FATAL WORKFLOW 1: SAVE_ROLLBACK_FAILED with clean manager close marks restart and clears session", async () => {
  const storageHealth = new StorageHealth();
  let sessionCleared = false;
  let clearedManager: any = null;

  const mockManager: any = {
    close: async () => {}
  };

  const fatalError = new RestartRequiredStorageError(
    "SAVE_ROLLBACK_FAILED",
    "SAVE FAILED AND AUTOMATIC ROLLBACK COULD NOT FULLY RESTORE THE EDITOR-WRITTEN ACTORS. Do not continue editing this world. Restore the pre-save backup and restart the editor.",
    { technicalDetail: "C:\\path\\to\\world" }
  );

  const res = await handleRestartRequiredStorageFailure(fatalError, {
    storageHealth,
    manager: mockManager,
    clearSession: () => {
      sessionCleared = true;
    },
    clearManager: (m) => {
      clearedManager = m;
    }
  });

  assert.strictEqual(res.restartRequired, true);
  assert.strictEqual(res.error, fatalError.publicMessage);
  assert.strictEqual(sessionCleared, true);
  assert.strictEqual(clearedManager, mockManager);
  assert.strictEqual(storageHealth.isRestartRequired(), true);
  assert.throws(() => storageHealth.requireHealthy(), /SAVE FAILED AND AUTOMATIC ROLLBACK/);
  assert.deepStrictEqual(storageHealth.getQuarantinedForTesting(), []);
});

test("FATAL WORKFLOW 2: RESTORE_ROLLBACK_FAILED with close error retains manager in quarantine", async () => {
  const storageHealth = new StorageHealth();
  let sessionCleared = false;
  let clearedManager: any = null;

  const mockManager: any = {
    close: async () => {
      throw new Error("Lock busy on close");
    }
  };

  const fatalError = new RestartRequiredStorageError(
    "RESTORE_ROLLBACK_FAILED",
    "BACKUP RESTORE AND AUTOMATIC ROLLBACK FAILED. Do not continue editing this world. Restart the editor and recover from the pre-restore safety backup.",
    { restoreError: "Disk full", rollbackError: "Lock failure" }
  );

  const res = await handleRestartRequiredStorageFailure(fatalError, {
    storageHealth,
    manager: mockManager,
    clearSession: () => {
      sessionCleared = true;
    },
    clearManager: (m) => {
      clearedManager = m;
    }
  });

  assert.strictEqual(res.restartRequired, true);
  assert.strictEqual(res.error, fatalError.publicMessage);
  assert.strictEqual(sessionCleared, true);
  assert.strictEqual(clearedManager, null, "Manager must not be cleared when close throws");
  assert.strictEqual(storageHealth.isRestartRequired(), true);
  assert.deepStrictEqual(storageHealth.getQuarantinedForTesting(), [mockManager]);
  assert.throws(() => storageHealth.requireHealthy(), /BACKUP RESTORE AND AUTOMATIC ROLLBACK/);
});

test("FATAL WORKFLOW 3: SAVE_WRITE_STATE_UNKNOWN marks restart and halts mutations", async () => {
  const storageHealth = new StorageHealth();
  let sessionCleared = false;

  const mockManager: any = {
    close: async () => {}
  };

  const fatalError = new RestartRequiredStorageError(
    "SAVE_WRITE_STATE_UNKNOWN",
    "A villager write reported an error and the editor could not verify whether the actor record changed. Do not continue editing this world. Restore the pre-save backup if needed and restart the editor.",
    { actor: "v1", putError: "EIO", verificationReadError: "EBUSY" }
  );

  const res = await handleRestartRequiredStorageFailure(fatalError, {
    storageHealth,
    manager: mockManager,
    clearSession: () => {
      sessionCleared = true;
    },
    clearManager: () => {}
  });

  assert.strictEqual(res.restartRequired, true);
  assert.strictEqual(res.error, fatalError.publicMessage);
  assert.strictEqual(sessionCleared, true);
  assert.strictEqual(storageHealth.isRestartRequired(), true);
  assert.throws(() => storageHealth.requireHealthy(), /SAVE_WRITE_STATE_UNKNOWN|verify whether the actor record changed/);
});

test("COMMITTED FATAL 1: typed post-commit reload failure remains restart-required even when final close succeeds", async () => {
  const storageHealth = new StorageHealth();
  let sessionCleared = false;
  let managerCleared = false;
  let closeCount = 0;

  const mockManager: any = {
    close: async () => {
      closeCount++;
    }
  };

  const fatal = new RestartRequiredStorageError(
    "STORAGE_CLOSE_FAILED",
    "The world database could not be closed safely. Restart the editor before performing another world operation.",
    {
      firstClose: "EBUSY",
      secondClose: "EBUSY"
    }
  );

  const result = await handleCommittedRestartRequiredStorageFailure(
    fatal,
    {
      storageHealth,
      manager: mockManager,
      clearSession: () => {
        sessionCleared = true;
      },
      clearManager: () => {
        managerCleared = true;
      }
    },
    "Commit succeeded; restart required."
  );

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.reloadRequired, true);
  assert.strictEqual(result.restartRequired, true);
  assert.strictEqual(sessionCleared, true);
  assert.strictEqual(managerCleared, true);
  assert.strictEqual(closeCount, 1);
  assert.strictEqual(
    storageHealth.isRestartRequired(),
    true,
    "Successful final cleanup close MUST NOT downgrade a previously typed restart-required error"
  );
  assert.throws(() => storageHealth.requireHealthy());
});

test("COMMITTED FATAL 2: typed post-commit reload failure retains manager when final close also fails", async () => {
  const storageHealth = new StorageHealth();
  let sessionCleared = false;
  let managerCleared = false;

  const mockManager: any = {
    close: async () => {
      throw new Error("Injected third close failure");
    }
  };

  const fatal = new RestartRequiredStorageError(
    "STORAGE_CLOSE_FAILED",
    "The world database could not be closed safely. Restart the editor before performing another world operation."
  );

  const result = await handleCommittedRestartRequiredStorageFailure(
    fatal,
    {
      storageHealth,
      manager: mockManager,
      clearSession: () => {
        sessionCleared = true;
      },
      clearManager: () => {
        managerCleared = true;
      }
    },
    "Commit succeeded; restart required."
  );

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.restartRequired, true);
  assert.strictEqual(sessionCleared, true);
  assert.strictEqual(managerCleared, false);
  assert.deepStrictEqual(storageHealth.getQuarantinedForTesting(), [mockManager]);
  assert.throws(() => storageHealth.requireHealthy());
});
