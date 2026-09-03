import assert from "node:assert";
import test from "node:test";
import { StorageHealth } from "../src/main/storageHealth";

test("STORAGE HEALTH 1: markRestartRequired sets restart state and makes requireHealthy throw", () => {
  const health = new StorageHealth();
  assert.strictEqual(health.isRestartRequired(), false);
  assert.strictEqual(health.getRestartMessage(), "");
  assert.doesNotThrow(() => health.requireHealthy());

  health.markRestartRequired("Custom fatal message");
  assert.strictEqual(health.isRestartRequired(), true);
  assert.strictEqual(health.getRestartMessage(), "Custom fatal message");
  assert.throws(
    () => health.requireHealthy(),
    /Custom fatal message/
  );
});

test("STORAGE HEALTH 2: quarantine retains manager and sets restart required state", () => {
  const health = new StorageHealth();
  const mockManager: any = {
    close: async () => {}
  };

  health.quarantine(mockManager, "Quarantined due to close failure");
  assert.strictEqual(health.isRestartRequired(), true);
  assert.strictEqual(health.getRestartMessage(), "Quarantined due to close failure");
  assert.deepStrictEqual(health.getQuarantinedForTesting(), [mockManager]);
  assert.throws(() => health.requireHealthy(), /Quarantined due to close failure/);

  health.release(mockManager);
  assert.deepStrictEqual(health.getQuarantinedForTesting(), []);
});

test("STORAGE HEALTH 3: disposeAll handles partial failures, retains unclosable managers, and releases on retry", async () => {
  const health = new StorageHealth();

  let managerACloseCount = 0;
  const managerA: any = {
    close: async () => {
      managerACloseCount++;
    }
  };

  let managerBCloseCount = 0;
  const managerB: any = {
    close: async () => {
      managerBCloseCount++;
      if (managerBCloseCount === 1) {
        throw new Error("Manager B locked on disk");
      }
    }
  };

  health.quarantine(managerA, "Fatal A");
  health.quarantine(managerB, "Fatal B");

  assert.strictEqual(health.getQuarantinedForTesting().length, 2);

  // First disposal attempt: Manager A succeeds and is released, Manager B fails and is retained
  const firstDisposal = await health.disposeAll();
  assert.strictEqual(firstDisposal, false);
  assert.strictEqual(managerACloseCount, 1);
  assert.strictEqual(managerBCloseCount, 1);
  assert.deepStrictEqual(health.getQuarantinedForTesting(), [managerB]);

  // Second disposal attempt: Manager B succeeds and is released
  const secondDisposal = await health.disposeAll();
  assert.strictEqual(secondDisposal, true);
  assert.strictEqual(managerBCloseCount, 2);
  assert.deepStrictEqual(health.getQuarantinedForTesting(), []);
});
