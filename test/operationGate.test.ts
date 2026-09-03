import assert from "node:assert";
import test from "node:test";
import { OperationGate, OperationBusyError } from "../src/main/operationGate";

test("OperationGate: executes task and clears active operation", async () => {
  const gate = new OperationGate();
  assert.strictEqual(gate.current, null);

  const result = await gate.run("Saving world", async () => {
    assert.strictEqual(gate.current, "Saving world");
    return 42;
  });

  assert.strictEqual(result, 42);
  assert.strictEqual(gate.current, null);
});

test("OperationGate: throws OperationBusyError on concurrent execution", async () => {
  const gate = new OperationGate();

  let unblock: () => void;
  const barrier = new Promise<void>((resolve) => {
    unblock = resolve;
  });

  const task1 = gate.run("Operation 1", async () => {
    await barrier;
    return "task1-done";
  });

  assert.strictEqual(gate.current, "Operation 1");

  await assert.rejects(
    async () => {
      await gate.run("Operation 2", async () => "task2-done");
    },
    (err: any) => {
      assert(err instanceof OperationBusyError);
      assert.strictEqual(err.operation, "Operation 1");
      assert(err.message.includes("Operation 1"));
      return true;
    }
  );

  unblock!();
  const res1 = await task1;
  assert.strictEqual(res1, "task1-done");
  assert.strictEqual(gate.current, null);
});

test("OperationGate: resets active operation when task throws", async () => {
  const gate = new OperationGate();

  await assert.rejects(
    async () => {
      await gate.run("Failing operation", async () => {
        throw new Error("Task exploded");
      });
    },
    /Task exploded/
  );

  assert.strictEqual(gate.current, null);

  // Can run subsequent task cleanly
  const next = await gate.run("Next operation", async () => "ok");
  assert.strictEqual(next, "ok");
  assert.strictEqual(gate.current, null);
});
