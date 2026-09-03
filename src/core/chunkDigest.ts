import { DimensionName } from "./types";

export interface DigestMutation {
  changed: boolean;
  next: Buffer;
}

export function getDimensionId(dimension: DimensionName | number | string): number {
  if (typeof dimension === "number") {
    if (Number.isFinite(dimension) && Number.isInteger(dimension) && dimension >= -2147483648 && dimension <= 2147483647) {
      return dimension;
    }
    throw new Error(`Invalid numeric dimension ID: ${dimension}`);
  }

  const lower = String(dimension ?? "").toLowerCase().trim();
  if (lower === "overworld" || lower === "0") return 0;
  if (lower === "nether" || lower === "1") return 1;
  if (lower === "the_end" || lower === "theend" || lower === "end" || lower === "2") return 2;

  throw new Error(`Unrecognized or unsupported dimension name: "${dimension}"`);
}

export function assertSupportedSpatialDimension(id: number): void {
  if (id !== 0 && id !== 1 && id !== 2) {
    throw new Error(`Spatial villager moves in DimensionId ${id} are not supported safely.`);
  }
}

export function createDigpKey(chunkX: number, chunkZ: number, dimension: DimensionName | number | string): Buffer {
  const dimId = getDimensionId(dimension);
  assertSupportedSpatialDimension(dimId);

  if (dimId === 0) {
    const key = Buffer.alloc(12);
    key.write("digp", 0, "utf8");
    key.writeInt32LE(chunkX, 4);
    key.writeInt32LE(chunkZ, 8);
    return key;
  } else {
    const key = Buffer.alloc(16);
    key.write("digp", 0, "utf8");
    key.writeInt32LE(chunkX, 4);
    key.writeInt32LE(chunkZ, 8);
    key.writeInt32LE(dimId, 12);
    return key;
  }
}

export function computeActorDigestMutation(
  current: Buffer | null | undefined,
  actorId8Bytes: Buffer,
  action: "add" | "remove"
): DigestMutation {
  if (!actorId8Bytes || actorId8Bytes.length !== 8) {
    throw new Error(`Actor ID must be exactly 8 bytes, got ${actorId8Bytes?.length ?? 0} bytes`);
  }

  const currentBuf = current ?? Buffer.alloc(0);
  if (currentBuf.length % 8 !== 0) {
    throw new Error(`Actor digest buffer length (${currentBuf.length}) must be 8-byte aligned`);
  }

  const targetHex = actorId8Bytes.toString("hex");
  const entries: Buffer[] = [];
  let foundTarget = false;

  for (let i = 0; i < currentBuf.length; i += 8) {
    const entry = currentBuf.subarray(i, i + 8);
    if (entry.toString("hex") === targetHex) {
      foundTarget = true;
      if (action === "add") {
        entries.push(entry);
      }
      // If action is remove, omit this target occurrence
    } else {
      entries.push(entry);
    }
  }

  if (action === "add") {
    if (foundTarget) {
      return {
        changed: false,
        next: Buffer.from(currentBuf)
      };
    }
    entries.push(actorId8Bytes);
    return {
      changed: true,
      next: Buffer.concat(entries)
    };
  } else {
    // action === "remove"
    if (!foundTarget) {
      return {
        changed: false,
        next: Buffer.from(currentBuf)
      };
    }
    return {
      changed: true,
      next: Buffer.concat(entries)
    };
  }
}
