import * as assert from "node:assert";
import { describe, it } from "node:test";
import { allocateUniqueTradeId } from "../src/core/tradeIds";

describe("Trade ID Allocation (Deterministic Collision & Uniqueness)", () => {
  it("retries and returns non-colliding candidate when first candidate collides", () => {
    const fixedTime = 123456789;
    const nowFactory = () => fixedTime;

    const uuidA = "11111111-1111-4111-8111-111111111111";
    const uuidB = "22222222-2222-4222-8222-222222222222";

    const collidingCandidate = `trade_${fixedTime}_${uuidA}`;
    const usedIds = new Set<string>([collidingCandidate]);

    let callCount = 0;
    const uuidFactory = () => {
      callCount += 1;
      return callCount === 1 ? uuidA : uuidB;
    };

    const allocated = allocateUniqueTradeId(usedIds, uuidFactory, nowFactory);

    assert.strictEqual(callCount, 2, "UUID factory must be called twice due to initial collision");
    assert.notStrictEqual(allocated, collidingCandidate, "Allocated ID must not equal the colliding candidate");
    assert.strictEqual(allocated, `trade_${fixedTime}_${uuidB}`);
    assert.ok(usedIds.has(allocated), "Allocated ID must be recorded in usedIds");
  });

  it("throws error after 32 consecutive collision attempts", () => {
    const fixedTime = 999999999;
    const nowFactory = () => fixedTime;
    const persistentUuid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const collidingCandidate = `trade_${fixedTime}_${persistentUuid}`;
    const usedIds = new Set<string>([collidingCandidate]);

    let callCount = 0;
    const uuidFactory = () => {
      callCount += 1;
      return persistentUuid;
    };

    assert.throws(
      () => {
        allocateUniqueTradeId(usedIds, uuidFactory, nowFactory);
      },
      (err: any) => {
        assert.ok(err.message.includes("after 32 attempts"));
        return true;
      }
    );

    assert.strictEqual(callCount, 32);
  });
});
