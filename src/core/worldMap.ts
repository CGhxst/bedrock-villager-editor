import * as nbt from "prismarine-nbt";
import { WorldMapTile, WorldMapTileRequest } from "./types";
import {
  getBiomeBaseColor,
  getBlockOrBiomeColor,
  getWaterColorWithDepth,
  WATER_BIOME_IDS,
  NON_SOLID_PASS_THROUGH_BLOCKS,
  DEFAULT_OVERWORLD_COLOR,
  DEFAULT_NETHER_COLOR,
  DEFAULT_END_COLOR
} from "./worldMapBiomeColors";

/**
 * Read-only terrain overview support.
 *
 * This module intentionally accepts only a get() capability. It cannot put(),
 * delete(), compact, or otherwise mutate a Bedrock world. The rendered map is
 * a high-fidelity surface preview with real block material colors (paths, roofs,
 * masonry, farmland, and flat water depth attenuation) derived from Bedrock's
 * SubChunks with fallback to persisted Data3D/Data2D height and biome maps.
 */
export interface ReadOnlyWorldMapDb {
  get(key: Buffer): Promise<Buffer | null>;
}

export const WORLD_MAP_TILE_CHUNKS = 8;
export const WORLD_MAP_TILE_BLOCKS = WORLD_MAP_TILE_CHUNKS * 16;

const TAG_DATA_3D = 43;
const TAG_DATA_2D = 45;
const TAG_SUBCHUNK = 47;
const HEIGHTMAP_BYTES = 16 * 16 * 2;
const MISSING_HEIGHT = -32768;
const SEA_LEVEL = 62;

function assertInt32(value: number, label: string): void {
  if (!Number.isInteger(value) || value < -2147483648 || value > 2147483647) {
    throw new Error(`${label} must be a signed 32-bit integer.`);
  }
}

export function createChunkDataKey(
  chunkX: number,
  chunkZ: number,
  dimensionId: 0 | 1 | 2,
  tag: number
): Buffer {
  assertInt32(chunkX, "Chunk X");
  assertInt32(chunkZ, "Chunk Z");

  if (!Number.isInteger(tag) || tag < 0 || tag > 255) {
    throw new Error("Chunk data tag must be a byte value.");
  }

  if (dimensionId === 0) {
    const key = Buffer.alloc(9);
    key.writeInt32LE(chunkX, 0);
    key.writeInt32LE(chunkZ, 4);
    key.writeUInt8(tag, 8);
    return key;
  }

  const key = Buffer.alloc(13);
  key.writeInt32LE(chunkX, 0);
  key.writeInt32LE(chunkZ, 4);
  key.writeInt32LE(dimensionId, 8);
  key.writeUInt8(tag, 12);
  return key;
}

export function createSubChunkDataKey(
  chunkX: number,
  chunkZ: number,
  dimensionId: 0 | 1 | 2,
  subChunkY: number
): Buffer {
  assertInt32(chunkX, "Chunk X");
  assertInt32(chunkZ, "Chunk Z");
  if (!Number.isInteger(subChunkY) || subChunkY < -128 || subChunkY > 127) {
    throw new Error("SubChunk Y must be a signed byte (-128 to 127).");
  }

  if (dimensionId === 0) {
    const key = Buffer.alloc(10);
    key.writeInt32LE(chunkX, 0);
    key.writeInt32LE(chunkZ, 4);
    key.writeUInt8(TAG_SUBCHUNK, 8);
    key.writeInt8(subChunkY, 9);
    return key;
  }

  const key = Buffer.alloc(14);
  key.writeInt32LE(chunkX, 0);
  key.writeInt32LE(chunkZ, 4);
  key.writeInt32LE(dimensionId, 8);
  key.writeUInt8(TAG_SUBCHUNK, 12);
  key.writeInt8(subChunkY, 13);
  return key;
}

/**
 * Decodes a Bedrock SubChunk (tag 47) block storage to extract the highest non-pass-through
 * surface block name for each column in the 16x16 chunk area.
 */
export async function decodeSubChunkSurfaceBlocks(
  val: Buffer,
  heights: Int16Array,
  subChunkY: number
): Promise<Array<string | null> | null> {
  try {
    if (val.length < 3) return null;
    const version = val[0];
    if (version !== 8 && version !== 9) return null;

    let offset = 2; // skip version and numStorages
    if (version >= 9) {
      offset += 1; // skip subChunkY byte in v9
    }

    if (offset >= val.length) return null;
    const storageHeader = val[offset++];
    if (storageHeader === undefined) return null;
    const bitsPerBlock = storageHeader >> 1;
    const isRuntime = storageHeader & 1;

    // Persisted LevelDB chunks store NBT palettes (isRuntime === 0)
    if (isRuntime === 1) return null;

    let palette: string[] = [];
    let wordsOffset = 0;
    let blocksPerWord = 0;

    if (bitsPerBlock === 0) {
      if (offset + 4 > val.length) return null;
      const paletteSize = val.readInt32LE(offset);
      offset += 4;
      if (paletteSize < 1 || offset >= val.length) return null;
      const parsed = await nbt.parse(val.slice(offset), "little");
      const blockName = parsed.parsed.value?.name?.value;
      if (typeof blockName !== "string") return null;
      palette = [blockName];
    } else {
      blocksPerWord = Math.floor(32 / bitsPerBlock);
      if (blocksPerWord <= 0) return null;
      const wordCount = Math.ceil(4096 / blocksPerWord);
      wordsOffset = offset;
      offset += wordCount * 4;

      if (offset + 4 > val.length) return null;
      const paletteSize = val.readInt32LE(offset);
      offset += 4;

      if (paletteSize < 1 || paletteSize > 4096) return null;

      for (let p = 0; p < paletteSize; p += 1) {
        if (offset >= val.length) break;
        const res = await nbt.parse(val.slice(offset), "little");
        const name = res.parsed.value?.name?.value;
        if (typeof name !== "string") return null;
        palette.push(name);
        offset += res.metadata?.size ?? 0;
      }
    }

    if (palette.length === 0) return null;

    function getBlockAt(localX: number, localY: number, localZ: number): string | null {
      if (bitsPerBlock === 0) {
        return palette[0] ?? null;
      }
      const index = (localX << 8) | (localZ << 4) | localY;
      const wordIdx = Math.floor(index / blocksPerWord);
      const bitOffset = (index % blocksPerWord) * bitsPerBlock;
      const word = val.readUInt32LE(wordsOffset + wordIdx * 4);
      const mask = (1 << bitsPerBlock) - 1;
      const pIdx = (word >>> bitOffset) & mask;
      return palette[pIdx] ?? null;
    }

    const result = new Array<string | null>(256);
    result.fill(null);
    const subChunkMinY = subChunkY * 16;
    const subChunkMaxY = subChunkMinY + 15;

    for (let z = 0; z < 16; z += 1) {
      for (let x = 0; x < 16; x += 1) {
        const colIdx = z * 16 + x;
        const h = heights[colIdx] ?? MISSING_HEIGHT;
        if (h === MISSING_HEIGHT) continue;

        // CRITICAL: Only sample this subchunk if this column's surface height h
        // actually resides in this subchunk.
        // If h < subChunkMinY, this subchunk is in the sky above this column.
        // If h > subChunkMaxY, this subchunk is underground below this column.
        if (h < subChunkMinY || h > subChunkMaxY) {
          continue;
        }

        const startLocalY = h - subChunkMinY; // Guaranteed 0..15!
        for (let y = startLocalY; y >= 0; y -= 1) {
          const b = getBlockAt(x, y, z);
          if (b && !NON_SOLID_PASS_THROUGH_BLOCKS.has(b)) {
            result[colIdx] = b;
            break;
          }
        }
      }
    }

    return result;
  } catch {
    return null;
  }
}

export function decodeChunkHeightMap(
  value: Buffer,
  dimensionId?: 0 | 1 | 2,
  tag?: number
): Int16Array {
  if (value.length < HEIGHTMAP_BYTES) {
    throw new Error(
      `Chunk height-map record is too short: expected at least ${HEIGHTMAP_BYTES} bytes, got ${value.length}.`
    );
  }

  // In Bedrock Data3D (tag 43), the Overworld (dimension 0) heightmap is stored 0-indexed
  // from world bottom (Y = -64). Raw 0 is Y=-64, raw 64 is Y=0, raw 128 is Y=64.
  // We subtract 64 to obtain authentic world Y elevations.
  const yOffset = (tag === TAG_DATA_3D || tag === undefined) && dimensionId === 0 ? 64 : 0;

  const heights = new Int16Array(16 * 16);
  for (let i = 0; i < heights.length; i += 1) {
    heights[i] = value.readInt16LE(i * 2) - yOffset;
  }
  return heights;
}

/**
 * Decodes 3D or 2D biome data following the 512-byte heightmap.
 * Returns a 256-element array of biome IDs for each (x, z) column, or null on fallback.
 */
export function decodeChunkBiomes(
  value: Buffer,
  heights: Int16Array,
  dimensionId: 0 | 1 | 2,
  tag?: number
): Int32Array | null {
  if (value.length <= HEIGHTMAP_BYTES) {
    return null;
  }

  // 1. If explicit Data2D tag, decode 256-byte 2D biome array
  if (tag === TAG_DATA_2D) {
    if (value.length >= HEIGHTMAP_BYTES + 256) {
      const biomes = new Int32Array(256);
      for (let i = 0; i < 256; i += 1) {
        biomes[i] = value.readUInt8(HEIGHTMAP_BYTES + i);
      }
      return biomes;
    }
    return null;
  }

  // 2. Try Data3D paletted subchunk decoding
  const paletted = tryDecodeData3DBiomes(value, heights, dimensionId);
  if (paletted !== null) {
    return paletted;
  }

  // 3. Try 2D biome array fallback (256 bytes) if tag is not specified
  if (tag === undefined && value.length >= HEIGHTMAP_BYTES + 256) {
    const biomes = new Int32Array(256);
    for (let i = 0; i < 256; i += 1) {
      biomes[i] = value.readUInt8(HEIGHTMAP_BYTES + i);
    }
    return biomes;
  }

  return null;
}

interface DecodedBiomePalette {
  values: Uint16Array | null;
  palette: Int32Array;
  copyPrevious: boolean;
}

function tryDecodeData3DBiomes(
  value: Buffer,
  heights: Int16Array,
  dimensionId: 0 | 1 | 2
): Int32Array | null {
  try {
    let offset = HEIGHTMAP_BYTES;
    const subchunks: DecodedBiomePalette[] = [];
    const maxSubchunks = dimensionId === 0 ? 24 : 16;

    while (offset < value.length && subchunks.length < maxSubchunks) {
      const flags = value.readUInt8(offset++);
      const isPersistent = (flags & 1) === 0;
      if (isPersistent) {
        return null;
      }

      const bitsPerBlock = flags >> 1;

      // Palette copy marker
      if (bitsPerBlock === 127) {
        subchunks.push({
          values: null,
          palette: new Int32Array(0),
          copyPrevious: true
        });
        continue;
      }

      // Single-valued runtime palette (all 4096 entries are palette index 0)
      if (bitsPerBlock === 0) {
        if (offset + 4 > value.length) {
          return null;
        }
        const singleBiomeId = value.readInt32LE(offset);
        offset += 4;
        subchunks.push({
          values: null,
          palette: new Int32Array([singleBiomeId]),
          copyPrevious: false
        });
        continue;
      }

      const ALLOWED_BIT_WIDTHS = [1, 2, 3, 4, 5, 6, 8, 16];
      if (!ALLOWED_BIT_WIDTHS.includes(bitsPerBlock)) {
        return null;
      }

      const blocksPerWord = Math.floor(32 / bitsPerBlock);
      if (blocksPerWord <= 0) {
        return null;
      }

      const wordCount = Math.ceil(4096 / blocksPerWord);
      const wordBytes = wordCount * 4;

      if (offset + wordBytes > value.length) {
        return null;
      }

      const values = new Uint16Array(4096);
      const mask = (1 << bitsPerBlock) - 1;
      for (let i = 0; i < 4096; i += 1) {
        const wordIdx = Math.floor(i / blocksPerWord);
        const bitOffset = (i % blocksPerWord) * bitsPerBlock;
        const word = value.readUInt32LE(offset + wordIdx * 4);
        values[i] = (word >>> bitOffset) & mask;
      }
      offset += wordBytes;

      if (offset + 4 > value.length) {
        return null;
      }
      const paletteSize = value.readInt32LE(offset);
      offset += 4;

      if (paletteSize < 1 || paletteSize > 4096 || offset + paletteSize * 4 > value.length) {
        return null;
      }

      const palette = new Int32Array(paletteSize);
      for (let p = 0; p < paletteSize; p += 1) {
        palette[p] = value.readInt32LE(offset + p * 4);
      }
      offset += paletteSize * 4;

      for (let i = 0; i < 4096; i += 1) {
        if (values[i]! >= paletteSize) {
          return null;
        }
      }

      subchunks.push({
        values,
        palette,
        copyPrevious: false
      });
    }

    if (subchunks.length === 0) {
      return null;
    }

    const biomes = new Int32Array(256);
    const minY = dimensionId === 0 ? -64 : 0;

    for (let z = 0; z < 16; z += 1) {
      for (let x = 0; x < 16; x += 1) {
        const h = heights[z * 16 + x] ?? 64;
        const subchunkIdx = Math.floor((h - minY) / 16);
        let localY = (h - minY) % 16;
        if (localY < 0) localY += 16;

        const clampedIdx = Math.max(0, Math.min(subchunks.length - 1, subchunkIdx));
        let pal: DecodedBiomePalette | null = null;
        for (let s = clampedIdx; s >= 0; s -= 1) {
          const candidate = subchunks[s];
          if (candidate && !candidate.copyPrevious) {
            pal = candidate;
            break;
          }
        }

        if (!pal) {
          biomes[z * 16 + x] = -1;
          continue;
        }

        if (pal.values === null) {
          biomes[z * 16 + x] = pal.palette[0] ?? -1;
        } else {
          const index = localY * 256 + z * 16 + x;
          const pIdx = pal.values[index] ?? 0;
          biomes[z * 16 + x] = pal.palette[pIdx] ?? -1;
        }
      }
    }

    return biomes;
  } catch {
    return null;
  }
}

interface DecodedChunkData {
  heights: Int16Array;
  biomes: Int32Array | null;
}

async function tryReadChunkData(
  db: ReadOnlyWorldMapDb,
  chunkX: number,
  chunkZ: number,
  dimensionId: 0 | 1 | 2,
  tag: number
): Promise<DecodedChunkData | null> {
  const value = await db.get(
    createChunkDataKey(chunkX, chunkZ, dimensionId, tag)
  );

  if (value === null) {
    return null;
  }

  const heights = decodeChunkHeightMap(value, dimensionId, tag);
  const biomes = decodeChunkBiomes(value, heights, dimensionId, tag);
  return { heights, biomes };
}

async function readChunkTerrain(
  db: ReadOnlyWorldMapDb,
  chunkX: number,
  chunkZ: number,
  dimensionId: 0 | 1 | 2
): Promise<{ data: DecodedChunkData; source: "data3d" | "data2d" } | null> {
  const modern = await tryReadChunkData(db, chunkX, chunkZ, dimensionId, TAG_DATA_3D);
  if (modern !== null) {
    return { data: modern, source: "data3d" };
  }

  const legacy = await tryReadChunkData(db, chunkX, chunkZ, dimensionId, TAG_DATA_2D);
  if (legacy !== null) {
    return { data: legacy, source: "data2d" };
  }

  return null;
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

export interface SurfaceMapSample {
  height: number;
  biomeId?: number;
  blockName?: string;
}

/**
 * Computes the 2D surface map color from block identity or biome with subtle elevation shading.
 * Block material defines the terrain/structure hue; elevation provides subtle brightness adjustments.
 */
export function surfaceMapColor(
  sample: SurfaceMapSample,
  dimensionId: 0 | 1 | 2
): [number, number, number] {
  const { height, biomeId, blockName } = sample;
  const base = getBlockOrBiomeColor(blockName, biomeId, dimensionId);

  // Subtle broad elevation shading (+/- 6 max) so hills/plateaus do not alter material hue
  const elevationMod = Math.max(-6, Math.min(6, (height - 64) * 0.04));

  return [
    clampByte(base[0] + elevationMod),
    clampByte(base[1] + elevationMod),
    clampByte(base[2] + elevationMod)
  ];
}

/**
 * Retained for backwards-compatibility with dimension-specific fallback palettes.
 */
export function terrainColorForHeight(
  height: number,
  dimensionId: 0 | 1 | 2
): [number, number, number] {
  return surfaceMapColor({ height, biomeId: undefined }, dimensionId);
}

function writePixel(
  rgba: Uint8Array,
  pixelIndex: number,
  color: [number, number, number],
  shade: number
): void {
  const offset = pixelIndex * 4;
  rgba[offset] = clampByte(color[0] + shade);
  rgba[offset + 1] = clampByte(color[1] + shade);
  rgba[offset + 2] = clampByte(color[2] + shade);
  rgba[offset + 3] = 255;
}

export async function renderWorldMapTile(
  db: ReadOnlyWorldMapDb,
  request: WorldMapTileRequest
): Promise<WorldMapTile> {
  const { dimensionId, tileX, tileZ } = request;

  if (dimensionId !== 0 && dimensionId !== 1 && dimensionId !== 2) {
    throw new Error("World map supports only Overworld, Nether, and The End.");
  }
  if (!Number.isInteger(tileX) || !Number.isInteger(tileZ)) {
    throw new Error("World-map tile coordinates must be integers.");
  }

  const firstChunkX = tileX * WORLD_MAP_TILE_CHUNKS;
  const firstChunkZ = tileZ * WORLD_MAP_TILE_CHUNKS;
  assertInt32(firstChunkX, "Map tile chunk X");
  assertInt32(firstChunkZ, "Map tile chunk Z");
  assertInt32(firstChunkX + WORLD_MAP_TILE_CHUNKS - 1, "Map tile max chunk X");
  assertInt32(firstChunkZ + WORLD_MAP_TILE_CHUNKS - 1, "Map tile max chunk Z");

  const totalBlocks = WORLD_MAP_TILE_BLOCKS * WORLD_MAP_TILE_BLOCKS;
  const heights = new Int16Array(totalBlocks);
  heights.fill(MISSING_HEIGHT);

  const biomes = new Int32Array(totalBlocks);
  biomes.fill(-1);

  const blocks: Array<string | null> = new Array(totalBlocks);
  blocks.fill(null);

  let generatedChunks = 0;
  let missingChunks = 0;
  let data3d = 0;
  let data2d = 0;

  for (let localChunkZ = 0; localChunkZ < WORLD_MAP_TILE_CHUNKS; localChunkZ += 1) {
    for (let localChunkX = 0; localChunkX < WORLD_MAP_TILE_CHUNKS; localChunkX += 1) {
      const chunkX = firstChunkX + localChunkX;
      const chunkZ = firstChunkZ + localChunkZ;
      const chunk = await readChunkTerrain(db, chunkX, chunkZ, dimensionId);

      if (!chunk) {
        missingChunks += 1;
        continue;
      }

      generatedChunks += 1;
      if (chunk.source === "data3d") data3d += 1;
      else data2d += 1;

      // Identify surface subchunks present in this chunk's elevation profile
      const chunkBlocks: Array<string | null> = new Array(256).fill(null);
      const subChunkYSet = new Set<number>();
      for (let i = 0; i < 256; i += 1) {
        const h = chunk.data.heights[i];
        if (h !== undefined && h !== MISSING_HEIGHT) {
          subChunkYSet.add(Math.floor(h / 16));
        }
      }

      for (const subChunkY of subChunkYSet) {
        try {
          const subKey = createSubChunkDataKey(chunkX, chunkZ, dimensionId, subChunkY);
          const subVal = await db.get(subKey);
          if (subVal) {
            const decoded = await decodeSubChunkSurfaceBlocks(subVal, chunk.data.heights, subChunkY);
            if (decoded) {
              for (let i = 0; i < 256; i += 1) {
                if (decoded[i] && !chunkBlocks[i]) {
                  chunkBlocks[i] = decoded[i] ?? null;
                }
              }
            }
          }
        } catch {
          // Graceful fallback to biome heightmap on any subchunk read failure
        }
      }

      for (let z = 0; z < 16; z += 1) {
        for (let x = 0; x < 16; x += 1) {
          const sourceIndex = z * 16 + x;
          const targetX = localChunkX * 16 + x;
          const targetZ = localChunkZ * 16 + z;
          const targetIndex = targetZ * WORLD_MAP_TILE_BLOCKS + targetX;

          heights[targetIndex] = chunk.data.heights[sourceIndex] ?? MISSING_HEIGHT;
          if (chunk.data.biomes) {
            biomes[targetIndex] = chunk.data.biomes[sourceIndex] ?? -1;
          }
          if (chunkBlocks[sourceIndex]) {
            blocks[targetIndex] = chunkBlocks[sourceIndex] ?? null;
          }
        }
      }
    }
  }

  const rgba = new Uint8Array(totalBlocks * 4);

  for (let z = 0; z < WORLD_MAP_TILE_BLOCKS; z += 1) {
    for (let x = 0; x < WORLD_MAP_TILE_BLOCKS; x += 1) {
      const index = z * WORLD_MAP_TILE_BLOCKS + x;
      const height = heights[index] ?? MISSING_HEIGHT;
      if (height === MISSING_HEIGHT) {
        continue;
      }

      const north = z > 0 ? (heights[index - WORLD_MAP_TILE_BLOCKS] ?? height) : height;
      const west = x > 0 ? (heights[index - 1] ?? height) : height;
      const northSafe = north === MISSING_HEIGHT ? height : north;
      const westSafe = west === MISSING_HEIGHT ? height : west;

      const rawBiome = biomes[index];
      const biomeId = rawBiome !== undefined && rawBiome >= 0 ? rawBiome : undefined;
      const blockName = blocks[index] ?? undefined;

      const isWaterBlock = blockName === "minecraft:water" || blockName === "minecraft:flowing_water";
      const isWaterBiome = biomeId !== undefined && WATER_BIOME_IDS.has(biomeId);
      const isWater = isWaterBlock || (isWaterBiome && height <= SEA_LEVEL);

      if (isWater) {
        // Water is calm and flat: no jagged relief shadows
        const baseColor = getBlockOrBiomeColor(blockName ?? "minecraft:water", biomeId, dimensionId);
        const depth = Math.max(0, SEA_LEVEL - height);
        const color = getWaterColorWithDepth(depth, baseColor);
        writePixel(rgba, index, color, 0);
      } else {
        // Land: directional NW hillshading
        const northDiff = northSafe - height;
        const westDiff = westSafe - height;
        const relief = Math.max(-10, Math.min(10, Math.round((northDiff + westDiff) * 1.2)));

        const color = surfaceMapColor({ height, biomeId, blockName }, dimensionId);
        writePixel(rgba, index, color, relief);
      }
    }
  }

  return {
    dimensionId,
    tileX,
    tileZ,
    originBlockX: tileX * WORLD_MAP_TILE_BLOCKS,
    originBlockZ: tileZ * WORLD_MAP_TILE_BLOCKS,
    blockSize: WORLD_MAP_TILE_BLOCKS,
    rgbaBase64: Buffer.from(rgba).toString("base64"),
    generatedChunks,
    missingChunks,
    heightSourceCounts: { data3d, data2d },
    terrainMode: "biome-heightmap"
  };
}

