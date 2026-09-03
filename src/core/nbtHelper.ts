import * as nbt from "prismarine-nbt";
import { NbtEncodingMetadata } from "./types";

export interface ParsedBedrockNbt {
  parsed: any;
  type: string;
  metadata: NbtEncodingMetadata;
}

async function parseExactNbt(
  buffer: Buffer,
  format: "little" | "littleVarint"
): Promise<any> {
  const result: any = await nbt.parse(buffer, format);
  const consumed = result?.metadata?.size;

  if (typeof consumed === "number" && consumed !== buffer.length) {
    throw new Error(`NBT parser consumed ${consumed} of ${buffer.length} bytes.`);
  }

  return result;
}

export async function parseBedrockNbt(buffer: Buffer): Promise<ParsedBedrockNbt> {
  // 1. If buffer starts with root compound tag 0x0a, try direct exact parse
  if (buffer.length > 0 && buffer[0] === 0x0a) {
    try {
      const result: any = await parseExactNbt(buffer, "little");
      return {
        parsed: result.parsed,
        type: result.type,
        metadata: {
          format: "little"
        }
      };
    } catch {
      try {
        const result: any = await parseExactNbt(buffer, "littleVarint");
        return {
          parsed: result.parsed,
          type: result.type,
          metadata: {
            format: "littleVarint"
          }
        };
      } catch {}
    }
  }

  // 2. If buffer has a 4-byte prefix (e.g. actor prefix or length header)
  if (buffer.length > 4) {
    const prefix = buffer.subarray(0, 4);
    const body = buffer.subarray(4);

    try {
      const result: any = await parseExactNbt(body, "little");
      return {
        parsed: result.parsed,
        type: result.type,
        metadata: {
          format: "little",
          prefixHex: prefix.toString("hex")
        }
      };
    } catch {
      try {
        const result: any = await parseExactNbt(body, "littleVarint");
        return {
          parsed: result.parsed,
          type: result.type,
          metadata: {
            format: "littleVarint",
            prefixHex: prefix.toString("hex")
          }
        };
      } catch {}
    }
  }

  // 3. Fallback direct parse attempts
  try {
    const result: any = await parseExactNbt(buffer, "little");
    return {
      parsed: result.parsed,
      type: result.type,
      metadata: {
        format: "little"
      }
    };
  } catch (littleError) {
    try {
      const result: any = await parseExactNbt(buffer, "littleVarint");
      return {
        parsed: result.parsed,
        type: result.type,
        metadata: {
          format: "littleVarint"
        }
      };
    } catch (varintError) {
      throw new Error(
        `Failed to parse Bedrock NBT: ${
          littleError instanceof Error ? littleError.message : String(littleError)
        }`
      );
    }
  }
}

export function writeBedrockNbt(
  data: any,
  format: "little" | "littleVarint" = "little"
): Buffer {
  return Buffer.from(nbt.writeUncompressed(data, format as any));
}

export function encodeBedrockNbtPreservingFormat(
  data: any,
  metadata: NbtEncodingMetadata
): Buffer {
  const body = writeBedrockNbt(data, metadata.format);

  if (!metadata.prefixHex) {
    return body;
  }

  const prefix = Buffer.from(metadata.prefixHex, "hex");
  return Buffer.concat([prefix, body]);
}

export async function parseLittleEndianNbt(buffer: Buffer): Promise<any> {
  const res = await parseBedrockNbt(buffer);
  return res.parsed;
}

export namespace NbtTags {
  export function byte(val: number) {
    return { type: "byte" as const, value: val };
  }
  export function short(val: number) {
    return { type: "short" as const, value: val };
  }
  export function int(val: number) {
    return { type: "int" as const, value: val };
  }
  export function long(val: number | string | bigint | [number, number]) {
    if (typeof val === "number" || typeof val === "string" || typeof val === "bigint") {
      const b = BigInt(val);
      const low = Number(BigInt.asIntN(32, b));
      const high = Number(BigInt.asIntN(32, b >> 32n));
      return { type: "long" as const, value: [high, low] as [number, number] };
    }
    return { type: "long" as const, value: val };
  }
  export function float(val: number) {
    return { type: "float" as const, value: val };
  }
  export function double(val: number) {
    return { type: "double" as const, value: val };
  }
  export function string(val: string) {
    return { type: "string" as const, value: val };
  }
  export function list(itemType: string, val: any[]) {
    return { type: "list" as const, value: { type: itemType, value: val } };
  }
  export function compound(val: Record<string, any>) {
    return { type: "compound" as const, value: val };
  }
}
