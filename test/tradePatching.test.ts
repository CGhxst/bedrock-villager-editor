import assert from "node:assert";
import test from "node:test";
import { clonePreservingBinary, deepEqualSafe } from "../src/core/clone";
import {
  NbtTags,
  parseBedrockNbt,
  writeBedrockNbt
} from "../src/core/nbtHelper";
import { ParsedVillager } from "../src/core/types";
import { parseVillagerNbt } from "../src/core/villagerParser";
import { writeVillagerToNbt } from "../src/core/villagerWriter";

function createMockVillagerNbt(recipes: any[] = []): any {
  return {
    type: "compound",
    name: "",
    value: {
      identifier: NbtTags.string("minecraft:villager_v2"),
      Profession: NbtTags.string("minecraft:librarian"),
      CareerLevel: NbtTags.int(1),
      TradeExperience: NbtTags.int(0),
      Pos: NbtTags.list("float", [0, 64, 0]),
      Offers: {
        type: "compound",
        value: {
          Recipes: NbtTags.list("compound", recipes)
        }
      }
    }
  };
}

// TRADE PATCH 1: modify trade 2 count only, recipe 1 deep-equals original
test("TRADE PATCH 1: Modifying trade 2 count preserves recipe 1 NBT exactly", () => {
  const r1 = {
    buyA: NbtTags.compound({ Name: NbtTags.string("minecraft:paper"), Count: NbtTags.byte(24), UnknownTag1: NbtTags.string("keep1") }),
    sell: NbtTags.compound({ Name: NbtTags.string("minecraft:emerald"), Count: NbtTags.byte(1) }),
    tier: NbtTags.int(1),
    maxUses: NbtTags.int(16),
    uses: NbtTags.int(0),
    traderExp: NbtTags.int(2),
    rewardExp: NbtTags.byte(1),
    priceMultiplierA: NbtTags.float(0.05),
    UnknownRecipeSibling: NbtTags.string("sibling_survives")
  };

  const r2 = {
    buyA: NbtTags.compound({ Name: NbtTags.string("minecraft:book"), Count: NbtTags.byte(1) }),
    sell: NbtTags.compound({ Name: NbtTags.string("minecraft:compass"), Count: NbtTags.byte(1) }),
    tier: NbtTags.int(1),
    maxUses: NbtTags.int(12),
    uses: NbtTags.int(0),
    traderExp: NbtTags.int(1),
    rewardExp: NbtTags.byte(1),
    priceMultiplierA: NbtTags.float(0.05)
  };

  const rawNbt = createMockVillagerNbt([r1, r2]);
  const parsed = parseVillagerNbt(rawNbt, "6163746f7270726566697831", 0);
  assert.ok(parsed);

  const baseline = clonePreservingBinary(parsed);
  parsed.trades[1]!.buyA.count = 5;

  const patchedNbt = writeVillagerToNbt(parsed, baseline);
  const outRecipes = patchedNbt.value.Offers.value.Recipes.value.value;

  const firstRecipe = outRecipes[0].value || outRecipes[0];
  assert.strictEqual(firstRecipe.UnknownRecipeSibling.value, "sibling_survives");
  assert.strictEqual(firstRecipe.buyA.value.UnknownTag1.value, "keep1");
  assert.strictEqual(firstRecipe.buyA.value.Count.value, 24);

  const secondRecipe = outRecipes[1].value || outRecipes[1];
  assert.strictEqual(secondRecipe.buyA.value.Count.value, 5);
});

// TRADE PATCH 2: buyCountA and buyCountB consistency
test("TRADE PATCH 2: buyCountA when present overrides nested count on parse and updates in sync on write", () => {
  const r = {
    buyA: NbtTags.compound({ Name: NbtTags.string("minecraft:emerald"), Count: NbtTags.byte(1) }),
    buyCountA: NbtTags.int(24),
    sell: NbtTags.compound({ Name: NbtTags.string("minecraft:book"), Count: NbtTags.byte(1) }),
    tier: NbtTags.int(1),
    maxUses: NbtTags.int(12),
    uses: NbtTags.int(0),
    traderExp: NbtTags.int(1),
    rewardExp: NbtTags.byte(1),
    priceMultiplierA: NbtTags.float(0.05)
  };

  const rawNbt = createMockVillagerNbt([r]);
  const parsed = parseVillagerNbt(rawNbt, "6163746f7270726566697831", 0);
  assert.ok(parsed);
  assert.strictEqual(parsed.trades[0]?.buyA.count, 24, "Parsed buyA count should reflect buyCountA");

  const baseline = clonePreservingBinary(parsed);
  parsed.trades[0]!.buyA.count = 5;

  const patchedNbt = writeVillagerToNbt(parsed, baseline);
  const rawFirstRec = patchedNbt.value.Offers.value.Recipes.value.value[0];
  const outRec = rawFirstRec.value || rawFirstRec;

  assert.strictEqual(outRec.buyA.value.Count.value, 5);
  assert.strictEqual(outRec.buyCountA.value, 5);
});

// TRADE PATCH 3: editing enchantment level preserves unknown tags in enchantment compound
test("TRADE PATCH 3: Editing enchantment level preserves unknown tags in enchantment compound", () => {
  const r = {
    buyA: NbtTags.compound({ Name: NbtTags.string("minecraft:emerald"), Count: NbtTags.byte(1) }),
    sell: NbtTags.compound({
      Name: NbtTags.string("minecraft:enchanted_book"),
      Count: NbtTags.byte(1),
      tag: NbtTags.compound({
        ench: NbtTags.list("compound", [
          {
            id: NbtTags.short(9), // Sharpness
            lvl: NbtTags.short(1),
            UnknownEnchTag: NbtTags.string("keep_this_ench_tag")
          }
        ])
      })
    }),
    tier: NbtTags.int(1),
    maxUses: NbtTags.int(12),
    uses: NbtTags.int(0),
    traderExp: NbtTags.int(1),
    rewardExp: NbtTags.byte(1),
    priceMultiplierA: NbtTags.float(0.05)
  };

  const rawNbt = createMockVillagerNbt([r]);
  const parsed = parseVillagerNbt(rawNbt, "6163746f7270726566697831", 0);
  assert.ok(parsed);

  const baseline = clonePreservingBinary(parsed);
  parsed.trades[0]!.sell.enchantments![0]!.level = 5;

  const patchedNbt = writeVillagerToNbt(parsed, baseline);
  const enchList = patchedNbt.value.Offers.value.Recipes.value.value[0].sell.value.tag.value.ench.value.value;

  assert.strictEqual(enchList[0].id.value, 9);
  assert.strictEqual(enchList[0].lvl.value, 5);
  assert.strictEqual(enchList[0].UnknownEnchTag.value, "keep_this_ench_tag");
});

// DWELLER ISOLATION 1: unrelated edit preserves workstation and bed entries untouched
test("DWELLER ISOLATION 1: Unrelated edit leaves DwellerPositions workstation and bed raw entries untouched", () => {
  const rawNbt = createMockVillagerNbt([]);
  rawNbt.value.DwellerComponent = NbtTags.compound({
    DwellingIDs: NbtTags.list("long", [1001n]),
    DwellerPositions: NbtTags.list("compound", [
      {
        role: NbtTags.string("jobsite"),
        block_pos: NbtTags.list("int", [10, 64, 20]),
        UnknownDwellerTag1: NbtTags.string("preserve_ws")
      },
      {
        role: NbtTags.string("bed"),
        block_pos: NbtTags.list("int", [15, 64, 25]),
        UnknownDwellerTag2: NbtTags.string("preserve_bed")
      }
    ])
  });

  const parsed = parseVillagerNbt(rawNbt, "6163746f7270726566697831", 0);
  assert.ok(parsed);

  const baseline = clonePreservingBinary(parsed);
  parsed.customName = "PreservedVillager";

  const patchedNbt = writeVillagerToNbt(parsed, baseline);
  const dwellerPositions = patchedNbt.value.DwellerComponent.value.DwellerPositions.value.value;

  const wsEntry = dwellerPositions.find((p: any) => p.role.value === "jobsite");
  const bedEntry = dwellerPositions.find((p: any) => p.role.value === "bed");

  assert.deepStrictEqual(wsEntry.block_pos.value.value, [10, 64, 20]);
  assert.strictEqual(wsEntry.UnknownDwellerTag1.value, "preserve_ws");

  assert.deepStrictEqual(bedEntry.block_pos.value.value, [15, 64, 25]);
  assert.strictEqual(bedEntry.UnknownDwellerTag2.value, "preserve_bed");
});

// NAME SOURCES 1: preserve NameTag when CustomName was not originally present
test("NAME SOURCES 1: NameTag-only villager preserves NameTag on edit without creating CustomName", () => {
  const rawNbt = createMockVillagerNbt([]);
  delete rawNbt.value.CustomName;
  rawNbt.value.NameTag = NbtTags.string("OriginalNameTag");

  const parsed = parseVillagerNbt(rawNbt, "6163746f7270726566697831", 0);
  assert.ok(parsed);
  assert.strictEqual(parsed.customName, "OriginalNameTag");

  const baseline = clonePreservingBinary(parsed);
  parsed.customName = "UpdatedNameTag";

  const patchedNbt = writeVillagerToNbt(parsed, baseline);
  assert.strictEqual(patchedNbt.value.NameTag.value, "UpdatedNameTag");
  assert.strictEqual(patchedNbt.value.CustomName, undefined, "Must not introduce CustomName when only NameTag existed");
});

test("TRADE SERIALIZATION: createNewTradeRecipe returns plain compound value without double wrapping", () => {
  const rawNbt = createMockVillagerNbt([]);
  const parsed = parseVillagerNbt(rawNbt, "6163746f7270726566697831", 0);
  assert.ok(parsed);

  const baseline = clonePreservingBinary(parsed);
  parsed.trades.push({
    id: "new_trade_1",
    tier: 1,
    buyA: { id: "minecraft:emerald", count: 10 },
    buyB: null,
    sell: { id: "minecraft:arrow", count: 16 },
    maxUses: 16,
    uses: 0,
    traderExp: 1,
    rewardExp: true,
    priceMultiplierA: 0.05
  });

  const patched = writeVillagerToNbt(parsed, baseline);
  const recipesList = patched.value.Offers.value.Recipes.value.value;
  assert.strictEqual(recipesList.length, 1);

  const newRecipe = recipesList[0];
  assert.strictEqual(newRecipe.type, undefined, "Element in list should be a plain value object without wrapping type compound");
  assert.strictEqual(newRecipe.buyA.type, "compound");
  assert.strictEqual(newRecipe.buyA.value.Name.value, "minecraft:emerald");
  assert.strictEqual(newRecipe.buyA.value.Count.value, 10);
  assert.strictEqual(newRecipe.sell.type, "compound");
  assert.strictEqual(newRecipe.sell.value.Name.value, "minecraft:arrow");
  assert.strictEqual(newRecipe.sell.value.Count.value, 16);
});

test("TRADE ROUNDTRIP: new trade encodes and reparses through prismarine-nbt", async () => {
  const raw = createMockVillagerNbt([
    {
      buyA: NbtTags.compound({
        Name: NbtTags.string("minecraft:paper"),
        Count: NbtTags.byte(24)
      }),
      sell: NbtTags.compound({
        Name: NbtTags.string("minecraft:emerald"),
        Count: NbtTags.byte(1)
      }),
      tier: NbtTags.int(1),
      maxUses: NbtTags.int(16),
      uses: NbtTags.int(0),
      traderExp: NbtTags.int(1),
      rewardExp: NbtTags.byte(1),
      priceMultiplierA: NbtTags.float(0.05)
    }
  ]);

  const parsed = parseVillagerNbt(raw, "6163746f7270726566697831", 0);
  assert.ok(parsed);

  const baseline = clonePreservingBinary(parsed);
  parsed.trades.push({
    id: "new_trade_roundtrip",
    tier: 1,
    buyA: { id: "minecraft:emerald", count: 1 },
    buyB: null,
    sell: {
      id: "minecraft:enchanted_book",
      count: 1,
      enchantments: [
        {
          id: 26,
          name: "mending",
          level: 1
        }
      ]
    },
    maxUses: 16,
    uses: 0,
    traderExp: 1,
    rewardExp: true,
    priceMultiplierA: 0.05
  });

  const patched = writeVillagerToNbt(parsed, baseline);
  const bytes = writeBedrockNbt(patched, "little");
  const reparsedStorage = await parseBedrockNbt(bytes);
  const reparsed = parseVillagerNbt(
    reparsedStorage.parsed,
    "6163746f7270726566697831",
    0,
    {
      originalDbValueHash: "6163746f7270726566697831",
      nbtEncoding: reparsedStorage.metadata
    }
  );

  assert.ok(reparsed);
  assert.strictEqual(reparsed.trades.length, 2);

  const added = reparsed.trades[1];
  assert.strictEqual(added?.buyA.id, "minecraft:emerald");
  assert.strictEqual(added?.buyA.count, 1);
  assert.strictEqual(added?.sell.id, "minecraft:enchanted_book");
  assert.strictEqual(added?.sell.enchantments?.[0]?.id, 26);
  assert.strictEqual(added?.sell.enchantments?.[0]?.level, 1);
});

test("TRADE ENCHANTMENT SERIALIZATION: Unknown enchantment name without numeric ID throws informative error", () => {
  const rawNbt = createMockVillagerNbt([]);
  const parsed = parseVillagerNbt(rawNbt, "6163746f7270726566697831", 0);
  assert.ok(parsed);

  const baseline = clonePreservingBinary(parsed);
  parsed.trades.push({
    id: "new_trade_2",
    tier: 1,
    buyA: { id: "minecraft:emerald", count: 10 },
    buyB: null,
    sell: {
      id: "minecraft:enchanted_book",
      count: 1,
      enchantments: [
        {
          name: "nonexistent_fake_enchantment",
          level: 1
        }
      ]
    },
    maxUses: 16,
    uses: 0,
    traderExp: 1,
    rewardExp: true,
    priceMultiplierA: 0.05
  });

  assert.throws(() => {
    writeVillagerToNbt(parsed, baseline);
  }, /Cannot serialize unknown enchantment "nonexistent_fake_enchantment" without a numeric Bedrock ID/);
});

test("TRADE ITEM REPLACEMENT: Changing item ID creates a fresh compound without old custom tags", () => {
  const r = {
    buyA: NbtTags.compound({
      Name: NbtTags.string("minecraft:compass"),
      Count: NbtTags.byte(1),
      CustomOldDataTag: NbtTags.string("compass_specific_tag")
    }),
    sell: NbtTags.compound({ Name: NbtTags.string("minecraft:emerald"), Count: NbtTags.byte(1) }),
    tier: NbtTags.int(1),
    maxUses: NbtTags.int(16),
    uses: NbtTags.int(0),
    traderExp: NbtTags.int(1),
    rewardExp: NbtTags.byte(1),
    priceMultiplierA: NbtTags.float(0.05)
  };

  const rawNbt = createMockVillagerNbt([r]);
  const parsed = parseVillagerNbt(rawNbt, "6163746f7270726566697831", 0);
  assert.ok(parsed);

  const baseline = clonePreservingBinary(parsed);
  // Change Buy A to iron_ingot
  parsed.trades[0]!.buyA = { id: "minecraft:iron_ingot", count: 3 };

  const patched = writeVillagerToNbt(parsed, baseline);
  const outBuyA = patched.value.Offers.value.Recipes.value.value[0].buyA.value;

  assert.strictEqual(outBuyA.Name.value, "minecraft:iron_ingot");
  assert.strictEqual(outBuyA.Count.value, 3);
  assert.strictEqual(outBuyA.CustomOldDataTag, undefined, "Old item specific tags must not leak into new item ID compound");
});

test("TRADE BUY-B CREATION: Adding Buy B with count=1 creates a clean compound with explicit Count tag and roundtrips", async () => {
  const r = {
    buyA: NbtTags.compound({ Name: NbtTags.string("minecraft:emerald"), Count: NbtTags.byte(1) }),
    sell: NbtTags.compound({ Name: NbtTags.string("minecraft:book"), Count: NbtTags.byte(1) }),
    tier: NbtTags.int(1),
    maxUses: NbtTags.int(16),
    uses: NbtTags.int(0),
    traderExp: NbtTags.int(1),
    rewardExp: NbtTags.byte(1),
    priceMultiplierA: NbtTags.float(0.05)
  };

  const rawNbt = createMockVillagerNbt([r]);
  const parsed = parseVillagerNbt(rawNbt, "6163746f7270726566697831", 0);
  assert.ok(parsed);

  const baseline = clonePreservingBinary(parsed);
  parsed.trades[0]!.buyB = { id: "minecraft:paper", count: 1 };

  const patched = writeVillagerToNbt(parsed, baseline);
  const rawBuyB = patched.value.Offers.value.Recipes.value.value[0].buyB.value;

  assert.strictEqual(rawBuyB.Name.value, "minecraft:paper");
  assert.ok(rawBuyB.Count, "New Buy-B must contain an explicit Count tag even when count is exactly 1");
  assert.strictEqual(rawBuyB.Count.value, 1);

  // Full encode & reparse roundtrip
  const bytes = writeBedrockNbt(patched, "little");
  const reparsedStorage = await parseBedrockNbt(bytes);
  const reparsed = parseVillagerNbt(reparsedStorage.parsed, "6163746f7270726566697831", 0);
  assert.ok(reparsed);
  assert.strictEqual(reparsed.trades[0]?.buyB?.id, "minecraft:paper");
  assert.strictEqual(reparsed.trades[0]?.buyB?.count, 1);
});

test("TRADE COUNT-ONLY EDIT: Modifying item count preserves item tags, enchantments, and recipe sibling tags", async () => {
  const r = {
    buyA: NbtTags.compound({
      Name: NbtTags.string("minecraft:diamond_sword"),
      Count: NbtTags.byte(1),
      Damage: NbtTags.short(17),
      tag: NbtTags.compound({
        FutureItemField: NbtTags.string("keep_item_field"),
        ench: NbtTags.list("compound", [
          {
            id: NbtTags.short(9), // Sharpness
            lvl: NbtTags.short(1)
          }
        ])
      })
    }),
    buyCountA: NbtTags.int(1),
    sell: NbtTags.compound({ Name: NbtTags.string("minecraft:emerald"), Count: NbtTags.byte(1) }),
    tier: NbtTags.int(1),
    maxUses: NbtTags.int(16),
    uses: NbtTags.int(0),
    traderExp: NbtTags.int(1),
    rewardExp: NbtTags.byte(1),
    priceMultiplierA: NbtTags.float(0.05),
    FutureRecipeField: NbtTags.string("keep-recipe-field")
  };

  const rawNbt = createMockVillagerNbt([r]);
  const parsed = parseVillagerNbt(rawNbt, "6163746f7270726566697831", 0);
  assert.ok(parsed);

  const baseline = clonePreservingBinary(parsed);
  // Mutate count only
  parsed.trades[0]!.buyA.count = 2;

  const patched = writeVillagerToNbt(parsed, baseline);
  const outRec = patched.value.Offers.value.Recipes.value.value[0];
  const outBuyA = outRec.buyA.value;

  assert.strictEqual(outBuyA.Count.value, 2);
  assert.strictEqual(outRec.buyCountA.value, 2);
  assert.strictEqual(outBuyA.Damage.value, 17);
  assert.strictEqual(outBuyA.tag.value.FutureItemField.value, "keep_item_field");
  assert.strictEqual(outRec.FutureRecipeField.value, "keep-recipe-field");
  assert.strictEqual(outBuyA.tag.value.ench.value.value[0].id.value, 9);

  // Full encode & reparse roundtrip
  const bytes = writeBedrockNbt(patched, "little");
  const reparsedStorage = await parseBedrockNbt(bytes);

  const reparsedRoot = reparsedStorage.parsed.value as any;
  const reparsedRecipe = reparsedRoot.Offers.value.Recipes.value.value[0];
  const reparsedBuyA = reparsedRecipe.buyA.value;

  assert.strictEqual(reparsedBuyA.Count.value, 2);
  assert.strictEqual(reparsedRecipe.buyCountA.value, 2);
  assert.strictEqual(reparsedBuyA.Damage.value, 17);
  assert.strictEqual(
    reparsedBuyA.tag.value.FutureItemField.value,
    "keep_item_field"
  );
  assert.strictEqual(
    reparsedRecipe.FutureRecipeField.value,
    "keep-recipe-field"
  );
  assert.strictEqual(
    reparsedBuyA.tag.value.ench.value.value[0].id.value,
    9
  );

  const reparsed = parseVillagerNbt(reparsedStorage.parsed, "6163746f7270726566697831", 0);
  assert.ok(reparsed);
  assert.strictEqual(reparsed.trades[0]?.buyA.count, 2);
  assert.strictEqual(reparsed.trades[0]?.buyA.damage, 17);
  assert.strictEqual(reparsed.trades[0]?.buyA.enchantments?.[0]?.id, 9);
});

test("REWARD EXP TYPE PRESERVATION: rewardExp preserves byte or int numeric tag type", () => {
  const rByte = {
    buyA: NbtTags.compound({ Name: NbtTags.string("minecraft:emerald"), Count: NbtTags.byte(1) }),
    sell: NbtTags.compound({ Name: NbtTags.string("minecraft:book"), Count: NbtTags.byte(1) }),
    tier: NbtTags.int(1),
    maxUses: NbtTags.int(16),
    uses: NbtTags.int(0),
    traderExp: NbtTags.int(1),
    rewardExp: NbtTags.byte(1),
    priceMultiplierA: NbtTags.float(0.05)
  };

  const rInt = {
    buyA: NbtTags.compound({ Name: NbtTags.string("minecraft:emerald"), Count: NbtTags.byte(1) }),
    sell: NbtTags.compound({ Name: NbtTags.string("minecraft:book"), Count: NbtTags.byte(1) }),
    tier: NbtTags.int(1),
    maxUses: NbtTags.int(16),
    uses: NbtTags.int(0),
    traderExp: NbtTags.int(1),
    rewardExp: NbtTags.int(0),
    priceMultiplierA: NbtTags.float(0.05)
  };

  const rawNbt = createMockVillagerNbt([rByte, rInt]);
  const parsed = parseVillagerNbt(rawNbt, "6163746f7270726566697831", 0);
  assert.ok(parsed);

  const baseline = clonePreservingBinary(parsed);
  // Flip rewardExp on both
  parsed.trades[0]!.rewardExp = false;
  parsed.trades[1]!.rewardExp = true;

  const patched = writeVillagerToNbt(parsed, baseline);
  const outRecipes = patched.value.Offers.value.Recipes.value.value;

  assert.strictEqual(outRecipes[0].rewardExp.type, "byte");
  assert.strictEqual(outRecipes[0].rewardExp.value, 0);

  assert.strictEqual(outRecipes[1].rewardExp.type, "int");
  assert.strictEqual(outRecipes[1].rewardExp.value, 1);
});

test("UNKNOWN ENCHANTMENT PRESERVATION: Missing or non-numeric enchantment ID is preserved during enchantment patching without inventing id -1", async () => {
  const r = {
    buyA: NbtTags.compound({ Name: NbtTags.string("minecraft:emerald"), Count: NbtTags.byte(1) }),
    sell: NbtTags.compound({
      Name: NbtTags.string("minecraft:enchanted_book"),
      Count: NbtTags.byte(1),
      tag: NbtTags.compound({
        ench: NbtTags.list("compound", [
          {
            lvl: NbtTags.short(3),
            CustomStringIdentifier: NbtTags.string("custom_ench_identifier")
          },
          {
            id: NbtTags.short(9), // Sharpness
            lvl: NbtTags.short(1)
          }
        ])
      })
    }),
    tier: NbtTags.int(1),
    maxUses: NbtTags.int(16),
    uses: NbtTags.int(0),
    traderExp: NbtTags.int(1),
    rewardExp: NbtTags.byte(1),
    priceMultiplierA: NbtTags.float(0.05)
  };

  const rawNbt = createMockVillagerNbt([r]);
  const parsed = parseVillagerNbt(rawNbt, "6163746f7270726566697831", 0);
  assert.ok(parsed);

  assert.strictEqual(parsed.trades[0]?.sell.enchantments?.[0]?.id, undefined);
  assert.strictEqual(parsed.trades[0]?.sell.enchantments?.[0]?.level, 3);
  assert.strictEqual(parsed.trades[0]?.sell.enchantments?.[1]?.id, 9);

  const baseline = clonePreservingBinary(parsed);
  // Remove Sharpness from enchantment array, forcing enchantment list patching
  parsed.trades[0]!.sell.enchantments = [parsed.trades[0]!.sell.enchantments![0]!];

  const patched = writeVillagerToNbt(parsed, baseline);
  const enchList = patched.value.Offers.value.Recipes.value.value[0].sell.value.tag.value.ench.value.value;

  assert.strictEqual(enchList.length, 1);
  assert.strictEqual(enchList[0].id, undefined, "Must not invent an id: -1 tag for raw unknown enchantment");
  assert.strictEqual(enchList[0].CustomStringIdentifier.value, "custom_ench_identifier");
  assert.strictEqual(enchList[0].lvl.value, 3);

  // Full encode & reparse roundtrip
  const bytes = writeBedrockNbt(patched, "little");
  const reparsedStorage = await parseBedrockNbt(bytes);
  const reparsed = parseVillagerNbt(reparsedStorage.parsed, "6163746f7270726566697831", 0);
  assert.ok(reparsed);
  assert.strictEqual(reparsed.trades[0]?.sell.enchantments?.length, 1);
  assert.strictEqual(reparsed.trades[0]?.sell.enchantments?.[0]?.id, undefined);
  assert.strictEqual(reparsed.trades[0]?.sell.enchantments?.[0]?.level, 3);
});

test("DWELLER COMPONENT PRESERVATION: Profession change does not rewrite DwellerComponent when coordinates are unchanged", () => {
  const rawNbt = createMockVillagerNbt([]);
  rawNbt.value.DwellerComponent = NbtTags.compound({
    DwellingIDs: NbtTags.list("long", [12345n]),
    PreferredProfession: NbtTags.string("minecraft:farmer"),
    CustomDwellerTag: NbtTags.string("keep_dweller_tag")
  });

  const parsed = parseVillagerNbt(rawNbt, "6163746f7270726566697831", 0);
  assert.ok(parsed);

  const baseline = clonePreservingBinary(parsed);
  parsed.profession = "armorer";
  parsed.professionDisplayName = "Armorer";

  const patched = writeVillagerToNbt(parsed, baseline);

  assert.strictEqual(
    patched.value.DwellerComponent.value.CustomDwellerTag.value,
    "keep_dweller_tag",
    "DwellerComponent must remain untouched when links are unchanged"
  );
  assert.strictEqual(
    patched.value.DwellerComponent.value.PreferredProfession.value,
    "minecraft:farmer",
    "PreferredProfession in DwellerComponent is not overwritten by simple profession field edit"
  );
});

test("TRADE BUY-COUNT-B PRESERVATION: Adding Buy B preserves orphan raw buyCountB tag and tag type", async () => {
  const r = {
    buyA: NbtTags.compound({ Name: NbtTags.string("minecraft:emerald"), Count: NbtTags.byte(1) }),
    buyCountB: NbtTags.short(7),
    sell: NbtTags.compound({ Name: NbtTags.string("minecraft:book"), Count: NbtTags.byte(1) }),
    FutureRecipeField: NbtTags.string("preserve-me"),
    tier: NbtTags.int(1),
    maxUses: NbtTags.int(16),
    uses: NbtTags.int(0),
    traderExp: NbtTags.int(1),
    rewardExp: NbtTags.byte(1),
    priceMultiplierA: NbtTags.float(0.05)
  };

  const rawNbt = createMockVillagerNbt([r]);
  const parsed = parseVillagerNbt(rawNbt, "6163746f7270726566697831", 0);
  assert.ok(parsed);
  assert.strictEqual(parsed.trades[0]?.buyB, null);

  const baseline = clonePreservingBinary(parsed);
  parsed.trades[0]!.buyB = { id: "minecraft:paper", count: 1 };

  const patched = writeVillagerToNbt(parsed, baseline);
  const rawRecipe = patched.value.Offers.value.Recipes.value.value[0];

  assert.ok(rawRecipe.buyB, "buyB compound must exist");
  assert.strictEqual(rawRecipe.buyB.value.Name.value, "minecraft:paper");
  assert.strictEqual(rawRecipe.buyB.value.Count.value, 1);

  assert.ok(rawRecipe.buyCountB, "buyCountB must be preserved");
  assert.strictEqual(rawRecipe.buyCountB.type, "short", "buyCountB tag type short preserved");
  assert.strictEqual(rawRecipe.buyCountB.value, 1, "buyCountB numeric value updated to 1");

  assert.strictEqual(rawRecipe.FutureRecipeField.value, "preserve-me");

  // Roundtrip
  const bytes = writeBedrockNbt(patched, "little");
  const reparsedStorage = await parseBedrockNbt(bytes);
  const reparsed = parseVillagerNbt(reparsedStorage.parsed, "6163746f7270726566697831", 0);
  assert.ok(reparsed);
  assert.strictEqual(reparsed.trades[0]?.buyB?.id, "minecraft:paper");
  assert.strictEqual(reparsed.trades[0]?.buyB?.count, 1);

  const reparsedRaw = reparsedStorage.parsed.value.Offers.value.Recipes.value.value[0];
  assert.strictEqual(reparsedRaw.buyCountB.type, "short");
  assert.strictEqual(reparsedRaw.buyCountB.value, 1);
  assert.strictEqual(reparsedRaw.FutureRecipeField.value, "preserve-me");
});
