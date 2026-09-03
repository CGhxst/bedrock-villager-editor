import { z } from "zod";
import { clonePreservingBinary, deepEqualSafe } from "./clone";
import { toEditableVillagerState } from "./editableState";
import { getEnchantmentById, getEnchantmentByName } from "./enchantments";
import {
  NBT_BYTE_MAX,
  NBT_FLOAT_MAX,
  NBT_INT_MAX,
  NBT_INT_MIN,
  NBT_SHORT_MAX
} from "./nbtNumericRanges";
import { isKnownProfession } from "./professions";
import { WorldSession } from "./session/WorldSession";
import { allocateUniqueTradeId } from "./tradeIds";
import {
  Coordinates3D,
  EnchantmentData,
  ParsedVillager,
  TradeItem,
  TradeRecipe,
  TrustedVillagerImportUpdate
} from "./types";
import { ITEM_ID_RE } from "./validation";

export const tradeItemExchangeSchema = z.strictObject({
  id: z.string().min(1, "Item ID cannot be empty").optional(),
  count: z
    .number()
    .int()
    .min(NBT_INT_MIN)
    .max(NBT_INT_MAX)
    .optional(),
  damage: z
    .number()
    .int()
    .min(NBT_INT_MIN)
    .max(NBT_INT_MAX)
    .optional(),
  enchantments: z
    .array(
      z.strictObject({
        id: z.number().int().optional(),
        name: z.string().min(1, "Enchantment name cannot be empty"),
        level: z
          .number()
          .int()
          .min(0, "Enchantment level cannot be negative")
          .max(32767, "Enchantment level cannot exceed 32767")
      })
    )
    .optional()
});

export const tradeExchangeSchema = z.strictObject({
  tradeId: z.string().min(1).optional(),
  tier: z.number().int().min(0, "Tier cannot be negative").max(10).optional(),
  buyA: tradeItemExchangeSchema.optional(),
  buyB: tradeItemExchangeSchema.nullable().optional(),
  sell: tradeItemExchangeSchema.optional(),
  maxUses: z.number().int().min(0).max(2147483647).optional(),
  uses: z.number().int().min(0).max(2147483647).optional(),
  traderExp: z.number().int().min(0).max(2147483647).optional(),
  rewardExp: z.boolean().optional(),
  priceMultiplierA: z
    .number()
    .refine(Number.isFinite, "priceMultiplierA must be finite")
    .optional(),
  priceMultiplierB: z
    .number()
    .refine(Number.isFinite, "priceMultiplierB must be finite")
    .optional(),
  demand: z.number().int().min(NBT_INT_MIN).max(NBT_INT_MAX).optional(),
  buyCountA: z.number().int().min(0).max(2147483647).optional(),
  buyCountB: z.number().int().min(0).max(2147483647).optional()
});

export const villagerExchangeItemSchema = z.strictObject({
  id: z.string().min(1, "Villager ID cannot be empty"),
  customName: z.string().nullable().optional(),
  profession: z.string().min(1).optional(),
  careerLevel: z
    .number()
    .int()
    .min(0, "Career level cannot be negative")
    .max(5, "Career level cannot exceed 5")
    .optional(),
  experience: z.number().int().min(0).max(2147483647).optional(),
  position: z
    .strictObject({
      x: z.number().refine(Number.isFinite, "Position X must be a finite number"),
      y: z.number().refine(Number.isFinite, "Position Y must be a finite number"),
      z: z.number().refine(Number.isFinite, "Position Z must be a finite number")
    })
    .optional(),
  trades: z.array(tradeExchangeSchema).optional()
});

export const villagerJsonExchangeSchema = z.union([
  z.strictObject({
    schemaVersion: z.string().optional(),
    worldName: z.string().optional(),
    exportedAt: z.string().optional(),
    villagerCount: z.number().int().optional(),
    villagers: z.array(villagerExchangeItemSchema)
  }),
  z.array(villagerExchangeItemSchema)
]);

export interface VillagerJsonExportTradeItem {
  id: string;
  count: number;
  damage?: number;
  enchantments?: Array<{ id?: number; name: string; level: number }>;
}

export interface VillagerJsonExportTrade {
  tradeId: string;
  tier: number;
  buyA: VillagerJsonExportTradeItem;
  buyB: VillagerJsonExportTradeItem | null;
  sell: VillagerJsonExportTradeItem;
  maxUses: number;
  uses: number;
  traderExp: number;
  rewardExp: boolean;
  priceMultiplierA: number;
  priceMultiplierB?: number;
  demand?: number;
}

export interface VillagerJsonExportItem {
  id: string;
  customName: string | null;
  profession: string;
  careerLevel: number;
  experience: number;
  position: Coordinates3D;
  trades: VillagerJsonExportTrade[];
}

export interface WorldVillagersJsonExport {
  schemaVersion: "1.1";
  worldName: string;
  exportedAt: string;
  villagerCount: number;
  villagers: VillagerJsonExportItem[];
}

function requireTradeId(
  villagerId: string,
  trade: TradeRecipe,
  index: number
): string {
  if (!trade.id || !trade.id.trim()) {
    throw new Error(
      `Cannot export villager "${villagerId}" trade ${index + 1}: the trade has no stable internal ID. Reopen the world before exporting JSON.`
    );
  }
  return trade.id;
}

function exportTradesForVillager(villager: ParsedVillager): VillagerJsonExportTrade[] {
  const seen = new Set<string>();

  return villager.trades.map((trade, index) => {
    const tradeId = requireTradeId(
      villager.sessionVillagerId,
      trade,
      index
    );

    if (seen.has(tradeId)) {
      throw new Error(
        `Cannot export villager "${villager.sessionVillagerId}": duplicate stable trade ID "${tradeId}". Reopen the world before exporting JSON.`
      );
    }

    seen.add(tradeId);

    return {
      tradeId,
      tier: trade.tier,
      buyA: {
        id: trade.buyA.id,
        count: trade.buyA.count,
        damage: trade.buyA.damage,
        enchantments: trade.buyA.enchantments?.map((e) => ({
          id: e.id,
          name: e.name,
          level: e.level
        }))
      },
      buyB: trade.buyB
        ? {
            id: trade.buyB.id,
            count: trade.buyB.count,
            damage: trade.buyB.damage,
            enchantments: trade.buyB.enchantments?.map((e) => ({
              id: e.id,
              name: e.name,
              level: e.level
            }))
          }
        : null,
      sell: {
        id: trade.sell.id,
        count: trade.sell.count,
        damage: trade.sell.damage,
        enchantments: trade.sell.enchantments?.map((e) => ({
          id: e.id,
          name: e.name,
          level: e.level
        }))
      },
      maxUses: trade.maxUses,
      uses: trade.uses,
      traderExp: trade.traderExp,
      rewardExp: Boolean(trade.rewardExp),
      priceMultiplierA: trade.priceMultiplierA,
      priceMultiplierB: trade.priceMultiplierB,
      demand: trade.demand
    };
  });
}

export function exportVillagersToJson(session: WorldSession): string {
  const villagers = session.getAllCurrentVillagers();
  const exportItems: VillagerJsonExportItem[] = villagers.map((v) => ({
    id: v.sessionVillagerId,
    customName: v.customName,
    profession: v.profession,
    careerLevel: v.careerLevel,
    experience: v.experience,
    position: {
      x: v.position.x,
      y: v.position.y,
      z: v.position.z
    },
    trades: exportTradesForVillager(v)
  }));

  const payload: WorldVillagersJsonExport = {
    schemaVersion: "1.1",
    worldName: session.getWorldName() || "world",
    exportedAt: new Date().toISOString(),
    villagerCount: exportItems.length,
    villagers: exportItems
  };

  return JSON.stringify(payload, null, 2);
}

function validateNewOrChangedItemId(id: string): string {
  if (
    id.length < 1 ||
    id.length > 100 ||
    !ITEM_ID_RE.test(id)
  ) {
    throw new Error(
      `Invalid Bedrock item ID "${id}". Use a namespaced ID such as "minecraft:emerald".`
    );
  }

  return id.toLowerCase();
}

function validateWritableNewCount(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > NBT_BYTE_MAX) {
    throw new Error(
      `Item count ${value} cannot be written as a Bedrock NBT byte. Use a value from 0 to ${NBT_BYTE_MAX}.`
    );
  }
  return value;
}

function validateWritableNewDamage(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > NBT_SHORT_MAX) {
    throw new Error(
      `Item damage ${value} cannot be written as a Bedrock NBT short. Use a value from 0 to ${NBT_SHORT_MAX}.`
    );
  }
  return value;
}

function validateWritableFloat32(value: number, fieldName: string): number {
  if (
    !Number.isFinite(value) ||
    value < -NBT_FLOAT_MAX ||
    value > NBT_FLOAT_MAX
  ) {
    throw new Error(
      `${fieldName} ${value} cannot be represented as a finite Bedrock NBT float.`
    );
  }
  return value;
}

function mergeEnchantmentsForExistingItem(
  imported: Array<{ id?: number; name: string; level: number }>,
  existing: EnchantmentData[] | undefined
): EnchantmentData[] | undefined {
  if (imported.length === 0) {
    return undefined;
  }

  const existingList = existing || [];
  const usedExistingIndexes = new Set<number>();
  const seenNumericIds = new Set<number>();
  const seenOpaqueNames = new Set<string>();
  const result: EnchantmentData[] = [];

  for (const imp of imported) {
    if (imp.id !== undefined) {
      const knownDef = getEnchantmentById(imp.id);
      if (knownDef) {
        // Case A: Known catalog definition
        const nameDef = getEnchantmentByName(imp.name);
        if (!nameDef || nameDef.id !== imp.id) {
          throw new Error(
            `Enchantment ID ${imp.id} does not match recognized name "${imp.name}" (expected "${knownDef.name}").`
          );
        }
        if (seenNumericIds.has(imp.id)) {
          throw new Error(`Duplicate enchantment ID ${imp.id} on item.`);
        }
        seenNumericIds.add(imp.id);

        const matchIndex = existingList.findIndex(
          (e, idx) => !usedExistingIndexes.has(idx) && e.id === imp.id
        );

        if (matchIndex !== -1) {
          usedExistingIndexes.add(matchIndex);
          const matched = clonePreservingBinary(existingList[matchIndex]!);
          matched.id = imp.id;
          matched.name = knownDef.name;
          matched.level = imp.level;
          result.push(matched);
        } else {
          result.push({
            id: knownDef.id,
            name: knownDef.name,
            level: imp.level,
            rawNbt: undefined
          });
        }
      } else {
        // Case B: Unknown numeric enchantment
        const matchIndex = existingList.findIndex(
          (e, idx) =>
            !usedExistingIndexes.has(idx) &&
            e.id === imp.id &&
            e.name.toLowerCase() === imp.name.toLowerCase()
        );

        if (matchIndex === -1) {
          throw new Error(
            `Unknown enchantment ID ${imp.id} cannot be added through JSON.`
          );
        }

        if (seenNumericIds.has(imp.id)) {
          throw new Error(`Duplicate enchantment ID ${imp.id} on item.`);
        }
        seenNumericIds.add(imp.id);

        usedExistingIndexes.add(matchIndex);
        const matched = clonePreservingBinary(existingList[matchIndex]!);
        matched.level = imp.level;
        result.push(matched);
      }
    } else {
      // Case C: id is undefined
      const knownDef = getEnchantmentByName(imp.name);
      if (knownDef) {
        if (seenNumericIds.has(knownDef.id)) {
          throw new Error(`Duplicate enchantment ID ${knownDef.id} on item.`);
        }
        seenNumericIds.add(knownDef.id);

        const matchIndex = existingList.findIndex(
          (e, idx) => !usedExistingIndexes.has(idx) && e.id === knownDef.id
        );

        if (matchIndex !== -1) {
          usedExistingIndexes.add(matchIndex);
          const matched = clonePreservingBinary(existingList[matchIndex]!);
          matched.id = knownDef.id;
          matched.name = knownDef.name;
          matched.level = imp.level;
          result.push(matched);
        } else {
          result.push({
            id: knownDef.id,
            name: knownDef.name,
            level: imp.level,
            rawNbt: undefined
          });
        }
      } else {
        // Unknown opaque name
        const matchIndex = existingList.findIndex(
          (e, idx) =>
            !usedExistingIndexes.has(idx) &&
            e.id === undefined &&
            e.name.toLowerCase() === imp.name.toLowerCase()
        );

        if (matchIndex === -1) {
          throw new Error(
            `Unknown enchantment "${imp.name}" cannot be added through JSON without a known Bedrock ID.`
          );
        }

        const lowerName = imp.name.toLowerCase();
        if (seenOpaqueNames.has(lowerName)) {
          throw new Error(`Duplicate enchantment name "${imp.name}" on item.`);
        }
        seenOpaqueNames.add(lowerName);

        usedExistingIndexes.add(matchIndex);
        const matched = clonePreservingBinary(existingList[matchIndex]!);
        matched.level = imp.level;
        result.push(matched);
      }
    }
  }

  return result;
}

function createEnchantmentsForNewItem(
  imported?: Array<{ id?: number; name: string; level: number }>
): EnchantmentData[] | undefined {
  if (!imported || imported.length === 0) return undefined;

  const seenIds = new Set<number>();
  const result: EnchantmentData[] = [];

  for (const imp of imported) {
    let def: ReturnType<typeof getEnchantmentById>;
    if (imp.id !== undefined) {
      def = getEnchantmentById(imp.id);
      if (!def) {
        throw new Error(
          `Unknown enchantment ID ${imp.id} cannot be added through JSON.`
        );
      }
      const nameDef = getEnchantmentByName(imp.name);
      if (!nameDef || nameDef.id !== imp.id) {
        throw new Error(
          `Enchantment ID ${imp.id} does not match recognized name "${imp.name}" (expected "${def.name}").`
        );
      }
    } else {
      def = getEnchantmentByName(imp.name);
      if (!def) {
        throw new Error(
          `Unknown enchantment "${imp.name}" cannot be added through JSON without a known Bedrock ID.`
        );
      }
    }

    if (seenIds.has(def.id)) {
      throw new Error(`Duplicate enchantment ID ${def.id} on item.`);
    }
    seenIds.add(def.id);

    result.push({
      id: def.id,
      name: def.name,
      level: imp.level,
      rawNbt: undefined
    });
  }

  return result;
}

function mergeItem(
  patch: z.infer<typeof tradeItemExchangeSchema> | undefined | null,
  existing: TradeItem | null
): TradeItem | null {
  if (patch === undefined) {
    return existing ? clonePreservingBinary(existing) : null;
  }
  if (patch === null) {
    return null;
  }

  // If existing item exists and id is omitted or unchanged
  if (existing && (patch.id === undefined || patch.id === existing.id)) {
    const item = clonePreservingBinary(existing);
    if (patch.count !== undefined && patch.count !== existing.count) {
      item.count = validateWritableNewCount(patch.count);
    }
    if (patch.damage !== undefined) {
      if (existing.damage === undefined && patch.damage === 0) {
        // Preserve missing tag. Do nothing.
      } else if (patch.damage !== existing.damage) {
        item.damage = validateWritableNewDamage(patch.damage);
      }
    }
    if (patch.enchantments !== undefined) {
      item.enchantments = mergeEnchantmentsForExistingItem(
        patch.enchantments,
        existing.enchantments
      );
    }
    return item;
  }

  // Item is new or changed id -> clean TradeItem (no old rawTag, no old rawNbt)
  if (!patch.id) {
    throw new Error("Item ID is required for a new item.");
  }
  const newId = validateNewOrChangedItemId(patch.id);
  const count = validateWritableNewCount(
    patch.count !== undefined ? patch.count : 1
  );
  const damage =
    patch.damage === undefined
      ? undefined
      : validateWritableNewDamage(patch.damage);

  return {
    id: newId,
    count,
    damage,
    enchantments: createEnchantmentsForNewItem(patch.enchantments)
  };
}

function mergeTradesForVillager(
  jsonTrades: Array<z.infer<typeof tradeExchangeSchema>>,
  liveVillager: ParsedVillager
): TradeRecipe[] {
  const usedTradeIds = new Set<string>();
  for (const trade of liveVillager.trades) {
    if (!trade.id || !trade.id.trim()) {
      throw new Error(
        `Villager "${liveVillager.sessionVillagerId}" contains a trade without a stable ID. Reopen the world before importing JSON.`
      );
    }
    if (usedTradeIds.has(trade.id)) {
      throw new Error(
        `Villager "${liveVillager.sessionVillagerId}" contains duplicate internal trade ID "${trade.id}". Reopen the world before importing JSON.`
      );
    }
    usedTradeIds.add(trade.id);
  }

  // Reject duplicate tradeId values inside one supplied trades array
  const seenIds = new Set<string>();
  for (const t of jsonTrades) {
    if (t.tradeId) {
      if (seenIds.has(t.tradeId)) {
        throw new Error(`Duplicate tradeId "${t.tradeId}" in villager trades array.`);
      }
      seenIds.add(t.tradeId);
    }
  }

  const result: TradeRecipe[] = [];

  for (const t of jsonTrades) {
    if (t.tradeId) {
      const existing = liveVillager.trades.find((et) => et.id === t.tradeId);
      if (!existing) {
        throw new Error(
          `Mismatched or stale trade ID "${t.tradeId}" on villager "${liveVillager.sessionVillagerId}".`
        );
      }

      const merged: TradeRecipe = clonePreservingBinary(existing);
      merged.id = t.tradeId;

      if (t.tier !== undefined) merged.tier = t.tier;
      if (t.buyA !== undefined) {
        const buyA = mergeItem(t.buyA, existing.buyA);
        if (!buyA) throw new Error("buyA cannot be null.");
        merged.buyA = buyA;
      }
      if (t.buyB !== undefined) {
        merged.buyB = mergeItem(t.buyB, existing.buyB);
      }
      if (t.sell !== undefined) {
        const sell = mergeItem(t.sell, existing.sell);
        if (!sell) throw new Error("sell cannot be null.");
        merged.sell = sell;
      }
      if (t.maxUses !== undefined) merged.maxUses = t.maxUses;
      if (t.uses !== undefined) merged.uses = t.uses;
      if (t.traderExp !== undefined) merged.traderExp = t.traderExp;
      if (t.rewardExp !== undefined) merged.rewardExp = t.rewardExp;
      if (t.priceMultiplierA !== undefined && t.priceMultiplierA !== existing.priceMultiplierA) {
        merged.priceMultiplierA = validateWritableFloat32(t.priceMultiplierA, "priceMultiplierA");
      }
      if (t.priceMultiplierB !== undefined && t.priceMultiplierB !== existing.priceMultiplierB) {
        merged.priceMultiplierB = validateWritableFloat32(t.priceMultiplierB, "priceMultiplierB");
      }
      if (t.demand !== undefined) merged.demand = t.demand;

      // buyCount alias consistency validation
      if (t.buyCountA !== undefined) {
        if (t.buyCountA !== merged.buyA.count) {
          throw new Error("buyCountA is derived from buyA.count. Edit buyA.count instead.");
        }
      }
      if (t.buyCountB !== undefined) {
        if (!merged.buyB || t.buyCountB !== merged.buyB.count) {
          throw new Error("buyCountB is derived from buyB.count. Edit buyB.count instead.");
        }
      }

      result.push(merged);
    } else {
      // Genuinely new trade without tradeId
      if (!t.buyA || !t.buyA.id) {
        throw new Error("New trade requires buyA with valid item ID.");
      }
      if (!t.sell || !t.sell.id) {
        throw new Error("New trade requires sell with valid item ID.");
      }

      if (t.buyCountA !== undefined) {
        throw new Error("buyCountA is derived from buyA.count. Edit buyA.count instead.");
      }
      if (t.buyCountB !== undefined) {
        throw new Error("buyCountB is derived from buyB.count. Edit buyB.count instead.");
      }

      const uniqueId = allocateUniqueTradeId(usedTradeIds);

      const buyA = mergeItem(t.buyA, null)!;
      const buyB = t.buyB ? mergeItem(t.buyB, null) : null;
      const sell = mergeItem(t.sell, null)!;

      result.push({
        id: uniqueId,
        tier: t.tier !== undefined ? t.tier : 1,
        buyA,
        buyB,
        sell,
        maxUses: t.maxUses !== undefined ? t.maxUses : 16,
        uses: t.uses !== undefined ? t.uses : 0,
        traderExp: t.traderExp !== undefined ? t.traderExp : 1,
        rewardExp: t.rewardExp !== undefined ? Boolean(t.rewardExp) : true,
        priceMultiplierA:
          t.priceMultiplierA !== undefined
            ? validateWritableFloat32(t.priceMultiplierA, "priceMultiplierA")
            : 0.05,
        priceMultiplierB:
          t.priceMultiplierB !== undefined
            ? validateWritableFloat32(t.priceMultiplierB, "priceMultiplierB")
            : undefined,
        demand: t.demand,
        buyCountA: undefined,
        buyCountB: undefined,
        rawRecipe: undefined
      });
    }
  }

  return result;
}

export interface ImportVillagersResult {
  success: boolean;
  modifiedCount: number;
  error?: string;
}

export function importVillagersFromJson(
  session: WorldSession,
  jsonString: string
): ImportVillagersResult {
  let parsedJson: any;
  try {
    parsedJson = JSON.parse(jsonString);
  } catch (err: any) {
    return {
      success: false,
      modifiedCount: 0,
      error: `Invalid JSON format: ${err.message}`
    };
  }

  // Section 22: Fail closed on unknown explicit schema versions
  if (typeof parsedJson === "object" && parsedJson !== null && !Array.isArray(parsedJson)) {
    const explicitSchemaVersion = parsedJson.schemaVersion;
    if (
      explicitSchemaVersion !== undefined &&
      explicitSchemaVersion !== "1.0" &&
      explicitSchemaVersion !== "1.1"
    ) {
      return {
        success: false,
        modifiedCount: 0,
        error: `Unsupported JSON schema version "${String(explicitSchemaVersion)}".`
      };
    }
  }

  // V1.0 compatibility check (Section 17)
  const schemaVersion =
    typeof parsedJson === "object" && parsedJson !== null && !Array.isArray(parsedJson)
      ? parsedJson.schemaVersion
      : undefined;

  const rawVillagerList = Array.isArray(parsedJson)
    ? parsedJson
    : parsedJson && typeof parsedJson === "object" && Array.isArray(parsedJson.villagers)
    ? parsedJson.villagers
    : [];

  if (schemaVersion !== "1.1") {
    const hasTrades = rawVillagerList.some(
      (v: any) => v && typeof v === "object" && v.trades !== undefined
    );
    if (hasTrades) {
      return {
        success: false,
        modifiedCount: 0,
        error:
          "This JSON export does not contain stable trade IDs. Re-export the world with the current editor before importing trade changes."
      };
    }
  }

  const validation = villagerJsonExchangeSchema.safeParse(parsedJson);
  if (!validation.success) {
    const errorDetails = validation.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    return {
      success: false,
      modifiedCount: 0,
      error: `JSON schema validation failed: ${errorDetails}`
    };
  }

  const rawVillagers = Array.isArray(validation.data)
    ? validation.data
    : validation.data.villagers;

  if (rawVillagers.length === 0) {
    return {
      success: false,
      modifiedCount: 0,
      error: "Import JSON contains 0 villagers."
    };
  }

  // Defect A (Section 4): Reject duplicate villager IDs in JSON
  const seenVillagerIds = new Set<string>();
  const duplicateVillagerIds = new Set<string>();

  for (const item of rawVillagers) {
    if (seenVillagerIds.has(item.id)) {
      duplicateVillagerIds.add(item.id);
    } else {
      seenVillagerIds.add(item.id);
    }
  }

  if (duplicateVillagerIds.size > 0) {
    return {
      success: false,
      modifiedCount: 0,
      error: `JSON import contains duplicate villager IDs: ${Array.from(
        duplicateVillagerIds
      ).join(", ")}. Each villager may appear only once.`
    };
  }

  const allCurrent = session.getAllCurrentVillagers();
  const liveMap = new Map<string, ParsedVillager>();
  for (const live of allCurrent) {
    liveMap.set(live.sessionVillagerId, live);
  }

  // Section 30: Unknown villager IDs fail closed
  const unmatched = rawVillagers
    .map((v) => v.id)
    .filter((id) => !liveMap.has(id));

  if (unmatched.length > 0) {
    return {
      success: false,
      modifiedCount: 0,
      error: `JSON import contains villager IDs that do not exist in the active session: ${unmatched.join(
        ", "
      )}. Re-export this world before importing changes.`
    };
  }

  const villagerUpdates: TrustedVillagerImportUpdate[] = [];

  try {
    for (const item of rawVillagers) {
      const live = liveMap.get(item.id)!;

      // Validate profession
      if (item.profession !== undefined) {
        if (!isKnownProfession(item.profession)) {
          return {
            success: false,
            modifiedCount: 0,
            error: `Unknown villager profession "${item.profession}".`
          };
        }
      }

      // Validate careerLevel
      if (item.careerLevel !== undefined) {
        if (item.careerLevel < 0 || item.careerLevel > 5) {
          return {
            success: false,
            modifiedCount: 0,
            error: `Career level must be between 0 and 5, got ${item.careerLevel}.`
          };
        }
      }

      // Merge trades if present
      let mergedTrades: TradeRecipe[] | undefined;
      let tradesChanged = false;
      if (item.trades !== undefined) {
        mergedTrades = mergeTradesForVillager(item.trades, live);
        tradesChanged = !deepEqualSafe(mergedTrades, live.trades);
      }

      // Build proposed merged state for exact semantic comparison
      const proposed = clonePreservingBinary(live);
      if (item.customName !== undefined) proposed.customName = item.customName;
      if (item.profession !== undefined) proposed.profession = item.profession;
      if (item.careerLevel !== undefined) proposed.careerLevel = item.careerLevel;
      if (item.experience !== undefined) proposed.experience = item.experience;
      if (item.position !== undefined) proposed.position = clonePreservingBinary(item.position);
      if (mergedTrades !== undefined) proposed.trades = mergedTrades;

      // Compare with live editable state
      const semanticChanged = !deepEqualSafe(
        toEditableVillagerState(live),
        toEditableVillagerState(proposed)
      );

      const actualChanged = semanticChanged || tradesChanged;

      if (actualChanged) {
        villagerUpdates.push({
          villagerId: live.sessionVillagerId,
          customName: item.customName,
          profession: item.profession,
          careerLevel: item.careerLevel,
          experience: item.experience,
          position: item.position,
          trades: tradesChanged ? mergedTrades : undefined
        });
      }
    }
  } catch (err: any) {
    return {
      success: false,
      modifiedCount: 0,
      error: err.message || "Failed to process villager updates."
    };
  }

  if (villagerUpdates.length === 0) {
    return {
      success: true,
      modifiedCount: 0
    };
  }

  const commandResult = session.applyTrustedImportUpdates(
    villagerUpdates,
    `Imported JSON updates for ${villagerUpdates.length} villager(s)`
  );

  if (!commandResult.success) {
    return {
      success: false,
      modifiedCount: 0,
      error: commandResult.error || "Failed to apply imported villager data."
    };
  }

  return {
    success: true,
    modifiedCount: villagerUpdates.length
  };
}
