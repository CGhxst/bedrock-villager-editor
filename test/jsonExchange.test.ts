import * as assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, it } from "node:test";
import { clonePreservingBinary, deepEqualSafe } from "../src/core/clone";
import {
  exportVillagersToJson,
  importVillagersFromJson
} from "../src/core/jsonExchange";
import { NbtTags, parseBedrockNbt, writeBedrockNbt } from "../src/core/nbtHelper";
import { NBT_FLOAT_MAX } from "../src/core/nbtNumericRanges";
import { WorldSession } from "../src/core/session/WorldSession";
import { ParsedVillager, WorldVillagerDump } from "../src/core/types";
import { parseVillagerNbt } from "../src/core/villagerParser";
import { writeVillagerToNbt } from "../src/core/villagerWriter";

function createRealisticVillagerNbt(customRecipes?: any[]): any {
  const defaultRecipe = {
    buyA: NbtTags.compound({
      Name: NbtTags.string("minecraft:paper"),
      Count: NbtTags.byte(24),
      tag: NbtTags.compound({
        CustomUnknownBuyTag: NbtTags.string("keep-buy-tag")
      })
    }),
    sell: NbtTags.compound({
      Name: NbtTags.string("minecraft:emerald"),
      Count: NbtTags.byte(1),
      tag: NbtTags.compound({
        CustomUnknownSellTag: NbtTags.string("keep-sell-tag")
      })
    }),
    tier: NbtTags.int(1),
    maxUses: NbtTags.int(16),
    uses: NbtTags.int(0),
    traderExp: NbtTags.int(2),
    rewardExp: NbtTags.byte(1),
    priceMultiplierA: NbtTags.float(0.05),
    UnknownRecipeSibling: NbtTags.string("preserve-me")
  };

  return {
    type: "compound",
    name: "",
    value: {
      identifier: NbtTags.string("minecraft:villager_v2"),
      Profession: NbtTags.string("minecraft:librarian"),
      CareerLevel: NbtTags.int(1),
      TradeExperience: NbtTags.int(0),
      Pos: NbtTags.list("float", [10.5, 64, 20.5]),
      SentinelUnknownRoot: NbtTags.int(777),
      Offers: {
        type: "compound",
        value: {
          Recipes: NbtTags.list("compound", customRecipes || [defaultRecipe])
        }
      }
    }
  };
}

function createWorldDumpFromParsed(villagers: ParsedVillager[]): WorldVillagerDump {
  return {
    worldName: "Realistic Test World",
    worldPath: "/mock/world",
    exportedAt: new Date().toISOString(),
    villagerCount: villagers.length,
    summary: {
      byProfession: { librarian: villagers.length },
      withTrades: villagers.length,
      withoutWorkstation: 0,
      zombies: 0,
      cured: 0
    },
    villagers
  };
}

describe("JSON Exchange (V1.1 Trade Identity & Preservation)", () => {
  // Unchanged Realistic Round Trip
  it("exports V1.1 with tradeId and roundtrips unchanged with 0 modified count", () => {
    const rawNbt = createRealisticVillagerNbt();
    const parsed = parseVillagerNbt(rawNbt, "6163746f7270726566697831", 0)!;
    assert.ok(parsed);

    const session = new WorldSession(createWorldDumpFromParsed([parsed]));
    const jsonString = exportVillagersToJson(session);

    const json = JSON.parse(jsonString);
    assert.strictEqual(json.schemaVersion, "1.1");
    assert.strictEqual(json.villagers.length, 1);
    assert.strictEqual(json.villagers[0].trades.length, 1);
    assert.strictEqual(json.villagers[0].trades[0].tradeId, parsed.trades[0]!.id);

    // Re-import unchanged
    const importResult = importVillagersFromJson(session, jsonString);
    assert.strictEqual(importResult.success, true);
    assert.strictEqual(importResult.modifiedCount, 0);
    assert.strictEqual(session.getDirtyCount(), 0);
    assert.strictEqual(session.canUndo(), false);

    const live = session.getVillager(parsed.sessionVillagerId)!;
    assert.strictEqual(live.careerLevel, 1);
    assert.strictEqual(live.profession, "librarian");
    assert.strictEqual(live.trades[0]!.id, parsed.trades[0]!.id);
  });

  // One Trade Count Edit Preserves Unknown NBT
  it("editing one trade count preserves unknown root, recipe, and item tags through binary roundtrip", async () => {
    const rawNbt = createRealisticVillagerNbt();
    const parsed = parseVillagerNbt(rawNbt, "6163746f7270726566697831", 0)!;
    const baseline = clonePreservingBinary(parsed);

    const session = new WorldSession(createWorldDumpFromParsed([parsed]));
    const jsonString = exportVillagersToJson(session);

    const json = JSON.parse(jsonString);
    json.villagers[0].trades[0].buyA.count = 5; // Change count 24 -> 5

    const importResult = importVillagersFromJson(session, JSON.stringify(json));
    assert.strictEqual(importResult.success, true);
    assert.strictEqual(importResult.modifiedCount, 1);
    assert.strictEqual(session.getDirtyCount(), 1);

    const current = session.getVillager(parsed.sessionVillagerId)!;
    assert.strictEqual(current.trades[0]!.buyA.count, 5);

    // Serialize to NBT with baseline
    const writtenNbt = writeVillagerToNbt(current, baseline);

    // Assert sentinels preserved
    assert.strictEqual(writtenNbt.value.SentinelUnknownRoot.value, 777);
    const writtenRecipes = writtenNbt.value.Offers.value.Recipes.value.value || writtenNbt.value.Offers.value.Recipes.value;
    const writtenRecipe = writtenRecipes[0].value || writtenRecipes[0];
    assert.strictEqual(writtenRecipe.UnknownRecipeSibling.value, "preserve-me");
    assert.strictEqual(writtenRecipe.buyA.value.Count.value, 5);
    assert.strictEqual(writtenRecipe.buyA.value.tag.value.CustomUnknownBuyTag.value, "keep-buy-tag");
    assert.strictEqual(writtenRecipe.sell.value.tag.value.CustomUnknownSellTag.value, "keep-sell-tag");

    // Binary encode & parse again
    const encoded = writeBedrockNbt(writtenNbt, "little");
    const parsedResult = await parseBedrockNbt(encoded);
    const reparsed = parsedResult.parsed;
    assert.strictEqual(reparsed.value.SentinelUnknownRoot.value, 777);
    const reparsedRecipes = reparsed.value.Offers.value.Recipes.value.value || reparsed.value.Offers.value.Recipes.value;
    const reparsedRecipe = reparsedRecipes[0].value || reparsedRecipes[0];
    assert.strictEqual(reparsedRecipe.UnknownRecipeSibling.value, "preserve-me");
    assert.strictEqual(reparsedRecipe.buyA.value.Count.value, 5);
    assert.strictEqual(reparsedRecipe.buyA.value.tag.value.CustomUnknownBuyTag.value, "keep-buy-tag");
  });

  // Damage-preservation regression test
  it("items without Damage tag do not synthesize Damage tag on export, count edit, or new trade", () => {
    const rawNbt = createRealisticVillagerNbt();
    const parsed = parseVillagerNbt(rawNbt, "6163746f7270726566697831", 0)!;
    const baseline = clonePreservingBinary(parsed);

    const session = new WorldSession(createWorldDumpFromParsed([parsed]));
    const jsonString = exportVillagersToJson(session);
    const json = JSON.parse(jsonString);

    // Assert exported items have damage undefined (omitted in JSON)
    assert.strictEqual(json.villagers[0].trades[0].buyA.damage, undefined);
    assert.strictEqual(json.villagers[0].trades[0].sell.damage, undefined);

    // Edit only count
    json.villagers[0].trades[0].buyA.count = 12;

    // Also add a new trade with damage omitted
    json.villagers[0].trades.push({
      tier: 1,
      buyA: { id: "minecraft:emerald", count: 1 },
      sell: { id: "minecraft:arrow", count: 16 }
    });

    // Also add a trade with explicit damage: 0
    json.villagers[0].trades.push({
      tier: 1,
      buyA: { id: "minecraft:emerald", count: 1 },
      sell: { id: "minecraft:bow", count: 1, damage: 0 }
    });

    const importResult = importVillagersFromJson(session, JSON.stringify(json));
    assert.strictEqual(importResult.success, true);

    const current = session.getVillager(parsed.sessionVillagerId)!;
    const writtenNbt = writeVillagerToNbt(current, baseline);
    const recipes = writtenNbt.value.Offers.value.Recipes.value.value || writtenNbt.value.Offers.value.Recipes.value;

    const r0 = recipes[0].value || recipes[0];
    assert.strictEqual(r0.buyA.value.Damage, undefined, "Item without Damage must not gain Damage tag");
    assert.strictEqual(r0.sell.value.Damage, undefined, "Item without Damage must not gain Damage tag");

    const r1 = recipes[1].value || recipes[1];
    assert.strictEqual(r1.buyA.value.Damage, undefined, "New item with omitted damage must not have Damage tag");
    assert.strictEqual(r1.sell.value.Damage, undefined, "New item with omitted damage must not have Damage tag");

    const r2 = recipes[2].value || recipes[2];
    assert.ok(r2.sell.value.Damage !== undefined, "Item with explicit damage: 0 must have Damage tag");
    assert.strictEqual(r2.sell.value.Damage.value, 0);
  });

  // Enchantment rawNbt preservation test
  it("preserving existing enchantment rawNbt through unrelated customName JSON edit", async () => {
    const enchantedRecipe = {
      buyA: NbtTags.compound({ Name: NbtTags.string("minecraft:emerald"), Count: NbtTags.byte(10) }),
      sell: NbtTags.compound({
        Name: NbtTags.string("minecraft:enchanted_book"),
        Count: NbtTags.byte(1),
        tag: NbtTags.compound({
          CustomItemTag: NbtTags.string("item-tag-survives"),
          ench: NbtTags.list("compound", [
            {
              id: NbtTags.short(26), // Smite
              lvl: NbtTags.short(1),
              FutureEnchantField: NbtTags.string("keep-enchant-field")
            }
          ])
        })
      }),
      tier: NbtTags.int(1),
      maxUses: NbtTags.int(16),
      uses: NbtTags.int(0),
      traderExp: NbtTags.int(2),
      rewardExp: NbtTags.byte(1),
      priceMultiplierA: NbtTags.float(0.05),
      UnknownRecipeSibling: NbtTags.string("recipe-sibling-survives")
    };

    const rawNbt = createRealisticVillagerNbt([enchantedRecipe]);
    const parsed = parseVillagerNbt(rawNbt, "6163746f7270726566697831", 0)!;
    const baseline = clonePreservingBinary(parsed);

    const session = new WorldSession(createWorldDumpFromParsed([parsed]));
    const jsonString = exportVillagersToJson(session);
    const json = JSON.parse(jsonString);

    // Change ONLY customName
    json.villagers[0].customName = "Enchanted Scholar";

    const importResult = importVillagersFromJson(session, JSON.stringify(json));
    assert.strictEqual(importResult.success, true);
    assert.strictEqual(importResult.modifiedCount, 1);

    const current = session.getVillager(parsed.sessionVillagerId)!;
    assert.strictEqual(current.customName, "Enchanted Scholar");
    assert.ok(
      deepEqualSafe(
        current.trades[0]!.sell.enchantments![0]!.rawNbt,
        baseline.trades[0]!.sell.enchantments![0]!.rawNbt
      ),
      "Enchantment rawNbt must be identical to baseline before serialization"
    );

    const writtenNbt = writeVillagerToNbt(current, baseline);
    const encoded = writeBedrockNbt(writtenNbt, "little");
    const reparsed = (await parseBedrockNbt(encoded)).parsed;

    const recipes = reparsed.value.Offers.value.Recipes.value.value || reparsed.value.Offers.value.Recipes.value;
    const r0 = recipes[0].value || recipes[0];
    assert.strictEqual(r0.UnknownRecipeSibling.value, "recipe-sibling-survives");
    assert.strictEqual(r0.sell.value.tag.value.CustomItemTag.value, "item-tag-survives");

    const enchList = r0.sell.value.tag.value.ench.value.value || r0.sell.value.tag.value.ench.value;
    const ench0 = enchList[0].value || enchList[0];
    assert.strictEqual(ench0.id.value, 26);
    assert.strictEqual(ench0.lvl.value, 1);
    assert.strictEqual(ench0.FutureEnchantField.value, "keep-enchant-field");
  });

  // Unknown existing enchantment preservation & new unknown enchantment rejection
  it("preserves existing unknown numeric enchantment on edit but rejects new unknown enchantment in JSON", () => {
    const unknownEnchRecipe = {
      buyA: NbtTags.compound({ Name: NbtTags.string("minecraft:emerald"), Count: NbtTags.byte(10) }),
      sell: NbtTags.compound({
        Name: NbtTags.string("minecraft:enchanted_book"),
        Count: NbtTags.byte(1),
        tag: NbtTags.compound({
          ench: NbtTags.list("compound", [
            {
              id: NbtTags.short(999),
              lvl: NbtTags.short(2),
              FutureUnknownEnchantField: NbtTags.string("preserve-unknown")
            }
          ])
        })
      }),
      tier: NbtTags.int(1),
      maxUses: NbtTags.int(16),
      uses: NbtTags.int(0),
      traderExp: NbtTags.int(2),
      rewardExp: NbtTags.byte(1),
      priceMultiplierA: NbtTags.float(0.05)
    };

    const rawNbt = createRealisticVillagerNbt([unknownEnchRecipe]);
    const parsed = parseVillagerNbt(rawNbt, "6163746f7270726566697831", 0)!;
    const baseline = clonePreservingBinary(parsed);

    const session = new WorldSession(createWorldDumpFromParsed([parsed]));
    const jsonString = exportVillagersToJson(session);

    // 1. Unchanged import preserves unknown enchantment
    const jsonMeta = JSON.parse(jsonString);
    jsonMeta.villagers[0].customName = "Unknown Wizard";
    const resMeta = importVillagersFromJson(session, JSON.stringify(jsonMeta));
    assert.strictEqual(resMeta.success, true);

    const current = session.getVillager(parsed.sessionVillagerId)!;
    const writtenNbt = writeVillagerToNbt(current, baseline);
    const recipes = writtenNbt.value.Offers.value.Recipes.value.value || writtenNbt.value.Offers.value.Recipes.value;
    const r0 = recipes[0].value || recipes[0];
    const enchList = r0.sell.value.tag.value.ench.value.value || r0.sell.value.tag.value.ench.value;
    const ench0 = enchList[0].value || enchList[0];
    assert.strictEqual(ench0.id.value, 999);
    assert.strictEqual(ench0.FutureUnknownEnchantField.value, "preserve-unknown");

    // 2. Genuinely new item / trade with unknown enchantment id 999 must be rejected
    const jsonNewUnknown = JSON.parse(jsonString);
    jsonNewUnknown.villagers[0].trades.push({
      tier: 1,
      buyA: { id: "minecraft:emerald", count: 1 },
      sell: {
        id: "minecraft:enchanted_book",
        count: 1,
        enchantments: [{ id: 999, name: "mystery_curse", level: 1 }]
      }
    });

    const resNewUnknown = importVillagersFromJson(session, JSON.stringify(jsonNewUnknown));
    assert.strictEqual(resNewUnknown.success, false);
    assert.ok(resNewUnknown.error?.includes("Unknown enchantment ID 999"));
  });

  // Enchantment ID/name mismatch test
  it("rejects enchantment ID/name mismatch with clear error and no state mutation", () => {
    const rawNbt = createRealisticVillagerNbt();
    const parsed = parseVillagerNbt(rawNbt, "6163746f7270726566697831", 0)!;

    const session = new WorldSession(createWorldDumpFromParsed([parsed]));
    const jsonString = exportVillagersToJson(session);
    const json = JSON.parse(jsonString);

    // ID 26 is Smite, but name is sharpness (which is ID 9)
    json.villagers[0].trades[0].sell.enchantments = [
      { id: 26, name: "sharpness", level: 1 }
    ];

    const res = importVillagersFromJson(session, JSON.stringify(json));
    assert.strictEqual(res.success, false);
    assert.ok(res.error?.includes("does not match"));
    assert.strictEqual(session.getDirtyCount(), 0);
    assert.strictEqual(session.canUndo(), false);
  });

  // buyCount JSON tests
  it("export omits buyCountA/B; import validates compatible alias, rejects conflict", () => {
    const rawNbt = createRealisticVillagerNbt();
    const parsed = parseVillagerNbt(rawNbt, "6163746f7270726566697831", 0)!;
    parsed.trades[0]!.buyCountA = 24;

    const session = new WorldSession(createWorldDumpFromParsed([parsed]));
    const jsonString = exportVillagersToJson(session);

    // A. Export must NOT contain buyCountA or buyCountB
    assert.strictEqual(jsonString.includes('"buyCountA"'), false);
    assert.strictEqual(jsonString.includes('"buyCountB"'), false);

    // B. Compatibility: matching alias succeeds
    const jsonCompat = JSON.parse(jsonString);
    jsonCompat.villagers[0].trades[0].buyA.count = 5;
    jsonCompat.villagers[0].trades[0].buyCountA = 5;
    const resCompat = importVillagersFromJson(session, JSON.stringify(jsonCompat));
    assert.strictEqual(resCompat.success, true);

    // C. Conflicting alias is rejected
    const jsonConflict = JSON.parse(jsonString);
    jsonConflict.villagers[0].trades[0].buyA.count = 5;
    jsonConflict.villagers[0].trades[0].buyCountA = 9;
    const resConflict = importVillagersFromJson(session, JSON.stringify(jsonConflict));
    assert.strictEqual(resConflict.success, false);
    assert.ok(resConflict.error?.includes("buyCountA is derived from buyA.count"));

    // D. New trade with buyCountA is rejected
    const jsonNewBuyCount = JSON.parse(jsonString);
    jsonNewBuyCount.villagers[0].trades.push({
      tier: 1,
      buyA: { id: "minecraft:emerald", count: 2 },
      buyCountA: 2,
      sell: { id: "minecraft:arrow", count: 1 }
    });
    const resNewBuyCount = importVillagersFromJson(session, JSON.stringify(jsonNewBuyCount));
    assert.strictEqual(resNewBuyCount.success, false);
    assert.ok(resNewBuyCount.error?.includes("buyCountA is derived from buyA.count"));
  });

  // Semantically identical trade reorder test
  it("reordering semantically identical trades with different raw sentinels marks dirty, preserves identity, and supports Undo/Redo", () => {
    const rA = {
      buyA: NbtTags.compound({ Name: NbtTags.string("minecraft:paper"), Count: NbtTags.byte(24) }),
      sell: NbtTags.compound({ Name: NbtTags.string("minecraft:emerald"), Count: NbtTags.byte(1) }),
      tier: NbtTags.int(1),
      maxUses: NbtTags.int(16),
      uses: NbtTags.int(0),
      traderExp: NbtTags.int(2),
      rewardExp: NbtTags.byte(1),
      priceMultiplierA: NbtTags.float(0.05),
      UnknownRecipeSibling: NbtTags.string("identity-A")
    };
    const rB = {
      buyA: NbtTags.compound({ Name: NbtTags.string("minecraft:paper"), Count: NbtTags.byte(24) }),
      sell: NbtTags.compound({ Name: NbtTags.string("minecraft:emerald"), Count: NbtTags.byte(1) }),
      tier: NbtTags.int(1),
      maxUses: NbtTags.int(16),
      uses: NbtTags.int(0),
      traderExp: NbtTags.int(2),
      rewardExp: NbtTags.byte(1),
      priceMultiplierA: NbtTags.float(0.05),
      UnknownRecipeSibling: NbtTags.string("identity-B")
    };

    const rawNbt = createRealisticVillagerNbt([rA, rB]);
    const parsed = parseVillagerNbt(rawNbt, "6163746f7270726566697831", 0)!;
    const baseline = clonePreservingBinary(parsed);

    const session = new WorldSession(createWorldDumpFromParsed([parsed]));
    const jsonString = exportVillagersToJson(session);
    const json = JSON.parse(jsonString);

    // Reverse trade order
    json.villagers[0].trades.reverse();

    const importResult = importVillagersFromJson(session, JSON.stringify(json));
    assert.strictEqual(importResult.success, true);
    assert.strictEqual(importResult.modifiedCount, 1);
    assert.strictEqual(session.getDirtyCount(), 1);
    assert.strictEqual(session.canUndo(), true);

    const current = session.getVillager(parsed.sessionVillagerId)!;
    const writtenNbt = writeVillagerToNbt(current, baseline);
    const recipes = writtenNbt.value.Offers.value.Recipes.value.value || writtenNbt.value.Offers.value.Recipes.value;
    const rec0 = recipes[0].value || recipes[0];
    const rec1 = recipes[1].value || recipes[1];
    assert.strictEqual(rec0.UnknownRecipeSibling.value, "identity-B");
    assert.strictEqual(rec1.UnknownRecipeSibling.value, "identity-A");

    // Undo restores original order
    session.undo();
    assert.strictEqual(session.getDirtyCount(), 0);
    const restored = session.getVillager(parsed.sessionVillagerId)!;
    assert.strictEqual(restored.trades[0]!.id, parsed.trades[0]!.id);

    // Redo restores reversed order
    session.redo();
    assert.strictEqual(session.getDirtyCount(), 1);
    const redone = session.getVillager(parsed.sessionVillagerId)!;
    assert.strictEqual(redone.trades[0]!.id, parsed.trades[1]!.id);
  });

  // Stale villager ID test
  it("stale or unknown villager ID fails entire import with zero mutations", () => {
    const rawNbt = createRealisticVillagerNbt();
    const parsed = parseVillagerNbt(rawNbt, "6163746f7270726566697831", 0)!;

    const session = new WorldSession(createWorldDumpFromParsed([parsed]));
    const jsonString = exportVillagersToJson(session);
    const json = JSON.parse(jsonString);

    // Add a valid edit to real villager
    json.villagers[0].customName = "Real Edit";

    // Add an unknown stale villager
    json.villagers.push({
      id: "stale_ghost_villager_id",
      customName: "Ghost",
      profession: "farmer"
    });

    const res = importVillagersFromJson(session, JSON.stringify(json));
    assert.strictEqual(res.success, false);
    assert.ok(res.error?.includes("stale_ghost_villager_id"));
    assert.strictEqual(session.getVillager(parsed.sessionVillagerId)!.customName, null);
    assert.strictEqual(session.getDirtyCount(), 0);
    assert.strictEqual(session.canUndo(), false);
  });

  // Metadata-only JSON import must not touch trades
  it("metadata-only JSON import leaves internal trades deep-equal and unmodified in NBT", () => {
    const rawNbt = createRealisticVillagerNbt();
    const parsed = parseVillagerNbt(rawNbt, "6163746f7270726566697831", 0)!;
    const baseline = clonePreservingBinary(parsed);

    const session = new WorldSession(createWorldDumpFromParsed([parsed]));
    const jsonString = exportVillagersToJson(session);
    const json = JSON.parse(jsonString);

    // Edit only customName
    json.villagers[0].customName = "Archivist";

    const res = importVillagersFromJson(session, JSON.stringify(json));
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.modifiedCount, 1);

    const current = session.getVillager(parsed.sessionVillagerId)!;
    assert.ok(
      deepEqualSafe(current.trades, baseline.trades),
      "Trades must be deepEqualSafe to baseline when only metadata changed"
    );

    const writtenNbt = writeVillagerToNbt(current, baseline);
    assert.strictEqual(writtenNbt.value.CustomName.value, "Archivist");
    assert.ok(
      deepEqualSafe(writtenNbt.value.Offers, baseline.rawNbt.value.Offers),
      "Offers NBT compound must be identical to baseline when only name changed"
    );
  });

  // Career-only JSON import must not touch trades
  it("career-only JSON import leaves internal trades deep-equal", () => {
    const rawNbt = createRealisticVillagerNbt();
    const parsed = parseVillagerNbt(rawNbt, "6163746f7270726566697831", 0)!;
    const baseline = clonePreservingBinary(parsed);

    const session = new WorldSession(createWorldDumpFromParsed([parsed]));
    const jsonString = exportVillagersToJson(session);
    const json = JSON.parse(jsonString);

    // Edit only careerLevel
    json.villagers[0].careerLevel = 3;

    const res = importVillagersFromJson(session, JSON.stringify(json));
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.modifiedCount, 1);

    const current = session.getVillager(parsed.sessionVillagerId)!;
    assert.strictEqual(current.careerLevel, 3);
    assert.ok(
      deepEqualSafe(current.trades, baseline.trades),
      "Trades must remain deepEqualSafe when only careerLevel changed"
    );
  });

  // New trade ID test
  it("new JSON trade generates cryptographic ID with full UUID", () => {
    const rawNbt = createRealisticVillagerNbt();
    const parsed = parseVillagerNbt(rawNbt, "6163746f7270726566697831", 0)!;

    const session = new WorldSession(createWorldDumpFromParsed([parsed]));
    const jsonString = exportVillagersToJson(session);
    const json = JSON.parse(jsonString);

    json.villagers[0].trades.push({
      tier: 1,
      buyA: { id: "minecraft:emerald", count: 1 },
      sell: { id: "minecraft:apple", count: 4 }
    });

    const res = importVillagersFromJson(session, JSON.stringify(json));
    assert.strictEqual(res.success, true);

    const current = session.getVillager(parsed.sessionVillagerId)!;
    assert.strictEqual(current.trades.length, 2);
    const newTrade = current.trades[1]!;
    assert.ok(newTrade.id, "New trade must have an ID");
    assert.ok(
      /^trade_\d+_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(newTrade.id),
      `Expected ID matching full UUID pattern, got: ${newTrade.id}`
    );
    assert.notStrictEqual(newTrade.id, current.trades[0]!.id);
    assert.strictEqual(newTrade.rawRecipe, undefined);
  });

  // Trade-ID export invariant test
  it("export throws clear error when an internal trade lacks a valid ID", () => {
    const rawNbt = createRealisticVillagerNbt();
    const parsed = parseVillagerNbt(rawNbt, "6163746f7270726566697831", 0)!;
    (parsed.trades[0] as any).id = "";

    const session = new WorldSession(createWorldDumpFromParsed([parsed]));

    assert.throws(
      () => {
        exportVillagersToJson(session);
      },
      (err: any) => {
        assert.ok(err.message.includes("the trade has no stable internal ID"));
        return true;
      }
    );
  });

  // New Trade
  it("appending trade without tradeId creates new trade while preserving existing trade sentinels", () => {
    const rawNbt = createRealisticVillagerNbt();
    const parsed = parseVillagerNbt(rawNbt, "6163746f7270726566697831", 0)!;
    const baseline = clonePreservingBinary(parsed);

    const session = new WorldSession(createWorldDumpFromParsed([parsed]));
    const jsonString = exportVillagersToJson(session);
    const json = JSON.parse(jsonString);

    // Add new trade without tradeId
    json.villagers[0].trades.push({
      tier: 2,
      buyA: { id: "minecraft:diamond", count: 1 },
      sell: { id: "minecraft:emerald", count: 2 }
    });

    const importResult = importVillagersFromJson(session, JSON.stringify(json));
    assert.strictEqual(importResult.success, true);
    assert.strictEqual(importResult.modifiedCount, 1);

    const current = session.getVillager(parsed.sessionVillagerId)!;
    assert.strictEqual(current.trades.length, 2);
    assert.strictEqual(current.trades[0]!.id, parsed.trades[0]!.id);
    assert.ok(current.trades[1]!.id);
    assert.strictEqual(current.trades[1]!.rawRecipe, undefined);

    const writtenNbt = writeVillagerToNbt(current, baseline);
    const recipes = writtenNbt.value.Offers.value.Recipes.value.value || writtenNbt.value.Offers.value.Recipes.value;
    assert.strictEqual(recipes.length, 2);
    const rec0 = recipes[0].value || recipes[0];
    const rec1 = recipes[1].value || recipes[1];
    assert.strictEqual(rec0.UnknownRecipeSibling.value, "preserve-me");
    assert.strictEqual(rec1.buyA.value.Name.value, "minecraft:diamond");
  });

  // Delete Trade
  it("omitting trade from supplied array deletes it and preserves retained trade sentinels", () => {
    const r1 = {
      buyA: NbtTags.compound({ Name: NbtTags.string("minecraft:paper"), Count: NbtTags.byte(24) }),
      sell: NbtTags.compound({ Name: NbtTags.string("minecraft:emerald"), Count: NbtTags.byte(1) }),
      tier: NbtTags.int(1),
      maxUses: NbtTags.int(16),
      uses: NbtTags.int(0),
      traderExp: NbtTags.int(2),
      rewardExp: NbtTags.byte(1),
      priceMultiplierA: NbtTags.float(0.05),
      UnknownRecipeSibling: NbtTags.string("keep-r1")
    };
    const r2 = {
      buyA: NbtTags.compound({ Name: NbtTags.string("minecraft:book"), Count: NbtTags.byte(1) }),
      sell: NbtTags.compound({ Name: NbtTags.string("minecraft:compass"), Count: NbtTags.byte(1) }),
      tier: NbtTags.int(1),
      maxUses: NbtTags.int(12),
      uses: NbtTags.int(0),
      traderExp: NbtTags.int(1),
      rewardExp: NbtTags.byte(1),
      priceMultiplierA: NbtTags.float(0.05),
      UnknownRecipeSibling: NbtTags.string("delete-r2")
    };

    const rawNbt = createRealisticVillagerNbt([r1, r2]);
    const parsed = parseVillagerNbt(rawNbt, "6163746f7270726566697831", 0)!;
    const baseline = clonePreservingBinary(parsed);

    const session = new WorldSession(createWorldDumpFromParsed([parsed]));
    const jsonString = exportVillagersToJson(session);
    const json = JSON.parse(jsonString);

    // Keep only first trade
    json.villagers[0].trades = [json.villagers[0].trades[0]];

    const importResult = importVillagersFromJson(session, JSON.stringify(json));
    assert.strictEqual(importResult.success, true);
    assert.strictEqual(importResult.modifiedCount, 1);

    const current = session.getVillager(parsed.sessionVillagerId)!;
    assert.strictEqual(current.trades.length, 1);

    const writtenNbt = writeVillagerToNbt(current, baseline);
    const recipes = writtenNbt.value.Offers.value.Recipes.value.value || writtenNbt.value.Offers.value.Recipes.value;
    assert.strictEqual(recipes.length, 1);
    const rec0 = recipes[0].value || recipes[0];
    assert.strictEqual(rec0.UnknownRecipeSibling.value, "keep-r1");
  });

  // Stale / Duplicate Trade ID
  it("fails closed on stale or duplicate tradeId without mutating state", () => {
    const rawNbt = createRealisticVillagerNbt();
    const parsed = parseVillagerNbt(rawNbt, "6163746f7270726566697831", 0)!;

    const session = new WorldSession(createWorldDumpFromParsed([parsed]));
    const jsonString = exportVillagersToJson(session);

    // A. Stale trade ID
    const jsonStale = JSON.parse(jsonString);
    jsonStale.villagers[0].trades[0].tradeId = "missing-trade-id";
    const resStale = importVillagersFromJson(session, JSON.stringify(jsonStale));
    assert.strictEqual(resStale.success, false);
    assert.ok(resStale.error?.includes("Mismatched or stale trade ID"));
    assert.strictEqual(session.getDirtyCount(), 0);
    assert.strictEqual(session.canUndo(), false);

    // B. Duplicate trade ID
    const jsonDup = JSON.parse(jsonString);
    jsonDup.villagers[0].trades.push(clonePreservingBinary(jsonDup.villagers[0].trades[0]));
    const resDup = importVillagersFromJson(session, JSON.stringify(jsonDup));
    assert.strictEqual(resDup.success, false);
    assert.ok(resDup.error?.includes("Duplicate tradeId"));
    assert.strictEqual(session.getDirtyCount(), 0);
    assert.strictEqual(session.canUndo(), false);
  });

  // Partial Existing Trade Fields
  it("partial existing trade patch modifies only supplied fields and preserves other scalars", () => {
    const r1 = {
      buyA: NbtTags.compound({ Name: NbtTags.string("minecraft:paper"), Count: NbtTags.byte(24) }),
      sell: NbtTags.compound({ Name: NbtTags.string("minecraft:emerald"), Count: NbtTags.byte(1) }),
      tier: NbtTags.int(1),
      maxUses: NbtTags.int(37),
      uses: NbtTags.int(9),
      traderExp: NbtTags.int(12),
      rewardExp: NbtTags.byte(0),
      priceMultiplierA: NbtTags.float(0.25),
      UnknownRecipeSibling: NbtTags.string("preserve-me")
    };

    const rawNbt = createRealisticVillagerNbt([r1]);
    const parsed = parseVillagerNbt(rawNbt, "6163746f7270726566697831", 0)!;

    const session = new WorldSession(createWorldDumpFromParsed([parsed]));
    const jsonString = exportVillagersToJson(session);
    const json = JSON.parse(jsonString);

    // Replace trade object with minimal patch (tradeId and buyA.count only)
    const existingTradeId = json.villagers[0].trades[0].tradeId;
    json.villagers[0].trades = [
      {
        tradeId: existingTradeId,
        buyA: { count: 10 }
      }
    ];

    const importResult = importVillagersFromJson(session, JSON.stringify(json));
    assert.strictEqual(importResult.success, true);
    assert.strictEqual(importResult.modifiedCount, 1);

    const current = session.getVillager(parsed.sessionVillagerId)!;
    assert.strictEqual(current.trades[0]!.buyA.count, 10);
    assert.strictEqual(current.trades[0]!.maxUses, 37);
    assert.strictEqual(current.trades[0]!.uses, 9);
    assert.strictEqual(current.trades[0]!.traderExp, 12);
    assert.strictEqual(current.trades[0]!.rewardExp, false);
    assert.strictEqual(current.trades[0]!.priceMultiplierA, 0.25);
  });

  // Item ID Change
  it("changing item ID creates clean item without copying old raw tag", () => {
    const rawNbt = createRealisticVillagerNbt();
    const parsed = parseVillagerNbt(rawNbt, "6163746f7270726566697831", 0)!;
    const baseline = clonePreservingBinary(parsed);

    const session = new WorldSession(createWorldDumpFromParsed([parsed]));
    const jsonString = exportVillagersToJson(session);
    const json = JSON.parse(jsonString);

    // Change buyA.id to dirt
    json.villagers[0].trades[0].buyA.id = "minecraft:dirt";

    const importResult = importVillagersFromJson(session, JSON.stringify(json));
    assert.strictEqual(importResult.success, true);

    const current = session.getVillager(parsed.sessionVillagerId)!;
    assert.strictEqual(current.trades[0]!.buyA.id, "minecraft:dirt");
    assert.strictEqual(current.trades[0]!.buyA.rawTag, undefined);

    const writtenNbt = writeVillagerToNbt(current, baseline);
    const recipes = writtenNbt.value.Offers.value.Recipes.value.value || writtenNbt.value.Offers.value.Recipes.value;
    const recipe = recipes[0].value || recipes[0];
    assert.strictEqual(recipe.UnknownRecipeSibling.value, "preserve-me");
    assert.strictEqual(recipe.buyA.value.Name.value, "minecraft:dirt");
    assert.strictEqual(recipe.buyA.value.tag, undefined, "Old item tag must not be copied to new item");
  });

  // Career Level Zero
  it("careerLevel 0 roundtrips unchanged, rejects > 5 without clamping", () => {
    const rawNbt = createRealisticVillagerNbt();
    rawNbt.value.CareerLevel = NbtTags.int(0);
    const parsed = parseVillagerNbt(rawNbt, "6163746f7270726566697831", 0)!;
    parsed.careerLevel = 0;

    const session = new WorldSession(createWorldDumpFromParsed([parsed]));
    const jsonString = exportVillagersToJson(session);

    // Re-import unchanged
    const resUnchanged = importVillagersFromJson(session, jsonString);
    assert.strictEqual(resUnchanged.success, true);
    assert.strictEqual(resUnchanged.modifiedCount, 0);
    assert.strictEqual(session.getVillager(parsed.sessionVillagerId)!.careerLevel, 0);
    assert.strictEqual(session.getDirtyCount(), 0);

    // Edit to 5
    const json5 = JSON.parse(jsonString);
    json5.villagers[0].careerLevel = 5;
    const res5 = importVillagersFromJson(session, JSON.stringify(json5));
    assert.strictEqual(res5.success, true);
    assert.strictEqual(session.getVillager(parsed.sessionVillagerId)!.careerLevel, 5);

    // Try 6 (must be rejected, not clamped)
    const json6 = JSON.parse(jsonString);
    json6.villagers[0].careerLevel = 6;
    const res6 = importVillagersFromJson(session, JSON.stringify(json6));
    assert.strictEqual(res6.success, false);
    assert.ok(res6.error?.includes("Career level"));
  });

  // Unknown Profession
  it("unknown profession rejects entire import before mutation", () => {
    const rawNbt = createRealisticVillagerNbt();
    const parsed = parseVillagerNbt(rawNbt, "6163746f7270726566697831", 0)!;

    const session = new WorldSession(createWorldDumpFromParsed([parsed]));
    const jsonString = exportVillagersToJson(session);
    const json = JSON.parse(jsonString);

    json.villagers[0].customName = "New Name";
    json.villagers[0].profession = "definitely_not_a_real_profession";

    const res = importVillagersFromJson(session, JSON.stringify(json));
    assert.strictEqual(res.success, false);
    assert.ok(res.error?.includes("Unknown villager profession"));

    const live = session.getVillager(parsed.sessionVillagerId)!;
    assert.strictEqual(live.customName, null);
    assert.strictEqual(live.profession, "librarian");
    assert.strictEqual(session.getDirtyCount(), 0);
    assert.strictEqual(session.canUndo(), false);
  });

  // V1.0 Trade File Refusal
  it("rejects schemaVersion 1.0 files containing trades array, allows metadata-only", () => {
    const rawNbt = createRealisticVillagerNbt();
    const parsed = parseVillagerNbt(rawNbt, "6163746f7270726566697831", 0)!;
    const session = new WorldSession(createWorldDumpFromParsed([parsed]));

    // 1. V1.0 with trades
    const v1WithTrades = {
      schemaVersion: "1.0",
      villagers: [
        {
          id: parsed.sessionVillagerId,
          trades: [
            {
              tier: 1,
              buyA: { id: "minecraft:paper", count: 24 },
              sell: { id: "minecraft:emerald", count: 1 }
            }
          ]
        }
      ]
    };

    const resTrades = importVillagersFromJson(session, JSON.stringify(v1WithTrades));
    assert.strictEqual(resTrades.success, false);
    assert.ok(resTrades.error?.includes("does not contain stable trade IDs"));
    assert.strictEqual(session.getDirtyCount(), 0);

    // 2. V1.0 metadata-only (no trades property)
    const v1MetaOnly = {
      schemaVersion: "1.0",
      villagers: [
        {
          id: parsed.sessionVillagerId,
          customName: "Meta Bob"
        }
      ]
    };

    const resMeta = importVillagersFromJson(session, JSON.stringify(v1MetaOnly));
    assert.strictEqual(resMeta.success, true);
    assert.strictEqual(resMeta.modifiedCount, 1);
    assert.strictEqual(session.getVillager(parsed.sessionVillagerId)!.customName, "Meta Bob");
  });

  // Static JSON Raw-NBT & buyCount Exposure Ban
  it("exported JSON never contains internal NBT keys or buyCount aliases", () => {
    const rawNbt = createRealisticVillagerNbt();
    const parsed = parseVillagerNbt(rawNbt, "6163746f7270726566697831", 0)!;
    parsed.trades[0]!.buyCountA = 24;

    const session = new WorldSession(createWorldDumpFromParsed([parsed]));
    const jsonString = exportVillagersToJson(session);

    const forbiddenKeys = [
      "rawRecipe",
      "rawTag",
      "dbKeyHex",
      "originalDbValueHash",
      "nbtEncoding",
      "poiKeyHex",
      "actorKeySuffix",
      "rawNbt",
      "rawNbtJson",
      "buyCountA",
      "buyCountB"
    ];

    for (const key of forbiddenKeys) {
      assert.strictEqual(
        jsonString.includes(`"${key}"`),
        false,
        `Exported JSON must not contain forbidden key: ${key}`
      );
    }
  });

  // Static Math.random ban and allocateUniqueTradeId usage
  it("jsonExchange uses allocateUniqueTradeId and not Math.random for trade ID generation", () => {
    const jsonExchangeTs = fs.readFileSync(
      path.join(process.cwd(), "src", "core", "jsonExchange.ts"),
      "utf8"
    );

    assert.strictEqual(
      jsonExchangeTs.includes("Math.random()"),
      false,
      "jsonExchange.ts must not use Math.random()"
    );
    assert.ok(
      jsonExchangeTs.includes("allocateUniqueTradeId"),
      "jsonExchange.ts must use allocateUniqueTradeId for trade IDs"
    );
  });

  // Duplicate Villager IDs in JSON
  it("duplicate villager IDs fail the entire JSON import before mutation", () => {
    const rawNbt = createRealisticVillagerNbt();
    const parsed = parseVillagerNbt(rawNbt, "6163746f7270726566697831", 0)!;
    const session = new WorldSession(createWorldDumpFromParsed([parsed]));

    const payload = {
      schemaVersion: "1.1",
      villagers: [
        {
          id: parsed.sessionVillagerId,
          customName: "First Name"
        },
        {
          id: parsed.sessionVillagerId,
          customName: "Second Name"
        }
      ]
    };

    const res = importVillagersFromJson(session, JSON.stringify(payload));
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.modifiedCount, 0);
    assert.ok(res.error?.toLowerCase().includes("duplicate villager"));
    assert.strictEqual(session.getVillager(parsed.sessionVillagerId)!.customName, null);
    assert.strictEqual(session.getDirtyCount(), 0);
    assert.strictEqual(session.canUndo(), false);
  });

  // Defense-in-depth in applyTrustedImportUpdates
  it("applyTrustedImportUpdates rejects duplicate update IDs and nonexistent targets", () => {
    const rawNbt = createRealisticVillagerNbt();
    const parsed = parseVillagerNbt(rawNbt, "6163746f7270726566697831", 0)!;
    const session = new WorldSession(createWorldDumpFromParsed([parsed]));

    // Duplicate update
    const dupRes = session.applyTrustedImportUpdates(
      [
        { villagerId: parsed.sessionVillagerId, customName: "A" },
        { villagerId: parsed.sessionVillagerId, customName: "B" }
      ],
      "test duplicate"
    );
    assert.strictEqual(dupRes.success, false);
    assert.strictEqual(session.getVillager(parsed.sessionVillagerId)!.customName, null);
    assert.strictEqual(session.getDirtyCount(), 0);
    assert.strictEqual(session.canUndo(), false);

    // Nonexistent target
    const nonExistentRes = session.applyTrustedImportUpdates(
      [{ villagerId: "ghost_villager", customName: "Ghost" }],
      "test nonexistent"
    );
    assert.strictEqual(nonExistentRes.success, false);
    assert.strictEqual(session.getDirtyCount(), 0);
  });

  // Validating new or changed item IDs
  it("new or changed item IDs are validated against ITEM_ID_RE", () => {
    const rawNbt = createRealisticVillagerNbt();
    const parsed = parseVillagerNbt(rawNbt, "6163746f7270726566697831", 0)!;
    const session = new WorldSession(createWorldDumpFromParsed([parsed]));
    const jsonString = exportVillagersToJson(session);

    const invalidIds = [
      "diamond",
      "minecraft:",
      ":emerald",
      "minecraft:bad item",
      "minecraft:bad?item",
      "minecraft:" + "a".repeat(101)
    ];

    for (const invalidId of invalidIds) {
      const json = JSON.parse(jsonString);
      json.villagers[0].trades.push({
        tier: 1,
        buyA: { id: invalidId, count: 1 },
        sell: { id: "minecraft:emerald", count: 1 }
      });

      const res = importVillagersFromJson(session, JSON.stringify(json));
      assert.strictEqual(res.success, false, `Expected invalid ID "${invalidId}" to fail`);
      assert.strictEqual(res.modifiedCount, 0);
      assert.strictEqual(session.getDirtyCount(), 0);
      assert.strictEqual(session.canUndo(), false);
      assert.strictEqual(session.getVillager(parsed.sessionVillagerId)!.trades.length, 1);
    }

    // Changing existing item ID to invalid ID
    const jsonChange = JSON.parse(jsonString);
    jsonChange.villagers[0].trades[0].buyA.id = "not_namespaced";
    const resChange = importVillagersFromJson(session, JSON.stringify(jsonChange));
    assert.strictEqual(resChange.success, false);
    assert.strictEqual(resChange.modifiedCount, 0);
    assert.strictEqual(session.getDirtyCount(), 0);
  });

  // Existing legacy nonstandard item ID preservation
  it("already-live nonstandard legacy item ID preserves unchanged on export and re-import", () => {
    const rawNbt = createRealisticVillagerNbt();
    const parsed = parseVillagerNbt(rawNbt, "6163746f7270726566697831", 0)!;
    parsed.trades[0]!.buyA.id = "legacy_nonstandard_unnamespaced_item";

    const session = new WorldSession(createWorldDumpFromParsed([parsed]));
    const jsonString = exportVillagersToJson(session);

    const res = importVillagersFromJson(session, jsonString);
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.modifiedCount, 0);
    assert.strictEqual(session.getDirtyCount(), 0);
    assert.strictEqual(session.getVillager(parsed.sessionVillagerId)!.trades[0]!.buyA.id, "legacy_nonstandard_unnamespaced_item");
  });

  // Known numeric enchantment ID with unrecognized name fails closed
  it("known numeric enchantment ID with unrecognized name fails closed", () => {
    const rawNbt = createRealisticVillagerNbt();
    const parsed = parseVillagerNbt(rawNbt, "6163746f7270726566697831", 0)!;
    const session = new WorldSession(createWorldDumpFromParsed([parsed]));
    const jsonString = exportVillagersToJson(session);

    // A. Existing same-item enchantment JSON edit
    const jsonExisting = JSON.parse(jsonString);
    jsonExisting.villagers[0].trades[0].sell.enchantments = [
      { id: 26, name: "definitely_not_mending", level: 1 }
    ];
    const resExisting = importVillagersFromJson(session, JSON.stringify(jsonExisting));
    assert.strictEqual(resExisting.success, false);
    assert.ok(resExisting.error?.includes("does not match recognized name"));
    assert.strictEqual(session.getDirtyCount(), 0);
    assert.strictEqual(session.canUndo(), false);

    // B. New item / new trade enchantment
    const jsonNew = JSON.parse(jsonString);
    jsonNew.villagers[0].trades.push({
      tier: 1,
      buyA: { id: "minecraft:emerald", count: 1 },
      sell: {
        id: "minecraft:enchanted_book",
        count: 1,
        enchantments: [{ id: 26, name: "definitely_not_mending", level: 1 }]
      }
    });
    const resNew = importVillagersFromJson(session, JSON.stringify(jsonNew));
    assert.strictEqual(resNew.success, false);
    assert.ok(resNew.error?.includes("does not match recognized name"));
    assert.strictEqual(session.getDirtyCount(), 0);
    assert.strictEqual(session.canUndo(), false);
  });

  // Missing Damage + JSON damage: 0 is a no-op
  it("existing item with missing Damage + JSON damage: 0 is a no-op", () => {
    const rawNbt = createRealisticVillagerNbt();
    const parsed = parseVillagerNbt(rawNbt, "6163746f7270726566697831", 0)!;
    const baseline = clonePreservingBinary(parsed);

    const session = new WorldSession(createWorldDumpFromParsed([parsed]));
    const jsonString = exportVillagersToJson(session);
    const json = JSON.parse(jsonString);

    // Explicitly add damage: 0 to buyA whose original Damage was absent
    json.villagers[0].trades[0].buyA.damage = 0;

    const res = importVillagersFromJson(session, JSON.stringify(json));
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.modifiedCount, 0);
    assert.strictEqual(session.getDirtyCount(), 0);
    assert.strictEqual(session.canUndo(), false);

    const current = session.getVillager(parsed.sessionVillagerId)!;
    assert.strictEqual(current.trades[0]!.buyA.damage, undefined);

    const writtenNbt = writeVillagerToNbt(current, baseline);
    const recipes = writtenNbt.value.Offers.value.Recipes.value.value || writtenNbt.value.Offers.value.Recipes.value;
    const r0 = recipes[0].value || recipes[0];
    assert.strictEqual(r0.buyA.value.Damage, undefined, "Missing Damage must not materialize as Damage: 0");
  });

  // Nonzero Damage + JSON damage: 0 is a real change
  it("existing item with nonzero Damage + JSON damage: 0 is a real change", () => {
    const rawNbt = createRealisticVillagerNbt();
    const recipesList = rawNbt.value.Offers.value.Recipes.value.value || rawNbt.value.Offers.value.Recipes.value;
    recipesList[0].buyA.value.Damage = NbtTags.short(5);
    const parsed = parseVillagerNbt(rawNbt, "6163746f7270726566697831", 0)!;
    assert.strictEqual(parsed.trades[0]!.buyA.damage, 5);
    const baseline = clonePreservingBinary(parsed);

    const session = new WorldSession(createWorldDumpFromParsed([parsed]));
    const jsonString = exportVillagersToJson(session);
    const json = JSON.parse(jsonString);
    assert.strictEqual(json.villagers[0].trades[0].buyA.damage, 5);

    // Change damage 5 -> 0
    json.villagers[0].trades[0].buyA.damage = 0;

    const res = importVillagersFromJson(session, JSON.stringify(json));
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.modifiedCount, 1);
    assert.strictEqual(session.getDirtyCount(), 1);

    const current = session.getVillager(parsed.sessionVillagerId)!;
    assert.strictEqual(current.trades[0]!.buyA.damage, 0);

    const writtenNbt = writeVillagerToNbt(current, baseline);
    const recipes = writtenNbt.value.Offers.value.Recipes.value.value || writtenNbt.value.Offers.value.Recipes.value;
    const r0 = recipes[0].value || recipes[0];
    assert.ok(r0.buyA.value.Damage !== undefined);
    assert.strictEqual(r0.buyA.value.Damage.value, 0);
  });

  // Multiple new JSON trades receive unique IDs with full UUID format
  it("multiple new JSON trades receive pairwise unique IDs with full UUID format", () => {
    const rawNbt = createRealisticVillagerNbt();
    const parsed = parseVillagerNbt(rawNbt, "6163746f7270726566697831", 0)!;
    const session = new WorldSession(createWorldDumpFromParsed([parsed]));
    const jsonString = exportVillagersToJson(session);
    const json = JSON.parse(jsonString);

    json.villagers[0].trades.push(
      { tier: 1, buyA: { id: "minecraft:emerald", count: 1 }, sell: { id: "minecraft:apple", count: 1 } },
      { tier: 1, buyA: { id: "minecraft:emerald", count: 2 }, sell: { id: "minecraft:bread", count: 2 } },
      { tier: 1, buyA: { id: "minecraft:emerald", count: 3 }, sell: { id: "minecraft:cookie", count: 3 } }
    );

    const res = importVillagersFromJson(session, JSON.stringify(json));
    assert.strictEqual(res.success, true);

    const current = session.getVillager(parsed.sessionVillagerId)!;
    assert.strictEqual(current.trades.length, 4);

    const newIds = [current.trades[1]!.id, current.trades[2]!.id, current.trades[3]!.id];
    const uuidPattern = /^trade_\d+_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    for (const id of newIds) {
      assert.ok(id, "Trade ID must be non-empty");
      assert.ok(uuidPattern.test(id), `ID "${id}" must match full UUID pattern`);
    }

    assert.strictEqual(new Set(newIds).size, 3, "New trade IDs must be pairwise unique");
    assert.strictEqual(current.trades[0]!.id, parsed.trades[0]!.id);
    assert.strictEqual(current.trades[1]!.rawRecipe, undefined);
    assert.strictEqual(current.trades[2]!.rawRecipe, undefined);
    assert.strictEqual(current.trades[3]!.rawRecipe, undefined);
  });

  // Export fails closed on duplicate internal trade IDs
  it("export throws clear error on duplicate internal trade IDs", () => {
    const rawNbt = createRealisticVillagerNbt();
    const parsed = parseVillagerNbt(rawNbt, "6163746f7270726566697831", 0)!;
    const duplicateTrade = clonePreservingBinary(parsed.trades[0]!);
    parsed.trades.push(duplicateTrade);

    const session = new WorldSession(createWorldDumpFromParsed([parsed]));

    assert.throws(
      () => {
        exportVillagersToJson(session);
      },
      (err: any) => {
        assert.ok(err.message.includes("duplicate stable trade ID"));
        return true;
      }
    );
  });

  // Unsupported explicit schemaVersion fails closed
  it("unsupported explicit schemaVersion fails closed", () => {
    const rawNbt = createRealisticVillagerNbt();
    const parsed = parseVillagerNbt(rawNbt, "6163746f7270726566697831", 0)!;
    const session = new WorldSession(createWorldDumpFromParsed([parsed]));

    const payload = {
      schemaVersion: "2.0",
      villagers: [
        {
          id: parsed.sessionVillagerId,
          customName: "Should Not Apply"
        }
      ]
    };

    const res = importVillagersFromJson(session, JSON.stringify(payload));
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.modifiedCount, 0);
    assert.ok(res.error?.includes("Unsupported JSON schema version"));
    assert.strictEqual(session.getVillager(parsed.sessionVillagerId)!.customName, null);
    assert.strictEqual(session.getDirtyCount(), 0);
    assert.strictEqual(session.canUndo(), false);
  });

  // Strict JSON property validation fails closed on unknown/typo properties
  it("strict JSON property validation rejects unknown or typo properties", () => {
    const rawNbt = createRealisticVillagerNbt();
    const parsed = parseVillagerNbt(rawNbt, "6163746f7270726566697831", 0)!;
    const session = new WorldSession(createWorldDumpFromParsed([parsed]));
    const jsonString = exportVillagersToJson(session);

    // Case A: typo in trade property (maxUse instead of maxUses)
    const jsonA = JSON.parse(jsonString);
    jsonA.villagers[0].trades[0].maxUse = 10;
    const resA = importVillagersFromJson(session, JSON.stringify(jsonA));
    assert.strictEqual(resA.success, false);
    assert.ok(resA.error?.includes("JSON schema validation failed"));

    // Case B: item contains rawRecipe
    const jsonB = JSON.parse(jsonString);
    jsonB.villagers[0].trades[0].buyA.rawRecipe = { anything: true };
    const resB = importVillagersFromJson(session, JSON.stringify(jsonB));
    assert.strictEqual(resB.success, false);
    assert.ok(resB.error?.includes("JSON schema validation failed"));

    // Case C: villager contains typo (profesion)
    const jsonC = JSON.parse(jsonString);
    jsonC.villagers[0].profesion = "librarian";
    const resC = importVillagersFromJson(session, JSON.stringify(jsonC));
    assert.strictEqual(resC.success, false);
    assert.ok(resC.error?.includes("JSON schema validation failed"));

    // Case D: position contains dimension
    const jsonD = JSON.parse(jsonString);
    jsonD.villagers[0].position.dimension = 1;
    const resD = importVillagersFromJson(session, JSON.stringify(jsonD));
    assert.strictEqual(resD.success, false);
    assert.ok(resD.error?.includes("JSON schema validation failed"));

    // Case E: top-level object contains unexpected field
    const jsonE = JSON.parse(jsonString);
    jsonE.unexpectedFutureField = true;
    const resE = importVillagersFromJson(session, JSON.stringify(jsonE));
    assert.strictEqual(resE.success, false);
    assert.ok(resE.error?.includes("JSON schema validation failed"));

    assert.strictEqual(session.getDirtyCount(), 0);
  });

  // JSON count representability validation and wider legacy roundtrip
  it("count validates byte range for new/edited items and preserves wider legacy tags", () => {
    const rawNbt = createRealisticVillagerNbt();
    const parsed = parseVillagerNbt(rawNbt, "6163746f7270726566697831", 0)!;
    const session = new WorldSession(createWorldDumpFromParsed([parsed]));
    const jsonString = exportVillagersToJson(session);

    // A. New trade count 127 is accepted
    const json127 = JSON.parse(jsonString);
    json127.villagers[0].trades.push({
      tier: 1,
      buyA: { id: "minecraft:emerald", count: 127 },
      sell: { id: "minecraft:apple", count: 1 }
    });
    const res127 = importVillagersFromJson(session, JSON.stringify(json127));
    assert.strictEqual(res127.success, true);
    assert.strictEqual(session.getVillager(parsed.sessionVillagerId)!.trades[1]!.buyA.count, 127);

    // B. New trade count 128 is rejected
    const json128 = JSON.parse(jsonString);
    json128.villagers[0].trades.push({
      tier: 1,
      buyA: { id: "minecraft:emerald", count: 128 },
      sell: { id: "minecraft:apple", count: 1 }
    });
    const res128 = importVillagersFromJson(session, JSON.stringify(json128));
    assert.strictEqual(res128.success, false);
    assert.ok(res128.error?.includes("cannot be written as a Bedrock NBT byte"));

    // C. Existing count 24 -> 128 is rejected
    const jsonEdit128 = JSON.parse(jsonString);
    jsonEdit128.villagers[0].trades[0].buyA.count = 128;
    const resEdit128 = importVillagersFromJson(session, JSON.stringify(jsonEdit128));
    assert.strictEqual(resEdit128.success, false);

    // D. Existing wider-tag Count 200 roundtrips unchanged
    const widerNbt = createRealisticVillagerNbt();
    const recipes = widerNbt.value.Offers.value.Recipes.value.value || widerNbt.value.Offers.value.Recipes.value;
    recipes[0].buyA.value.Count = NbtTags.int(200);
    const parsedWider = parseVillagerNbt(widerNbt, "6163746f7270726566697831", 0)!;
    assert.strictEqual(parsedWider.trades[0]!.buyA.count, 200);
    const baselineWider = clonePreservingBinary(parsedWider);

    const sessionWider = new WorldSession(createWorldDumpFromParsed([parsedWider]));
    const jsonWider = exportVillagersToJson(sessionWider);

    const resWiderUnchanged = importVillagersFromJson(sessionWider, jsonWider);
    assert.strictEqual(resWiderUnchanged.success, true);
    assert.strictEqual(resWiderUnchanged.modifiedCount, 0);
    assert.strictEqual(sessionWider.getDirtyCount(), 0);

    // Change customName only
    const jsonWiderName = JSON.parse(jsonWider);
    jsonWiderName.villagers[0].customName = "Wider Count Guy";
    const resWiderName = importVillagersFromJson(sessionWider, JSON.stringify(jsonWiderName));
    assert.strictEqual(resWiderName.success, true);

    const currentWider = sessionWider.getVillager(parsedWider.sessionVillagerId)!;
    const writtenWider = writeVillagerToNbt(currentWider, baselineWider);
    const writtenRecipes = writtenWider.value.Offers.value.Recipes.value.value || writtenWider.value.Offers.value.Recipes.value;
    const r0 = writtenRecipes[0].value || writtenRecipes[0];
    assert.strictEqual(r0.buyA.value.Count.type, "int");
    assert.strictEqual(r0.buyA.value.Count.value, 200);
  });

  // JSON damage representability validation and wider legacy roundtrip
  it("damage validates short range for new/edited items and preserves wider legacy tags", () => {
    const rawNbt = createRealisticVillagerNbt();
    const parsed = parseVillagerNbt(rawNbt, "6163746f7270726566697831", 0)!;
    const session = new WorldSession(createWorldDumpFromParsed([parsed]));
    const jsonString = exportVillagersToJson(session);

    // A. New item damage 32767 is allowed
    const json32767 = JSON.parse(jsonString);
    json32767.villagers[0].trades.push({
      tier: 1,
      buyA: { id: "minecraft:emerald", count: 1 },
      sell: { id: "minecraft:bow", count: 1, damage: 32767 }
    });
    const res32767 = importVillagersFromJson(session, JSON.stringify(json32767));
    assert.strictEqual(res32767.success, true);

    // B. New item damage 32768 is rejected
    const json32768 = JSON.parse(jsonString);
    json32768.villagers[0].trades.push({
      tier: 1,
      buyA: { id: "minecraft:emerald", count: 1 },
      sell: { id: "minecraft:bow", count: 1, damage: 32768 }
    });
    const res32768 = importVillagersFromJson(session, JSON.stringify(json32768));
    assert.strictEqual(res32768.success, false);
    assert.ok(res32768.error?.includes("cannot be written as a Bedrock NBT short"));

    // C. Existing Damage 5 -> 32768 is rejected
    const rawNbt5 = createRealisticVillagerNbt();
    const recipes5 = rawNbt5.value.Offers.value.Recipes.value.value || rawNbt5.value.Offers.value.Recipes.value;
    recipes5[0].buyA.value.Damage = NbtTags.short(5);
    const parsed5 = parseVillagerNbt(rawNbt5, "6163746f7270726566697831", 0)!;
    const session5 = new WorldSession(createWorldDumpFromParsed([parsed5]));
    const json5 = JSON.parse(exportVillagersToJson(session5));
    json5.villagers[0].trades[0].buyA.damage = 32768;
    const resEdit32768 = importVillagersFromJson(session5, JSON.stringify(json5));
    assert.strictEqual(resEdit32768.success, false);

    // D. Existing wider-tag Damage 50000 roundtrips unchanged
    const widerNbt = createRealisticVillagerNbt();
    const recipesW = widerNbt.value.Offers.value.Recipes.value.value || widerNbt.value.Offers.value.Recipes.value;
    recipesW[0].buyA.value.Damage = NbtTags.int(50000);
    const parsedW = parseVillagerNbt(widerNbt, "6163746f7270726566697831", 0)!;
    assert.strictEqual(parsedW.trades[0]!.buyA.damage, 50000);
    const baselineW = clonePreservingBinary(parsedW);

    const sessionW = new WorldSession(createWorldDumpFromParsed([parsedW]));
    const jsonW = exportVillagersToJson(sessionW);

    const resWUnchanged = importVillagersFromJson(sessionW, jsonW);
    assert.strictEqual(resWUnchanged.success, true);
    assert.strictEqual(resWUnchanged.modifiedCount, 0);

    const jsonWName = JSON.parse(jsonW);
    jsonWName.villagers[0].customName = "Wider Damage Guy";
    const resWName = importVillagersFromJson(sessionW, JSON.stringify(jsonWName));
    assert.strictEqual(resWName.success, true);

    const currentW = sessionW.getVillager(parsedW.sessionVillagerId)!;
    const writtenW = writeVillagerToNbt(currentW, baselineW);
    const writtenRecipesW = writtenW.value.Offers.value.Recipes.value.value || writtenW.value.Offers.value.Recipes.value;
    const r0 = writtenRecipesW[0].value || writtenRecipesW[0];
    assert.strictEqual(r0.buyA.value.Damage.type, "int");
    assert.strictEqual(r0.buyA.value.Damage.value, 50000);
  });

  // Demand int32 bounds
  it("demand conforms to signed NBT int32 range", () => {
    const rawNbt = createRealisticVillagerNbt();
    const parsed = parseVillagerNbt(rawNbt, "6163746f7270726566697831", 0)!;
    const session = new WorldSession(createWorldDumpFromParsed([parsed]));
    const jsonString = exportVillagersToJson(session);

    // 2147483647 accepted
    const jsonMax = JSON.parse(jsonString);
    jsonMax.villagers[0].trades[0].demand = 2147483647;
    assert.strictEqual(importVillagersFromJson(session, JSON.stringify(jsonMax)).success, true);

    // 2147483648 rejected
    const jsonOver = JSON.parse(jsonString);
    jsonOver.villagers[0].trades[0].demand = 2147483648;
    assert.strictEqual(importVillagersFromJson(session, JSON.stringify(jsonOver)).success, false);

    // -2147483648 accepted
    const jsonMin = JSON.parse(jsonString);
    jsonMin.villagers[0].trades[0].demand = -2147483648;
    assert.strictEqual(importVillagersFromJson(session, JSON.stringify(jsonMin)).success, true);

    // -2147483649 rejected
    const jsonUnder = JSON.parse(jsonString);
    jsonUnder.villagers[0].trades[0].demand = -2147483649;
    assert.strictEqual(importVillagersFromJson(session, JSON.stringify(jsonUnder)).success, false);
  });

  // Float32 price multiplier bounds
  it("price multiplier protects against float32 overflow", () => {
    const rawNbt = createRealisticVillagerNbt();
    const parsed = parseVillagerNbt(rawNbt, "6163746f7270726566697831", 0)!;
    const session = new WorldSession(createWorldDumpFromParsed([parsed]));
    const jsonString = exportVillagersToJson(session);

    // NBT_FLOAT_MAX accepted
    const jsonMax = JSON.parse(jsonString);
    jsonMax.villagers[0].trades[0].priceMultiplierA = NBT_FLOAT_MAX;
    assert.strictEqual(importVillagersFromJson(session, JSON.stringify(jsonMax)).success, true);

    // Overflow rejected
    const jsonOver = JSON.parse(jsonString);
    jsonOver.villagers[0].trades[0].priceMultiplierA = 1e39;
    const resOver = importVillagersFromJson(session, JSON.stringify(jsonOver));
    assert.strictEqual(resOver.success, false);
    assert.ok(resOver.error?.includes("cannot be represented as a finite Bedrock NBT float"));
  });

  // Static trade ID source check
  it("codebase uses allocateUniqueTradeId and not 4-hex UUID slicing for trade IDs", () => {
    const jsonExchangeTs = fs.readFileSync(path.join(process.cwd(), "src", "core", "jsonExchange.ts"), "utf8");
    const worldSessionTs = fs.readFileSync(path.join(process.cwd(), "src", "core", "session", "WorldSession.ts"), "utf8");
    const tradeIdsTs = fs.readFileSync(path.join(process.cwd(), "src", "core", "tradeIds.ts"), "utf8");

    assert.strictEqual(jsonExchangeTs.includes(".slice(0, 4)"), false);
    assert.strictEqual(worldSessionTs.includes(".slice(0, 4)"), false);

    assert.ok(tradeIdsTs.includes("export function allocateUniqueTradeId"));
    assert.ok(jsonExchangeTs.includes("allocateUniqueTradeId"));
    assert.ok(worldSessionTs.includes("allocateUniqueTradeId"));
  });
});
