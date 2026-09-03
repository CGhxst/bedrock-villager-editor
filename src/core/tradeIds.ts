import { randomUUID } from "node:crypto";

export type TradeUuidFactory = () => string;
export type TradeNowFactory = () => number;

export function allocateUniqueTradeId(
  usedIds: Set<string>,
  uuidFactory: TradeUuidFactory = randomUUID,
  nowFactory: TradeNowFactory = Date.now
): string {
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const candidate = `trade_${nowFactory()}_${uuidFactory()}`;

    if (!usedIds.has(candidate)) {
      usedIds.add(candidate);
      return candidate;
    }
  }

  throw new Error(
    "Could not allocate a unique trade ID after 32 attempts."
  );
}
