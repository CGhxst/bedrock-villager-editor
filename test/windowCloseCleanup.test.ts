import { test } from "node:test";
import * as assert from "node:assert";
import {
  disposeStorageBeforeWindowDestroy,
  WindowCloseDisposeResult
} from "../src/electron/windowCloseCleanup";

test("WINDOW CLOSE CLEANUP A: does not destroy window before storage disposal resolves", async () => {
  let destroyCount = 0;
  let resolveDisposal!: (res: WindowCloseDisposeResult) => void;
  const disposalPromise = new Promise<WindowCloseDisposeResult>((resolve) => {
    resolveDisposal = resolve;
  });

  const cleanupPromise = disposeStorageBeforeWindowDestroy({
    restartRequired: false,
    disposeStorage: () => disposalPromise,
    destroyWindow: () => {
      destroyCount++;
    }
  });

  // Await a microtask tick
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(destroyCount, 0, "Window must not be destroyed before disposal resolves");

  resolveDisposal({ success: true });
  const result = await cleanupPromise;

  assert.strictEqual(destroyCount, 1, "Window must be destroyed after disposal resolves");
  assert.strictEqual(result.forceQuit, false, "forceQuit must be false on normal successful disposal");
});

test("WINDOW CLOSE CLEANUP B: destroys window after successful disposal", async () => {
  const callOrder: string[] = [];

  const result = await disposeStorageBeforeWindowDestroy({
    restartRequired: false,
    disposeStorage: async () => {
      callOrder.push("dispose-start");
      await new Promise((r) => setImmediate(r));
      callOrder.push("dispose-end");
      return { success: true };
    },
    destroyWindow: () => {
      callOrder.push("destroy");
    }
  });

  assert.deepStrictEqual(callOrder, ["dispose-start", "dispose-end", "destroy"]);
  assert.strictEqual(result.forceQuit, false);
});

test("WINDOW CLOSE CLEANUP C: unsuccessful disposal still destroys and requests process quit", async () => {
  let destroyCount = 0;
  const loggedErrors: string[] = [];

  const result = await disposeStorageBeforeWindowDestroy({
    restartRequired: false,
    disposeStorage: async () => {
      return { success: false };
    },
    destroyWindow: () => {
      destroyCount++;
    },
    logError: (message) => {
      loggedErrors.push(message);
    }
  });

  assert.strictEqual(destroyCount, 1, "Window must be destroyed even if disposal reports failure");
  assert.strictEqual(result.forceQuit, true, "forceQuit must be true on unsuccessful disposal");
  assert.ok(
    loggedErrors.some((msg) => msg.includes("Storage handle could not be closed cleanly")),
    "Must log close failure message"
  );
});

test("WINDOW CLOSE CLEANUP D: rejected disposal still destroys and requests process quit", async () => {
  let destroyCount = 0;
  const sentinelError = new Error("SENTINEL_DISPOSAL_FAILURE");
  let caughtError: unknown;

  const result = await disposeStorageBeforeWindowDestroy({
    restartRequired: false,
    disposeStorage: async () => {
      throw sentinelError;
    },
    destroyWindow: () => {
      destroyCount++;
    },
    logError: (_msg, err) => {
      caughtError = err;
    }
  });

  assert.strictEqual(destroyCount, 1, "Window must be destroyed when disposal rejects");
  assert.strictEqual(result.forceQuit, true, "forceQuit must be true when disposal rejects");
  assert.strictEqual(caughtError, sentinelError, "Logged error must match the thrown sentinel error");
});

test("WINDOW CLOSE CLEANUP E: restart-required successful disposal still requests process quit", async () => {
  let destroyCount = 0;
  const loggedErrors: string[] = [];

  const result = await disposeStorageBeforeWindowDestroy({
    restartRequired: true,
    disposeStorage: async () => {
      return { success: true };
    },
    destroyWindow: () => {
      destroyCount++;
    },
    logError: (message) => {
      loggedErrors.push(message);
    }
  });

  assert.strictEqual(destroyCount, 1, "Window must be destroyed");
  assert.strictEqual(result.forceQuit, true, "forceQuit must be true when restartRequired was active");
  assert.ok(
    loggedErrors.some((msg) => msg.includes("restart-required storage condition")),
    "Must log restart-required message"
  );
});
