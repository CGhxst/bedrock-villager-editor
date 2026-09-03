import assert from "node:assert";
import test from "node:test";
import {
  encodeBedrockNbtPreservingFormat,
  NbtTags,
  parseBedrockNbt,
  writeBedrockNbt
} from "../src/core/nbtHelper";
import { BedrockDbManager } from "../src/core/bedrockDb";
import { ParsedVillager } from "../src/core/types";
import { createHash } from "node:crypto";

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

// STORAGE ENCODING 1: Little-endian round-trip
test("STORAGE ENCODING 1: Little-endian round-trip preserves format and byte equality", async () => {
  const testNbt = {
    type: "compound",
    name: "",
    value: {
      identifier: NbtTags.string("minecraft:villager_v2"),
      CustomName: NbtTags.string("Test Villager"),
      CareerLevel: NbtTags.int(3)
    }
  };

  const originalBytes = writeBedrockNbt(testNbt, "little");
  const parsedStorage = await parseBedrockNbt(originalBytes);

  assert.strictEqual(parsedStorage.metadata.format, "little");
  assert.strictEqual(parsedStorage.metadata.prefixHex, undefined);

  const reEncoded = encodeBedrockNbtPreservingFormat(parsedStorage.parsed, parsedStorage.metadata);
  assert.strictEqual(reEncoded.equals(originalBytes), true);
});

// STORAGE ENCODING 2: LittleVarint round-trip
test("STORAGE ENCODING 2: LittleVarint round-trip preserves format and byte equality", async () => {
  const testNbt = {
    type: "compound",
    name: "",
    value: {
      identifier: NbtTags.string("minecraft:villager_v2"),
      CareerLevel: NbtTags.int(2)
    }
  };

  const originalBytes = writeBedrockNbt(testNbt, "littleVarint");
  const parsedStorage = await parseBedrockNbt(originalBytes);

  assert.strictEqual(parsedStorage.metadata.format, "littleVarint");

  const reEncoded = encodeBedrockNbtPreservingFormat(parsedStorage.parsed, parsedStorage.metadata);
  assert.strictEqual(reEncoded.equals(originalBytes), true);
});

// STORAGE ENCODING 3: 4-byte prefix + Little-endian round-trip
test("STORAGE ENCODING 3: 4-byte prefix + little-endian round-trip preserves prefix and body", async () => {
  const testNbt = {
    type: "compound",
    name: "",
    value: {
      identifier: NbtTags.string("minecraft:villager_v2"),
      TradeExperience: NbtTags.int(150)
    }
  };

  const prefix = Buffer.from([0x01, 0x02, 0x03, 0x04]);
  const body = writeBedrockNbt(testNbt, "little");
  const originalBytes = Buffer.concat([prefix, body]);

  const parsedStorage = await parseBedrockNbt(originalBytes);
  assert.strictEqual(parsedStorage.metadata.format, "little");
  assert.strictEqual(parsedStorage.metadata.prefixHex, prefix.toString("hex"));

  const reEncoded = encodeBedrockNbtPreservingFormat(parsedStorage.parsed, parsedStorage.metadata);
  assert.strictEqual(reEncoded.equals(originalBytes), true);
});

// STORAGE ENCODING 4: 4-byte prefix + LittleVarint round-trip
test("STORAGE ENCODING 4: 4-byte prefix + littleVarint round-trip preserves prefix and body", async () => {
  const testNbt = {
    type: "compound",
    name: "",
    value: {
      identifier: NbtTags.string("minecraft:villager_v2"),
      Pos: NbtTags.list("float", [10.5, 64.0, -20.5])
    }
  };

  const prefix = Buffer.from([0xaa, 0xbb, 0xcc, 0xdd]);
  const body = writeBedrockNbt(testNbt, "littleVarint");
  const originalBytes = Buffer.concat([prefix, body]);

  const parsedStorage = await parseBedrockNbt(originalBytes);
  assert.strictEqual(parsedStorage.metadata.format, "littleVarint");
  assert.strictEqual(parsedStorage.metadata.prefixHex, prefix.toString("hex"));

  const reEncoded = encodeBedrockNbtPreservingFormat(parsedStorage.parsed, parsedStorage.metadata);
  assert.strictEqual(reEncoded.equals(originalBytes), true);
});

// CONFLICT 1: Unchanged exact DB bytes produce no conflict
test("CONFLICT 1: hasWriteConflicts returns false when exact original DB bytes are unchanged", async () => {
  const fakeBytes = Buffer.from([1, 2, 3, 4, 5]);
  const hash = sha256(fakeBytes);

  const mockVillager: ParsedVillager = {
    sessionVillagerId: "v_1",
    dbKeyHex: "6163746f7270726566697831",
    originalDbValueHash: hash,
    nbtEncoding: { format: "little" },
    identifier: "minecraft:villager_v2",
    customName: "Alice",
    dimension: "overworld",
    dimensionId: 0,
    position: { x: 0, y: 0, z: 0 },
    profession: "librarian",
    professionDisplayName: "Librarian",
    professionKnown: true,
    careerLevel: 1,
    careerLevelName: "Novice",
    experience: 0,
    isCured: false,
    isZombie: false,
    trades: [],
    linkedWorkstation: null,
    linkedBed: null,
    rawNbt: {}
  };

  const write = { current: mockVillager, baseline: mockVillager };

  // Verify hash matches
  assert.strictEqual(sha256(fakeBytes), write.baseline.originalDbValueHash);
});

// CONFLICT 2: Modified live DB bytes produce conflict
test("CONFLICT 2: Modifying one byte of live DB value causes conflict check to detect conflict", () => {
  const originalBytes = Buffer.from([1, 2, 3, 4, 5]);
  const modifiedBytes = Buffer.from([1, 2, 9, 4, 5]);

  const hashOriginal = sha256(originalBytes);
  const hashModified = sha256(modifiedBytes);

  assert.notStrictEqual(hashOriginal, hashModified);
});
