import test from "node:test";
import assert from "node:assert/strict";
import { createDigpKey, getDimensionId, computeActorDigestMutation, assertSupportedSpatialDimension } from "../src/core/chunkDigest";

test("CHUNK DIGEST 1: getDimensionId parses recognized dimension names and rejects unknown strings", () => {
  assert.strictEqual(getDimensionId("overworld"), 0);
  assert.strictEqual(getDimensionId("nether"), 1);
  assert.strictEqual(getDimensionId("the_end"), 2);
  assert.strictEqual(getDimensionId("theend"), 2);
  assert.strictEqual(getDimensionId("end"), 2);
  assert.strictEqual(getDimensionId("0"), 0);
  assert.strictEqual(getDimensionId("1"), 1);
  assert.strictEqual(getDimensionId("2"), 2);
  assert.strictEqual(getDimensionId(0), 0);
  assert.strictEqual(getDimensionId(1), 1);
  assert.strictEqual(getDimensionId(2), 2);
  assert.strictEqual(getDimensionId(3), 3);

  assert.throws(
    () => getDimensionId("unknown"),
    /dimension/i
  );

  assert.throws(
    () => getDimensionId("banana_dimension"),
    /dimension/i
  );

  assert.throws(
    () => assertSupportedSpatialDimension(3),
    /Spatial villager moves in DimensionId 3 are not supported/i
  );
});

test("CHUNK DIGEST 2: createDigpKey generates 12-byte key for Overworld and 16-byte key for other dimensions", () => {
  const overworldKey = createDigpKey(30, 10, "overworld");
  assert.equal(overworldKey.length, 12);
  assert.equal(overworldKey.subarray(0, 4).toString("utf8"), "digp");
  assert.equal(overworldKey.readInt32LE(4), 30);
  assert.equal(overworldKey.readInt32LE(8), 10);

  const netherKey = createDigpKey(-5, 12, "nether");
  assert.equal(netherKey.length, 16);
  assert.equal(netherKey.subarray(0, 4).toString("utf8"), "digp");
  assert.equal(netherKey.readInt32LE(4), -5);
  assert.equal(netherKey.readInt32LE(8), 12);
  assert.equal(netherKey.readInt32LE(12), 1);

  const endKey = createDigpKey(100, -200, 2);
  assert.equal(endKey.length, 16);
  assert.equal(endKey.readInt32LE(12), 2);
});

test("CHUNK DIGEST: non-8-byte-aligned input is refused without silent normalization", () => {
  const actor = Buffer.from("0102030405060708", "hex");
  const corrupt = Buffer.from("0102030405060708aabb", "hex");

  assert.throws(
    () => computeActorDigestMutation(corrupt, actor, "add"),
    /8-byte|aligned|digest/i
  );

  assert.strictEqual(corrupt.toString("hex"), "0102030405060708aabb");
});

test("CHUNK DIGEST A: add absent target preserves unrelated order and appends target once", () => {
  const actor1 = Buffer.from("0102030405060708", "hex");
  const actor2 = Buffer.from("090a0b0c0d0e0f10", "hex");
  const actor3 = Buffer.from("1112131415161718", "hex");

  const initial = Buffer.concat([actor1, actor2]);
  const res = computeActorDigestMutation(initial, actor3, "add");

  assert.equal(res.changed, true);
  assert.equal(res.next.length, 24);
  assert.deepEqual(res.next, Buffer.concat([actor1, actor2, actor3]));
});

test("CHUNK DIGEST B: add existing target returns changed:false and exact unchanged bytes", () => {
  const actor1 = Buffer.from("0102030405060708", "hex");
  const actor2 = Buffer.from("090a0b0c0d0e0f10", "hex");

  const initial = Buffer.concat([actor1, actor2]);
  const res = computeActorDigestMutation(initial, actor1, "add");

  assert.equal(res.changed, false);
  assert.deepEqual(res.next, initial);
});

test("CHUNK DIGEST C: remove target removes only target occurrences and preserves unrelated entries", () => {
  const actor1 = Buffer.from("0102030405060708", "hex");
  const actor2 = Buffer.from("090a0b0c0d0e0f10", "hex");
  const actor3 = Buffer.from("1112131415161718", "hex");

  const initial = Buffer.concat([actor1, actor2, actor3]);
  const res = computeActorDigestMutation(initial, actor2, "remove");

  assert.equal(res.changed, true);
  assert.deepEqual(res.next, Buffer.concat([actor1, actor3]));

  // Removing non-existent target returns changed: false
  const resAbsent = computeActorDigestMutation(Buffer.concat([actor1, actor3]), actor2, "remove");
  assert.equal(resAbsent.changed, false);
  assert.deepEqual(resAbsent.next, Buffer.concat([actor1, actor3]));
});

test("CHUNK DIGEST D: unrelated duplicate entries remain duplicated in exact original order", () => {
  const actor1 = Buffer.from("0102030405060708", "hex");
  const actor2 = Buffer.from("090a0b0c0d0e0f10", "hex");
  const actor3 = Buffer.from("1112131415161718", "hex");

  // actor2 is duplicated in original buffer
  const initial = Buffer.concat([actor1, actor2, actor3, actor2]);
  const res = computeActorDigestMutation(initial, actor1, "remove");

  assert.equal(res.changed, true);
  // actor2 and actor3 and the duplicate actor2 remain in exact original order
  assert.deepEqual(res.next, Buffer.concat([actor2, actor3, actor2]));
});

test("CHUNK DIGEST E: malformed digest throws without producing normalized output", () => {
  const actor = Buffer.from("0102030405060708", "hex");
  const malformed = Buffer.from("01020304", "hex"); // 4 bytes

  assert.throws(
    () => computeActorDigestMutation(malformed, actor, "remove"),
    /8-byte|aligned|digest/i
  );
});

test("CHUNK DIGEST F: actor ID not 8 bytes throws descriptive error", () => {
  const invalidActorShort = Buffer.from("01020304", "hex");
  const invalidActorLong = Buffer.from("010203040506070809", "hex");
  const initial = Buffer.alloc(16);

  assert.throws(
    () => computeActorDigestMutation(initial, invalidActorShort, "add"),
    /must be exactly 8 bytes/i
  );

  assert.throws(
    () => computeActorDigestMutation(initial, invalidActorLong, "remove"),
    /must be exactly 8 bytes/i
  );
});
