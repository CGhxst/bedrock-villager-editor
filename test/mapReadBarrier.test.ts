import * as assert from "node:assert";
import { describe, it } from "node:test";
import { MapReadBarrier } from "../src/main/mapReadBarrier";
import { RestartRequiredStorageError } from "../src/core/storageFatalError";

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: any) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("MapReadBarrier behavioral concurrency tests", () => {
  it("11.1 drain waits through fatal side effects", async () => {
    const barrier = new MapReadBarrier();
    const deferred = createDeferred<string>();

    let restartRequired = false;
    let restartMessage = "";

    const health = {
      isRestartRequired: () => restartRequired,
      getRestartMessage: () => restartMessage
    };

    const operation = barrier.run(async () => {
      try {
        await deferred.promise;
        return "ok";
      } catch {
        restartRequired = true;
        restartMessage = "SENTINEL_RESTART_REQUIRED";
        return "fatal-handled";
      }
    });

    assert.strictEqual(barrier.getActiveCountForTesting(), 1);

    const drain = barrier.drain();

    deferred.reject(new Error("simulated terrain I/O failure"));

    await drain;

    assert.strictEqual(restartRequired, true, "drain must wait until fatal handler sets restartRequired");
    assert.strictEqual(restartMessage, "SENTINEL_RESTART_REQUIRED");
    assert.strictEqual(barrier.getActiveCountForTesting(), 0);
    assert.strictEqual(await operation, "fatal-handled");
  });

  it("11.2 drainAndRequireHealthy aborts after in-flight fatal state", async () => {
    const barrier = new MapReadBarrier();
    const deferred = createDeferred<void>();

    let restartRequired = false;
    let restartMessage = "";

    const health = {
      isRestartRequired: () => restartRequired,
      getRestartMessage: () => restartMessage
    };

    const operation = barrier.run(async () => {
      try {
        await deferred.promise;
        return "ok";
      } catch {
        restartRequired = true;
        restartMessage = "SENTINEL_RESTART_REQUIRED";
        return "fatal-handled";
      }
    });

    const guardedDrain = barrier.drainAndRequireHealthy(
      health,
      "SENTINEL_CONTEXT"
    );

    deferred.reject(new Error("fatal map read"));
    await operation;

    await assert.rejects(
      async () => {
        await guardedDrain;
      },
      (err: any) => {
        assert.ok(err instanceof RestartRequiredStorageError);
        assert.strictEqual(err.code, "STORAGE_CLOSE_FAILED");
        assert.strictEqual(err.publicMessage, "SENTINEL_RESTART_REQUIRED");
        assert.ok(
          JSON.stringify(err.debugDetail).includes("SENTINEL_CONTEXT"),
          `Expected debugDetail to identify SENTINEL_CONTEXT, got: ${JSON.stringify(err.debugDetail)}`
        );
        return true;
      }
    );
  });

  it("11.3 healthy drain succeeds", async () => {
    const barrier = new MapReadBarrier();
    const deferred1 = createDeferred<string>();
    const deferred2 = createDeferred<string>();

    const health = {
      isRestartRequired: () => false,
      getRestartMessage: () => ""
    };

    const op1 = barrier.run(async () => {
      return await deferred1.promise;
    });
    const op2 = barrier.run(async () => {
      return await deferred2.promise;
    });

    assert.strictEqual(barrier.getActiveCountForTesting(), 2);

    const guardedDrain = barrier.drainAndRequireHealthy(health, "Healthy context");

    deferred1.resolve("tile1");
    deferred2.resolve("tile2");

    await guardedDrain;
    assert.strictEqual(await op1, "tile1");
    assert.strictEqual(await op2, "tile2");
    assert.strictEqual(barrier.getActiveCountForTesting(), 0);
  });

  it("11.4 rejected task is still removed", async () => {
    const barrier = new MapReadBarrier();

    const op = barrier.run(async () => {
      throw new Error("task failure");
    });

    await assert.rejects(async () => {
      await op;
    }, /task failure/);

    assert.strictEqual(barrier.getActiveCountForTesting(), 0);
  });
});
