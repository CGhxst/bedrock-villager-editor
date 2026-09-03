import { isDeepStrictEqual } from "node:util";

/**
 * Deep-clones plain objects, arrays, buffers, and typed arrays while preserving binary contents.
 */
export function clonePreservingBinary<T>(value: T): T {
  if (value === null || typeof value !== "object") {
    return value;
  }

  if (Buffer.isBuffer(value)) {
    return Buffer.from(value) as unknown as T;
  }

  if (ArrayBuffer.isView(value)) {
    const typedArr = value as any;
    return new typedArr.constructor(typedArr.buffer.slice(typedArr.byteOffset, typedArr.byteOffset + typedArr.byteLength)) as T;
  }

  if (Array.isArray(value)) {
    return value.map((item) => clonePreservingBinary(item)) as unknown as T;
  }

  const copy: Record<string, any> = {};
  for (const [k, v] of Object.entries(value as Record<string, any>)) {
    copy[k] = clonePreservingBinary(v);
  }

  return copy as T;
}

/**
 * Robust, BigInt-safe deep equality comparison.
 */
export function deepEqualSafe(a: unknown, b: unknown): boolean {
  return isDeepStrictEqual(a, b);
}

/**
 * Safe JSON debug serializer that handles BigInt, Buffers, and circular structures without throwing.
 */
export function stringifyDebugValue(value: unknown): string {
  const seen = new WeakSet<object>();

  return JSON.stringify(
    value,
    (_key, item) => {
      if (typeof item === "bigint") {
        return {
          __type: "bigint",
          value: item.toString()
        };
      }

      if (Buffer.isBuffer(item)) {
        return {
          __type: "buffer",
          hex: item.toString("hex")
        };
      }

      if (item && typeof item === "object") {
        if (seen.has(item)) {
          return "[Circular]";
        }
        seen.add(item);
      }

      return item;
    },
    2
  );
}
