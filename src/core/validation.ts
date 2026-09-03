import { z } from "zod";
import { NBT_SHORT_MAX } from "./nbtNumericRanges";

export const coordinates3DSchema = z.strictObject({
  x: z.number().finite(),
  y: z.number().finite(),
  z: z.number().finite()
});

export const ITEM_ID_RE = /^[a-z0-9_.-]+:[a-z0-9_./-]+$/i;

export const tradeItemInputSchema = z.strictObject({
  id: z
    .string()
    .min(1)
    .max(100)
    .regex(ITEM_ID_RE, "Invalid Bedrock item ID format (e.g. minecraft:emerald)")
    .transform((val) => val.toLowerCase()),
  count: z.number().int().min(1).max(64),
  damage: z.number().int().min(0).max(NBT_SHORT_MAX).optional()
});

export const tradeSettingsPatchSchema = z.strictObject({
  tier: z.number().int().min(1).max(5).optional(),
  maxUses: z.number().int().min(1).max(99999).optional(),
  uses: z.number().int().min(0).max(99999).optional(),
  traderExp: z.number().int().min(0).max(1000).optional(),
  rewardExp: z.boolean().optional(),
  priceMultiplierA: z.number().finite().min(0).max(100).optional(),
  priceMultiplierB: z.number().finite().min(0).max(100).nullable().optional(),
  demand: z.number().int().min(-1000).max(1000).nullable().optional()
});

export const editableVillagerPatchSchema = z.strictObject({
  customName: z.string().max(100).nullable().optional(),
  profession: z.string().min(1).max(50).optional(),
  careerLevel: z.number().int().min(1).max(5).optional(),
  experience: z.number().int().min(0).max(1000000).optional(),
  position: coordinates3DSchema.optional()
});

export const sessionCommandSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("PATCH_VILLAGER"),
    description: z.string().trim().min(1).max(200),
    villagerId: z.string().min(1).max(200),
    patch: editableVillagerPatchSchema
  }),
  z.strictObject({
    kind: z.literal("TRADE_ADD"),
    description: z.string().trim().min(1).max(200),
    villagerId: z.string().min(1).max(200)
  }),
  z.strictObject({
    kind: z.literal("TRADE_DELETE"),
    description: z.string().trim().min(1).max(200),
    villagerId: z.string().min(1).max(200),
    tradeId: z.string().min(1).max(200)
  }),
  z.strictObject({
    kind: z.literal("TRADE_RESTOCK"),
    description: z.string().trim().min(1).max(200),
    villagerId: z.string().min(1).max(200),
    tradeId: z.string().min(1).max(200)
  }),
  z.strictObject({
    kind: z.literal("TRADE_SET_ITEM"),
    description: z.string().trim().min(1).max(200),
    villagerId: z.string().min(1).max(200),
    tradeId: z.string().min(1).max(200),
    slot: z.enum(["buyA", "buyB", "sell"]),
    item: tradeItemInputSchema.nullable()
  }),
  z.strictObject({
    kind: z.literal("TRADE_SET_ITEM_COUNT"),
    description: z.string().trim().min(1).max(200),
    villagerId: z.string().min(1).max(200),
    tradeId: z.string().min(1).max(200),
    slot: z.enum(["buyA", "buyB", "sell"]),
    count: z.number().int().min(1).max(64)
  }),
  z.strictObject({
    kind: z.literal("TRADE_SET_SETTINGS"),
    description: z.string().trim().min(1).max(200),
    villagerId: z.string().min(1).max(200),
    tradeId: z.string().min(1).max(200),
    patch: tradeSettingsPatchSchema
  }),
  z.strictObject({
    kind: z.literal("TRADE_ADD_ENCHANTMENT"),
    description: z.string().trim().min(1).max(200),
    villagerId: z.string().min(1).max(200),
    tradeId: z.string().min(1).max(200),
    slot: z.literal("sell"),
    enchantmentId: z.number().int().min(0).max(255),
    level: z.number().int().min(1).max(10)
  }),
  z.strictObject({
    kind: z.literal("TRADE_REMOVE_ENCHANTMENT"),
    description: z.string().trim().min(1).max(200),
    villagerId: z.string().min(1).max(200),
    tradeId: z.string().min(1).max(200),
    slot: z.literal("sell"),
    enchantmentIndex: z.number().int().min(0).max(50)
  }),
  z.strictObject({
    kind: z.literal("TRADE_SET_ENCHANTMENT_LEVEL"),
    description: z.string().trim().min(1).max(200),
    villagerId: z.string().min(1).max(200),
    tradeId: z.string().min(1).max(200),
    slot: z.literal("sell"),
    enchantmentIndex: z.number().int().min(0).max(50),
    level: z.number().int().min(1).max(10)
  }),
  z.strictObject({
    kind: z.literal("BULK_SET_COST_QUANTITY_ONE"),
    description: z.string().trim().min(1).max(200),
    villagerIds: z.array(z.string().min(1).max(200)).min(1)
  }),
  z.strictObject({
    kind: z.literal("BULK_RESTOCK"),
    description: z.string().trim().min(1).max(200),
    villagerIds: z.array(z.string().min(1).max(200)).min(1)
  }),
  z.strictObject({
    kind: z.literal("BULK_SET_MAX_USES"),
    description: z.string().trim().min(1).max(200),
    villagerIds: z.array(z.string().min(1).max(200)).min(1),
    maxUses: z.number().int().min(1).max(99999)
  })
]);

export const worldMapTileRequestSchema = z.strictObject({
  dimensionId: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  tileX: z.number().int().min(-200000).max(200000),
  tileZ: z.number().int().min(-200000).max(200000)
});

export const backupIdSchema = z
  .string()
  .regex(/^[a-f0-9]{16}$/, "Invalid backup ID.");
