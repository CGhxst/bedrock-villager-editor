import * as assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, it } from "node:test";
import { worldMapTileRequestSchema } from "../src/core/validation";
import {
  WORLD_MAP_TILE_BLOCKS,
  createChunkDataKey,
  createSubChunkDataKey,
  decodeSubChunkSurfaceBlocks,
  decodeChunkHeightMap,
  decodeChunkBiomes,
  renderWorldMapTile,
  surfaceMapColor,
  terrainColorForHeight
} from "../src/core/worldMap";
import {
  BEDROCK_BIOME_COLORS,
  BLOCK_MATERIAL_COLORS,
  getWaterColorWithDepth,
  DEFAULT_END_COLOR,
  DEFAULT_NETHER_COLOR,
  DEFAULT_OVERWORLD_COLOR,
  getBiomeBaseColor
} from "../src/core/worldMapBiomeColors";

import {
  NbtTags,
  writeBedrockNbt
} from "../src/core/nbtHelper";

function buildSingleValueData3DBiomeTail(biomeId: number): Buffer {
  const buf = Buffer.alloc(5);
  buf.writeUInt8(1, 0); // flags: bitsPerBlock = 0, isPersistent = false (low bit = 1)
  buf.writeInt32LE(biomeId, 1);
  return buf;
}

function buildPackedMultiBiomeData3DBiomeTail(
  bitsPerBlock: number,
  palette: number[],
  indices: Uint16Array
): Buffer {
  const flags = (bitsPerBlock << 1) | 1;
  const blocksPerWord = Math.floor(32 / bitsPerBlock);
  const wordCount = Math.ceil(4096 / blocksPerWord);
  const wordsBytes = wordCount * 4;

  const buf = Buffer.alloc(1 + wordsBytes + 4 + palette.length * 4);
  buf.writeUInt8(flags, 0);

  const mask = (1 << bitsPerBlock) - 1;
  for (let i = 0; i < 4096; i += 1) {
    const wordIdx = Math.floor(i / blocksPerWord);
    const bitOffset = (i % blocksPerWord) * bitsPerBlock;
    const val = (indices[i] ?? 0) & mask;
    const current = buf.readUInt32LE(1 + wordIdx * 4);
    buf.writeUInt32LE(current | (val << bitOffset), 1 + wordIdx * 4);
  }

  // Palette size
  buf.writeInt32LE(palette.length, 1 + wordsBytes);
  // Palette entries
  for (let p = 0; p < palette.length; p += 1) {
    buf.writeInt32LE(palette[p]!, 1 + wordsBytes + 4 + p * 4);
  }

  return buf;
}

function buildPackedTwoBiomeData3DBiomeTail(
  biomeIdA: number,
  biomeIdB: number,
  indices: Uint8Array
): Buffer {
  const u16 = new Uint16Array(4096);
  for (let i = 0; i < 4096; i += 1) {
    u16[i] = indices[i] ? 1 : 0;
  }
  return buildPackedMultiBiomeData3DBiomeTail(1, [biomeIdA, biomeIdB], u16);
}

function encodePersistentBlockState(
  blockName: string
): Buffer {
  return writeBedrockNbt(
    {
      type: "compound",
      name: "",
      value: {
        name: NbtTags.string(blockName),
        states: NbtTags.compound({}),
        version: NbtTags.int(18168865)
      }
    },
    "little"
  );
}

function buildSingleValuePersistentSubChunk(
  version: 8 | 9,
  subChunkY: number,
  blockName: string
): Buffer {
  const bitsPerBlock = 1;
  const storageHeader = (bitsPerBlock << 1) | 0;

  const words = Buffer.alloc(512, 0);

  const paletteSize = Buffer.alloc(4);
  paletteSize.writeUInt32LE(1, 0);

  const prefix =
    version === 9
      ? Buffer.from([
          9,
          1,
          subChunkY & 0xff,
          storageHeader
        ])
      : Buffer.from([
          8,
          1,
          storageHeader
        ]);

  return Buffer.concat([
    prefix,
    words,
    paletteSize,
    encodePersistentBlockState(blockName)
  ]);
}

function buildPackedPersistentSubChunk(
  subChunkY: number,
  bitsPerBlock: number,
  palette: string[],
  blockLookup: (x: number, y: number, z: number) => number
): Buffer {
  const blocksPerWord = Math.floor(32 / bitsPerBlock);
  const wordCount = Math.ceil(4096 / blocksPerWord);
  const wordsBytes = wordCount * 4;
  const wordsBuf = Buffer.alloc(wordsBytes, 0);

  const mask = (1 << bitsPerBlock) - 1;
  for (let x = 0; x < 16; x += 1) {
    for (let z = 0; z < 16; z += 1) {
      for (let y = 0; y < 16; y += 1) {
        const index = (x << 8) | (z << 4) | y;
        const pIdx = blockLookup(x, y, z) & mask;
        const wordIdx = Math.floor(index / blocksPerWord);
        const bitOffset = (index % blocksPerWord) * bitsPerBlock;
        const cur = wordsBuf.readUInt32LE(wordIdx * 4);
        wordsBuf.writeUInt32LE(cur | (pIdx << bitOffset), wordIdx * 4);
      }
    }
  }

  const prefix = Buffer.from([9, 1, subChunkY & 0xff, (bitsPerBlock << 1) | 0]);
  const paletteSizeBuf = Buffer.alloc(4);
  paletteSizeBuf.writeInt32LE(palette.length, 0);

  const nbtBuf = Buffer.concat(palette.map(b => encodePersistentBlockState(b)));

  return Buffer.concat([prefix, wordsBuf, paletteSizeBuf, nbtBuf]);
}

describe("Read-only world map", () => {
  it("encodes Bedrock Data3D/Data2D chunk keys for vanilla dimensions", () => {
    const overworld = createChunkDataKey(-12, 34, 0, 43);
    assert.strictEqual(overworld.length, 9);
    assert.strictEqual(overworld.readInt32LE(0), -12);
    assert.strictEqual(overworld.readInt32LE(4), 34);
    assert.strictEqual(overworld.readUInt8(8), 43);

    const nether = createChunkDataKey(-12, 34, 1, 45);
    assert.strictEqual(nether.length, 13);
    assert.strictEqual(nether.readInt32LE(0), -12);
    assert.strictEqual(nether.readInt32LE(4), 34);
    assert.strictEqual(nether.readInt32LE(8), 1);
    assert.strictEqual(nether.readUInt8(12), 45);
  });

  it("decodes signed 16-bit Bedrock height-map values without throwing on valid buffers", () => {
    const raw = Buffer.alloc(512 + 256, 0);
    raw.writeInt16LE(-64, 0);
    raw.writeInt16LE(63, 2);
    raw.writeInt16LE(319, 510);

    const heights = decodeChunkHeightMap(raw);
    assert.strictEqual(heights.length, 256);
    assert.strictEqual(heights[0], -64);
    assert.strictEqual(heights[1], 63);
    assert.strictEqual(heights[255], 319);
  });

  it("encodes Bedrock SubChunk (tag 47) keys with signed subChunkY", () => {
    const overworld = createSubChunkDataKey(10, -5, 0, 4);
    assert.strictEqual(overworld.length, 10);
    assert.strictEqual(overworld.readInt32LE(0), 10);
    assert.strictEqual(overworld.readInt32LE(4), -5);
    assert.strictEqual(overworld.readUInt8(8), 47);
    assert.strictEqual(overworld.readInt8(9), 4);

    const negativeY = createSubChunkDataKey(10, -5, 0, -3);
    assert.strictEqual(negativeY.readInt8(9), -3);

    const nether = createSubChunkDataKey(10, -5, 1, 2);
    assert.strictEqual(nether.length, 14);
    assert.strictEqual(nether.readInt32LE(0), 10);
    assert.strictEqual(nether.readInt32LE(4), -5);
    assert.strictEqual(nether.readInt32LE(8), 1);
    assert.strictEqual(nether.readUInt8(12), 47);
    assert.strictEqual(nether.readInt8(13), 2);
  });

  it("resolves surface material colors for village structures, roads, and water", () => {
    const pathColor = surfaceMapColor({ height: 64, blockName: "minecraft:grass_path" }, 0);
    assert.deepStrictEqual(pathColor, BLOCK_MATERIAL_COLORS["minecraft:grass_path"]);

    const woodColor = surfaceMapColor({ height: 70, blockName: "minecraft:oak_planks" }, 0);
    assert.ok(woodColor[0] > 140 && woodColor[1] > 110, "Oak planks should be warm wood");

    // Water depth attenuation
    const shallow = getWaterColorWithDepth(0);
    const deep = getWaterColorWithDepth(25);
    assert.ok(shallow[2] > deep[2], "Shallow water should be brighter than deep water");
  });

  it("decodes SubChunk block palette or gracefully falls back", async () => {
    const dummy = Buffer.alloc(10);
    const heights = new Int16Array(256).fill(64);
    const result = await decodeSubChunkSurfaceBlocks(dummy, heights, 4);
    assert.strictEqual(result, null);
  });

  it("decodes version-8 single-palette persistent SubChunk storage with the local-persistence palette-count field", async () => {
    const subChunkY = 4;
    const blockName = "minecraft:oak_planks";
    const heights = new Int16Array(256).fill(64);

    const buf = buildSingleValuePersistentSubChunk(8, subChunkY, blockName);
    const result = await decodeSubChunkSurfaceBlocks(buf, heights, subChunkY);

    assert.notStrictEqual(result, null);
    assert.strictEqual(result!.length, 256);
    for (let i = 0; i < 256; i += 1) {
      assert.strictEqual(result![i], "minecraft:oak_planks");
    }
  });

  it("decodes version-9 single-palette persistent SubChunk storage and validates stored Y", async () => {
    const subChunkY = -1;
    const blockName = "minecraft:stone";
    const heights = new Int16Array(256).fill(-1);

    const buf = buildSingleValuePersistentSubChunk(9, subChunkY, blockName);
    const result = await decodeSubChunkSurfaceBlocks(buf, heights, subChunkY);

    assert.notStrictEqual(result, null);
    assert.strictEqual(result![0], "minecraft:stone");
    assert.strictEqual(result![255], "minecraft:stone");

    // Mismatched stored Y (stored Y = 0 called with subChunkY = -1)
    const mismatchedBuf = buildSingleValuePersistentSubChunk(9, 0, blockName);
    const mismatchedResult = await decodeSubChunkSurfaceBlocks(mismatchedBuf, heights, -1);
    assert.strictEqual(mismatchedResult, null);
  });

  it("rejects undocumented local-persistence bitsPerBlock=0 block storage instead of treating NBT as an implicit palette", async () => {
    const invalid = Buffer.concat([
      Buffer.from([
        9,
        1,
        4,
        0
      ]),
      encodePersistentBlockState("minecraft:stone")
    ]);

    const heights = new Int16Array(256).fill(64);

    const result = await decodeSubChunkSurfaceBlocks(
      invalid,
      heights,
      4
    );

    assert.strictEqual(result, null);
  });

  it("decodes packed persistent primary storage with Bedrock XZY block indexing", async () => {
    const palette = ["minecraft:oak_planks", "minecraft:cobblestone"];
    const subChunkY = 4;
    const heights = new Int16Array(256).fill(64); // 64 - 4*16 = 0, so localY = 0

    // Set x=5, z=3, y=0 to palette index 1 (cobblestone), all other blocks index 0
    const buf = buildPackedPersistentSubChunk(subChunkY, 1, palette, (x, y, z) => {
      if (x === 5 && z === 3 && y === 0) return 1;
      return 0;
    });

    const result = await decodeSubChunkSurfaceBlocks(buf, heights, subChunkY);
    assert.notStrictEqual(result, null);
    // colIdx for (x=5, z=3) is 3 * 16 + 5 = 53
    assert.strictEqual(result![3 * 16 + 5], "minecraft:cobblestone");
    // Default column (0, 0) resolves index 0
    assert.strictEqual(result![0], "minecraft:oak_planks");
  });

  describe("SubChunk Decoder Corruption & Bounds", () => {
    const heights = new Int16Array(256).fill(64);

    it("A. returns null when storageCount=0", async () => {
      const buf = Buffer.from([9, 0, 4, 0]);
      const res = await decodeSubChunkSurfaceBlocks(buf, heights, 4);
      assert.strictEqual(res, null);
    });

    it("B. returns null when runtime/network storage header low bit=1", async () => {
      const buf = Buffer.from([9, 1, 4, 1]);
      const res = await decodeSubChunkSurfaceBlocks(buf, heights, 4);
      assert.strictEqual(res, null);
    });

    it("C. returns null when unsupported bitsPerBlock=7", async () => {
      const buf = Buffer.from([9, 1, 4, (7 << 1) | 0]);
      const res = await decodeSubChunkSurfaceBlocks(buf, heights, 4);
      assert.strictEqual(res, null);
    });

    it("D. returns null when packed word area is truncated", async () => {
      const buf = Buffer.concat([Buffer.from([9, 1, 4, (1 << 1) | 0]), Buffer.alloc(100)]);
      const res = await decodeSubChunkSurfaceBlocks(buf, heights, 4);
      assert.strictEqual(res, null);
    });

    it("E. returns null when missing palette size after packed words", async () => {
      const buf = Buffer.concat([Buffer.from([9, 1, 4, (1 << 1) | 0]), Buffer.alloc(512)]);
      const res = await decodeSubChunkSurfaceBlocks(buf, heights, 4);
      assert.strictEqual(res, null);
    });

    it("F. returns null when paletteSize <= 0", async () => {
      const size0 = Buffer.alloc(4);
      size0.writeInt32LE(0, 0);
      const buf0 = Buffer.concat([Buffer.from([9, 1, 4, (1 << 1) | 0]), Buffer.alloc(512), size0]);
      assert.strictEqual(await decodeSubChunkSurfaceBlocks(buf0, heights, 4), null);

      const sizeNeg = Buffer.alloc(4);
      sizeNeg.writeInt32LE(-5, 0);
      const bufNeg = Buffer.concat([Buffer.from([9, 1, 4, (1 << 1) | 0]), Buffer.alloc(512), sizeNeg]);
      assert.strictEqual(await decodeSubChunkSurfaceBlocks(bufNeg, heights, 4), null);
    });

    it("G. returns null when paletteSize > 4096", async () => {
      const sizeTooBig = Buffer.alloc(4);
      sizeTooBig.writeInt32LE(4097, 0);
      const buf = Buffer.concat([Buffer.from([9, 1, 4, (1 << 1) | 0]), Buffer.alloc(512), sizeTooBig]);
      assert.strictEqual(await decodeSubChunkSurfaceBlocks(buf, heights, 4), null);
    });

    it("H. returns null when declared paletteSize=2 but only one complete NBT compound is present", async () => {
      const size2 = Buffer.alloc(4);
      size2.writeInt32LE(2, 0);
      const oneNbt = encodePersistentBlockState("minecraft:stone");
      const buf = Buffer.concat([Buffer.from([9, 1, 4, (1 << 1) | 0]), Buffer.alloc(512), size2, oneNbt]);
      assert.strictEqual(await decodeSubChunkSurfaceBlocks(buf, heights, 4), null);
    });

    it("I. returns null when packed index references palette slot >= paletteSize", async () => {
      const wordsBuf = Buffer.alloc(512, 0);
      wordsBuf.writeUInt32LE(1, 0); // index 0 has pIdx = 1
      const size1 = Buffer.alloc(4);
      size1.writeInt32LE(1, 0);
      const oneNbt = encodePersistentBlockState("minecraft:stone");
      const buf = Buffer.concat([Buffer.from([9, 1, 4, (1 << 1) | 0]), wordsBuf, size1, oneNbt]);
      assert.strictEqual(await decodeSubChunkSurfaceBlocks(buf, heights, 4), null);
    });

    it("J. returns null on malformed block-state NBT", async () => {
      const malformedNbt = Buffer.from([0x0a, 0x00, 0x00, 0xff, 0xff]);
      const buf = Buffer.concat([Buffer.from([8, 1, 0]), malformedNbt]);
      assert.strictEqual(await decodeSubChunkSurfaceBlocks(buf, heights, 4), null);
    });
  });

  it("propagates a SubChunk LevelDB read failure instead of silently using biome fallback", async () => {
    // Valid 512-byte Data3D heightmap record for chunk (0,0) with height 128 (realY = 128 - 64 = 64)
    const heightRecord = Buffer.alloc(512);
    for (let i = 0; i < 256; i += 1) {
      heightRecord.writeInt16LE(128, i * 2);
    }

    const data3dKeyHex = createChunkDataKey(0, 0, 0, 43).toString("hex");

    const reader = {
      async get(key: Buffer): Promise<Buffer | null> {
        if (key.toString("hex") === data3dKeyHex) {
          return heightRecord;
        }
        if ((key.length === 10 && key[8] === 47) || (key.length === 14 && key[12] === 47)) {
          throw new Error("SENTINEL_SUBCHUNK_DB_READ_FAILURE");
        }
        return null;
      }
    };

    await assert.rejects(
      async () => {
        await renderWorldMapTile(reader, {
          dimensionId: 0,
          tileX: 0,
          tileZ: 0
        });
      },
      (err: any) => {
        assert.strictEqual(err.message, "SENTINEL_SUBCHUNK_DB_READ_FAILURE");
        return true;
      }
    );
  });

  it("falls back to biome/elevation rendering when a SubChunk read succeeds but bytes are malformed", async () => {
    // Valid 512-byte Data3D heightmap record for chunk (0,0) with height 128 (realY = 128 - 64 = 64)
    const heightRecord = Buffer.alloc(512);
    for (let i = 0; i < 256; i += 1) {
      heightRecord.writeInt16LE(128, i * 2);
    }

    const data3dKeyHex = createChunkDataKey(0, 0, 0, 43).toString("hex");

    const reader = {
      async get(key: Buffer): Promise<Buffer | null> {
        if (key.toString("hex") === data3dKeyHex) {
          return heightRecord;
        }
        if ((key.length === 10 && key[8] === 47) || (key.length === 14 && key[12] === 47)) {
          // Malformed SubChunk bytes: decodeSubChunkSurfaceBlocks returns null
          return Buffer.from([8, 0]); // storageCount = 0
        }
        return null;
      }
    };

    const tile = await renderWorldMapTile(reader, {
      dimensionId: 0,
      tileX: 0,
      tileZ: 0
    });

    assert.strictEqual(tile.generatedChunks, 1);
    assert.strictEqual(tile.missingChunks, 63);

    const rgba = Buffer.from(tile.rgbaBase64, "base64");
    assert.ok((rgba[3] ?? 0) > 0, "Rendered chunk pixels must have non-zero alpha");
  });

  describe("Bedrock Biome Registry & Colors", () => {
    it("matches all locked Bedrock numeric registry IDs exactly", () => {
      const requiredOverworld = [
        [40, "warm_ocean", [42, 138, 172]],
        [41, "deep_warm_ocean", [24, 102, 138]],
        [42, "lukewarm_ocean", [34, 112, 155]],
        [43, "deep_lukewarm_ocean", [20, 80, 125]],
        [44, "cold_ocean", [28, 74, 130]],
        [45, "deep_cold_ocean", [18, 56, 106]],
        [46, "frozen_ocean", [136, 178, 208]],
        [47, "deep_frozen_ocean", [56, 90, 136]],
        [48, "bamboo_jungle", [76, 166, 40]],
        [49, "bamboo_jungle_hills", [70, 156, 36]]
      ] as const;

      for (const [id, name, color] of requiredOverworld) {
        const entry = BEDROCK_BIOME_COLORS[id];
        assert.ok(entry, `Missing entry for biome ID ${id} (${name})`);
        assert.strictEqual(entry.name, name);
        assert.deepStrictEqual(entry.color, color);
      }

      const requiredModern = [
        [178, "soul_sand_valley", [84, 70, 60]],
        [179, "crimson_forest", [144, 28, 28]],
        [180, "warped_forest", [22, 126, 124]],
        [181, "basalt_deltas", [68, 64, 72]],
        [182, "jagged_peaks", [238, 244, 250]],
        [183, "frozen_peaks", [218, 234, 246]],
        [184, "snowy_slopes", [228, 236, 244]],
        [185, "grove", [182, 202, 192]],
        [186, "meadow", [108, 174, 76]],
        [187, "lush_caves", [90, 156, 60]],
        [188, "dripstone_caves", [134, 104, 80]],
        [189, "stony_peaks", [136, 130, 122]],
        [190, "deep_dark", [14, 26, 38]],
        [191, "mangrove_swamp", [50, 96, 62]],
        [192, "cherry_grove", [238, 172, 196]],
        [193, "pale_garden", [156, 168, 152]]
      ] as const;

      for (const [id, name, color] of requiredModern) {
        const entry = BEDROCK_BIOME_COLORS[id];
        assert.ok(entry, `Missing entry for modern biome ID ${id} (${name})`);
        assert.strictEqual(entry.name, name);
        assert.deepStrictEqual(entry.color, color);
      }

      // Assert Overworld ocean IDs 40-43 are NOT End colors
      for (const id of [40, 41, 42, 43]) {
        assert.notDeepStrictEqual(BEDROCK_BIOME_COLORS[id]!.color, DEFAULT_END_COLOR);
      }

      // Assert bamboo jungle 48/49 are green-dominant
      for (const id of [48, 49]) {
        const c = BEDROCK_BIOME_COLORS[id]!.color;
        assert.ok(c[1] > c[0] && c[1] > c[2], `ID ${id} must be green-dominant`);
      }

      // Assert 179 crimson forest is red-dominant
      const crimson = BEDROCK_BIOME_COLORS[179]!.color;
      assert.ok(crimson[0] > crimson[1] && crimson[0] > crimson[2], "Crimson forest must be red-dominant");

      // Assert 180 warped forest is teal/cyan family (G and B high, R low)
      const warped = BEDROCK_BIOME_COLORS[180]!.color;
      assert.ok(warped[1] > warped[0] && warped[2] > warped[0], "Warped forest must be teal-family");

      // Dimension-specific biome color isolation
      assert.deepStrictEqual(getBiomeBaseColor(40, 0), [42, 138, 172]);
      assert.deepStrictEqual(getBiomeBaseColor(40, 2), DEFAULT_END_COLOR);
      assert.deepStrictEqual(getBiomeBaseColor(1, 1), DEFAULT_NETHER_COLOR);
      assert.deepStrictEqual(getBiomeBaseColor(178, 1), [84, 70, 60]);
      assert.deepStrictEqual(getBiomeBaseColor(178, 0), DEFAULT_OVERWORLD_COLOR);
      assert.deepStrictEqual(getBiomeBaseColor(9, 2), [220, 222, 158]);
      assert.deepStrictEqual(getBiomeBaseColor(9, 0), DEFAULT_OVERWORLD_COLOR);

      // Legacy vs modern frozen ocean naming
      assert.strictEqual(BEDROCK_BIOME_COLORS[10]!.name, "legacy_frozen_ocean");
      assert.strictEqual(BEDROCK_BIOME_COLORS[46]!.name, "frozen_ocean");
    });
  });

  it("classifies surface colors by biome at identical elevations", () => {
    const height = 64;
    const plainsColor = surfaceMapColor({ height, biomeId: 1 }, 0); // Plains
    const desertColor = surfaceMapColor({ height, biomeId: 2 }, 0); // Desert
    const oceanColor = surfaceMapColor({ height, biomeId: 0 }, 0); // Ocean
    const snowyColor = surfaceMapColor({ height, biomeId: 12 }, 0); // Snowy Plains
    const badlandsColor = surfaceMapColor({ height, biomeId: 37 }, 0); // Badlands

    assert.ok(plainsColor[1] > plainsColor[0] && plainsColor[1] > plainsColor[2], "Plains must be green-dominant");
    assert.ok(desertColor[0] > desertColor[2] && desertColor[1] > desertColor[2], "Desert must be warm sand tan");
    assert.ok(oceanColor[2] > oceanColor[0], "Ocean must be blue-dominant");
    assert.ok(snowyColor[0] > 220 && snowyColor[1] > 230 && snowyColor[2] > 240, "Snowy Plains must be pale white-cyan");
    assert.ok(badlandsColor[0] > 180 && badlandsColor[0] > badlandsColor[1], "Badlands must be terracotta orange-red");

    assert.notDeepStrictEqual(plainsColor, desertColor);
    assert.notDeepStrictEqual(plainsColor, oceanColor);
    assert.notDeepStrictEqual(plainsColor, snowyColor);
    assert.notDeepStrictEqual(plainsColor, badlandsColor);
  });

  it("renders high plains as green-family and does not turn gray at Y=160", () => {
    const highPlains = surfaceMapColor({ height: 160, biomeId: 1 }, 0);
    assert.ok(
      highPlains[1] > highPlains[0] && highPlains[1] > highPlains[2],
      `High elevation plains must remain green, got RGB: [${highPlains.join(", ")}]`
    );
    const diffRG = Math.abs(highPlains[0] - highPlains[1]);
    assert.ok(diffRG > 30, `Green channel must distinctively exceed Red in plains (diff: ${diffRG})`);
  });

  it("renders low desert as sand/tan and does not turn into water at Y=50", () => {
    const lowDesert = surfaceMapColor({ height: 50, biomeId: 2 }, 0);
    assert.ok(
      lowDesert[0] > lowDesert[2] && lowDesert[1] > lowDesert[2],
      `Low desert must remain warm tan, got RGB: [${lowDesert.join(", ")}]`
    );
    assert.ok(lowDesert[2] < 160, `Low desert must not have high blue channel like water (${lowDesert[2]})`);
  });

  describe("Data3D Decoder Specifications", () => {
    it("A. decodes single runtime palette with flag 1 fixture", () => {
      const tail = buildSingleValueData3DBiomeTail(2); // Desert
      const chunk = Buffer.concat([Buffer.alloc(512, 0), tail]);
      const heights = new Int16Array(256).fill(64);

      const biomes = decodeChunkBiomes(chunk, heights, 0, 43);
      assert.ok(biomes !== null);
      assert.strictEqual(biomes.length, 256);
      for (let i = 0; i < 256; i += 1) {
        assert.strictEqual(biomes[i], 2);
      }
    });

    it("B. decodes packed two-biome palette and verifies x/z/y sampling order", () => {
      const indices = new Uint8Array(4096);
      // Index formula: localY * 256 + z * 16 + x
      // Set (x=0, z=0, localY=0) to 0 (Plains=1)
      // Set (x=5, z=3, localY=4) to 1 (Desert=2) -> index = 4 * 256 + 3 * 16 + 5 = 1024 + 48 + 5 = 1077
      indices[1077] = 1;

      const tail = buildPackedTwoBiomeData3DBiomeTail(1, 2, indices);
      const chunk = Buffer.concat([Buffer.alloc(512, 0), tail]);

      // Heightmap at (x=0, z=0) -> Y = -64 (subchunk 0, localY 0)
      // Heightmap at (x=5, z=3) -> Y = -64 + 4 = -60 (subchunk 0, localY 4)
      const heights = new Int16Array(256).fill(-64);
      heights[3 * 16 + 5] = -60;

      const biomes = decodeChunkBiomes(chunk, heights, 0, 43);
      assert.ok(biomes !== null);
      assert.strictEqual(biomes[0], 1, "Coordinate (0, 0) must resolve Plains (1)");
      assert.strictEqual(biomes[3 * 16 + 5], 2, "Coordinate (5, 3) must resolve Desert (2)");
    });

    it("C. resolves palette-copy marker by walking downward to earlier ordinary palette", () => {
      // Subchunk 0: ordinary palette (Desert = 2)
      const sub0 = buildSingleValueData3DBiomeTail(2);
      // Subchunk 1: palette copy marker (flags = 255 -> bitsPerBlock = 127)
      const sub1 = Buffer.from([255]);

      const chunk = Buffer.concat([Buffer.alloc(512, 0), sub0, sub1]);
      // Height in subchunk 1 (e.g. Y = -48 for Overworld -> subchunk 1)
      const heights = new Int16Array(256).fill(-48);

      const biomes = decodeChunkBiomes(chunk, heights, 0, 43);
      assert.ok(biomes !== null);
      assert.strictEqual(biomes[0], 2, "Copy marker must resolve from downward ordinary palette");
    });

    it("D. refuses persistent palette safely without losing height terrain", () => {
      // Persistent palette has low bit = 0 (e.g. flags = 0 or 2)
      const persistentTail = Buffer.from([0, 1, 2, 3, 4]);
      const chunk = Buffer.concat([Buffer.alloc(512, 0), persistentTail]);
      const heights = new Int16Array(256).fill(64);

      const biomes = decodeChunkBiomes(chunk, heights, 0, 43);
      assert.strictEqual(biomes, null, "Persistent palette must return null for biomes");
    });

    it("E. handles truncated packed words safely", () => {
      const tail = Buffer.alloc(10);
      tail.writeUInt8(3, 0); // bitsPerBlock = 1 (needs 512 bytes of packed words)
      const chunk = Buffer.concat([Buffer.alloc(512, 0), tail]);
      const heights = new Int16Array(256).fill(64);

      const biomes = decodeChunkBiomes(chunk, heights, 0, 43);
      assert.strictEqual(biomes, null);
    });

    it("F. handles missing palette-size field safely", () => {
      // 1 byte flags + 512 bytes words, but truncated before paletteSize Int32
      const tail = Buffer.alloc(1 + 512);
      tail.writeUInt8(3, 0);
      const chunk = Buffer.concat([Buffer.alloc(512, 0), tail]);
      const heights = new Int16Array(256).fill(64);

      const biomes = decodeChunkBiomes(chunk, heights, 0, 43);
      assert.strictEqual(biomes, null);
    });

    it("G. handles negative palette size safely", () => {
      const tail = Buffer.alloc(1 + 512 + 4);
      tail.writeUInt8(3, 0);
      tail.writeInt32LE(-1, 513); // Negative palette size
      const chunk = Buffer.concat([Buffer.alloc(512, 0), tail]);
      const heights = new Int16Array(256).fill(64);

      const biomes = decodeChunkBiomes(chunk, heights, 0, 43);
      assert.strictEqual(biomes, null);
    });

    it("H. handles absurd palette size > 4096 safely", () => {
      const tail = Buffer.alloc(1 + 512 + 4);
      tail.writeUInt8(3, 0);
      tail.writeInt32LE(5000, 513);
      const chunk = Buffer.concat([Buffer.alloc(512, 0), tail]);
      const heights = new Int16Array(256).fill(64);

      const biomes = decodeChunkBiomes(chunk, heights, 0, 43);
      assert.strictEqual(biomes, null);
    });

    it("I. handles truncated palette data safely", () => {
      const tail = Buffer.alloc(1 + 512 + 4 + 2); // needs 8 bytes for paletteSize=2, only has 2
      tail.writeUInt8(3, 0);
      tail.writeInt32LE(2, 513);
      const chunk = Buffer.concat([Buffer.alloc(512, 0), tail]);
      const heights = new Int16Array(256).fill(64);

      const biomes = decodeChunkBiomes(chunk, heights, 0, 43);
      assert.strictEqual(biomes, null);
    });

    it("J. handles unpacked palette index outside palette size safely", () => {
      // 2 bits per block -> values 0, 1, 2, 3
      // Palette has size 2 (indices 0 and 1 only)
      // Value 3 in index 0 is >= paletteSize (2) -> must return null
      const indices = new Uint16Array(4096);
      indices[0] = 3;
      const tail = buildPackedMultiBiomeData3DBiomeTail(2, [1, 2], indices);
      const chunk = Buffer.concat([Buffer.alloc(512, 0), tail]);
      const heights = new Int16Array(256).fill(64);

      const biomes = decodeChunkBiomes(chunk, heights, 0, 43);
      assert.strictEqual(biomes, null);
    });

    it("K. handles unsupported bit width (e.g. 7) safely", () => {
      const tail = Buffer.alloc(50);
      tail.writeUInt8((7 << 1) | 1, 0); // bitsPerBlock = 7
      const chunk = Buffer.concat([Buffer.alloc(512, 0), tail]);
      const heights = new Int16Array(256).fill(64);

      const biomes = decodeChunkBiomes(chunk, heights, 0, 43);
      assert.strictEqual(biomes, null);
    });

    it("L. throws error if Data3D record < 512 bytes and does not attempt Data2D fallback", async () => {
      const data3dKey = createChunkDataKey(0, 0, 0, 43).toString("hex");
      let data2dAttempted = false;

      const reader = {
        async get(key: Buffer): Promise<Buffer | null> {
          if (key.toString("hex") === data3dKey) {
            return Buffer.alloc(200); // Malformed heightmap (< 512 bytes)
          }
          data2dAttempted = true;
          return null;
        }
      };

      await assert.rejects(async () => {
        await renderWorldMapTile(reader, { dimensionId: 0, tileX: 0, tileZ: 0 });
      });

      assert.strictEqual(data2dAttempted, false, "Must not attempt Data2D fallback after malformed Data3D");
    });

    it("M. falls back to Data2D when Data3D is absent", async () => {
      const data2dKey = createChunkDataKey(0, 0, 0, 45).toString("hex");
      const chunk = Buffer.alloc(768, 0);
      for (let i = 0; i < 256; i += 1) chunk.writeInt16LE(64, i * 2);
      for (let i = 0; i < 256; i += 1) chunk.writeUInt8(2, 512 + i); // Desert

      const reader = {
        async get(key: Buffer): Promise<Buffer | null> {
          if (key.toString("hex") === data2dKey) return chunk;
          return null;
        }
      };

      const tile = await renderWorldMapTile(reader, { dimensionId: 0, tileX: 0, tileZ: 0 });
      assert.strictEqual(tile.generatedChunks, 1);
      assert.strictEqual(tile.heightSourceCounts.data2d, 1);
      assert.strictEqual(tile.heightSourceCounts.data3d, 0);
    });

    it("N. propagates real LevelDB read error and does not fall back to Data2D", async () => {
      const data3dTag = 43;
      let data2dAttempted = false;

      const reader = {
        async get(key: Buffer): Promise<Buffer | null> {
          const tag = key[key.length - 1];
          if (tag === data3dTag) {
            throw new Error("SENTINEL_DB_READ_FAILURE");
          }
          data2dAttempted = true;
          return null;
        }
      };

      await assert.rejects(
        async () => {
          await renderWorldMapTile(reader, { dimensionId: 0, tileX: 0, tileZ: 0 });
        },
        (err: any) => {
          assert.strictEqual(err.message, "SENTINEL_DB_READ_FAILURE");
          return true;
        }
      );

      assert.strictEqual(data2dAttempted, false);
    });

    it("O. renders completely transparent tile when both Data3D and Data2D are absent", async () => {
      const reader = {
        async get(_key: Buffer): Promise<Buffer | null> {
          return null;
        }
      };

      const tile = await renderWorldMapTile(reader, { dimensionId: 0, tileX: 0, tileZ: 0 });
      assert.strictEqual(tile.generatedChunks, 0);
      assert.strictEqual(tile.missingChunks, 64);

      const rgba = Buffer.from(tile.rgbaBase64, "base64");
      for (let i = 3; i < rgba.length; i += 4) {
        assert.strictEqual(rgba[i], 0, `Pixel alpha at index ${i} must be 0`);
      }
    });

    it("P. keeps terrain rendering module structurally read-only", () => {
      const source = fs.readFileSync(path.join(process.cwd(), "src", "core", "worldMap.ts"), "utf8");
      assert.ok(!/\.(?:put|delete|del|compact|batch)\s*\(/.test(source));
      assert.ok(source.includes("export interface ReadOnlyWorldMapDb"));
      assert.ok(source.includes("get(key: Buffer): Promise<Buffer | null>"));
    });
  });
});
