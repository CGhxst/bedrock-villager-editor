import { clonePreservingBinary, deepEqualSafe } from "./clone";
import { getEnchantmentById, getEnchantmentByName } from "./enchantments";
import { getProfessionById } from "./professions";
import { PROFESSION_DEFINITION_RE } from "./villagerParser";
import {
  Coordinates3D,
  EnchantmentData,
  ParsedVillager,
  TradeItem,
  TradeRecipe
} from "./types";

export function writeVillagerToNbt(
  villager: ParsedVillager,
  baseline: ParsedVillager
): any {
  const root = clonePreservingBinary(villager.rawNbt);
  const rootValue = root.value || root;

  // 1. Custom Name / NameTag
  if (villager.customName !== baseline.customName) {
    const sources = baseline.customNameSources || [];

    if (villager.customName && villager.customName.trim()) {
      const name = villager.customName.trim();
      if (sources.length === 0) {
        rootValue.CustomName = { type: "string", value: name };
      } else {
        for (const source of sources) {
          const existing = rootValue[source];
          rootValue[source] = {
            type: existing?.type || "string",
            value: name
          };
        }
      }
    } else {
      for (const source of sources) {
        delete rootValue[source];
      }
      if (sources.length === 0) {
        delete rootValue.CustomName;
      }
    }
  }

  // 2. Profession (Preserving representation)
  if (villager.profession !== baseline.profession) {
    writeProfessionBySource(rootValue, villager.profession, baseline.professionSource);
  }

  // 3. Career Level (Preserving representation)
  if (villager.careerLevel !== baseline.careerLevel) {
    writeCareerLevelBySource(rootValue, villager.careerLevel, baseline.careerLevelSource);
  }

  // 4. Experience
  if (villager.experience !== baseline.experience) {
    rootValue.TradeExperience = setNumericTagPreservingType(
      rootValue.TradeExperience,
      villager.experience,
      "int"
    );
  }

  // 5. Position (Preserving Pos list element type: double vs float)
  if (!deepEqualSafe(villager.position, baseline.position)) {
    patchPosition(rootValue, villager.position);
  }

  // 6. Trades (Offers.Recipes) - leaf-level patching
  if (!deepEqualSafe(villager.trades, baseline.trades)) {
    patchOffers(rootValue, villager.trades, baseline.trades);
  }

  return root;
}

function patchProfessionTag(
  root: any,
  key: string,
  profession: string
): void {
  const definition = getProfessionById(profession);
  if (!definition) {
    throw new Error(`Unsupported profession: ${profession}`);
  }

  const existing = root[key];
  const existingValue = existing?.value ?? existing;

  if (existing?.type === "string" || typeof existingValue === "string") {
    root[key] = {
      type: "string",
      value: `minecraft:${definition.id}`
    };
    return;
  }

  root[key] = setNumericTagPreservingType(existing, definition.numericId, "int");
}

function replaceProfessionDefinition(
  original: string,
  profession: string
): string {
  const clean = profession.replace(/^minecraft:/, "");
  if (/profession\s*:/i.test(original)) {
    return original.replace(/(profession\s*:\s*)[a-z0-9_:.-]+/i, `$1${clean}`);
  }
  if (/profession\s*=/i.test(original)) {
    return original.replace(/(profession\s*=\s*)[a-z0-9_:.-]+/i, `$1${clean}`);
  }
  return original;
}

export function writeProfessionBySource(
  root: any,
  profession: string,
  source?: string
): void {
  switch (source) {
    case "root:Profession":
    case "Profession":
      patchProfessionTag(root, "Profession", profession);
      break;

    case "root:profession":
    case "profession":
      patchProfessionTag(root, "profession", profession);
      break;

    case "root:ProfessionName":
    case "ProfessionName":
      patchProfessionTag(root, "ProfessionName", profession);
      break;

    case "root:professionName":
    case "professionName":
      patchProfessionTag(root, "professionName", profession);
      break;

    case "root:Career":
    case "Career":
      patchProfessionTag(root, "Career", profession);
      break;

    case "root:career":
    case "career":
      patchProfessionTag(root, "career", profession);
      break;

    case "root:PreferredProfession":
    case "PreferredProfession":
      patchProfessionTag(root, "PreferredProfession", profession);
      break;

    case "root:preferredProfession":
    case "preferredProfession":
      patchProfessionTag(root, "preferredProfession", profession);
      break;

    case "offers:Profession":
    case "Offers.Profession": {
      if (!root.Offers) root.Offers = { type: "compound", value: {} };
      const offers = root.Offers.value || root.Offers;
      patchProfessionTag(offers, "Profession", profession);
      break;
    }

    case "offers:profession":
    case "Offers.profession": {
      if (!root.Offers) root.Offers = { type: "compound", value: {} };
      const offers = root.Offers.value || root.Offers;
      patchProfessionTag(offers, "profession", profession);
      break;
    }

    case "offers:Career":
    case "Offers.Career": {
      if (!root.Offers) root.Offers = { type: "compound", value: {} };
      const offers = root.Offers.value || root.Offers;
      patchProfessionTag(offers, "Career", profession);
      break;
    }

    case "offers:career":
    case "Offers.career": {
      if (!root.Offers) root.Offers = { type: "compound", value: {} };
      const offers = root.Offers.value || root.Offers;
      patchProfessionTag(offers, "career", profession);
      break;
    }

    case "Definitions": {
      const defsList = root.Definitions?.value?.value || root.Definitions?.value || root.Definitions;
      const cleanProf = profession.replace(/^minecraft:/, "");

      if (Array.isArray(defsList)) {
        const itemType = root.Definitions?.value?.type || "string";
        let found = false;

        const updated = defsList.map((entry: any) => {
          const str = String(entry?.value !== undefined ? entry.value : entry);
          if (PROFESSION_DEFINITION_RE.test(str)) {
            found = true;
            return replaceProfessionDefinition(str, profession);
          }
          return str;
        });

        if (!found) {
          updated.push(`+minecraft:profession=${cleanProf}`);
        }

        root.Definitions = {
          type: "list",
          value: {
            type: itemType,
            value: updated
          }
        };
      } else {
        root.Definitions = {
          type: "list",
          value: {
            type: "string",
            value: [`+minecraft:profession=${cleanProf}`]
          }
        };
      }
      break;
    }

    case "definitions": {
      const defsList = root.definitions?.value?.value || root.definitions?.value || root.definitions;
      const cleanProf = profession.replace(/^minecraft:/, "");

      if (Array.isArray(defsList)) {
        const itemType = root.definitions?.value?.type || "string";
        let found = false;

        const updated = defsList.map((entry: any) => {
          const str = String(entry?.value !== undefined ? entry.value : entry);
          if (PROFESSION_DEFINITION_RE.test(str)) {
            found = true;
            return replaceProfessionDefinition(str, profession);
          }
          return str;
        });

        if (!found) {
          updated.push(`+minecraft:profession=${cleanProf}`);
        }

        root.definitions = {
          type: "list",
          value: {
            type: itemType,
            value: updated
          }
        };
      } else {
        root.definitions = {
          type: "list",
          value: {
            type: "string",
            value: [`+minecraft:profession=${cleanProf}`]
          }
        };
      }
      break;
    }

    default:
      patchProfessionTag(root, "Profession", profession);
      break;
  }
}

export function writeCareerLevelBySource(
  root: any,
  careerLevel: number,
  source?: string
): void {
  const offersVal = root.Offers?.value || root.Offers;

  switch (source) {
    case "root:CareerLevel":
      root.CareerLevel = setNumericTagPreservingType(root.CareerLevel, careerLevel, "int");
      break;
    case "root:careerLevel":
      root.careerLevel = setNumericTagPreservingType(root.careerLevel, careerLevel, "int");
      break;
    case "root:TradeTier":
      root.TradeTier = setNumericTagPreservingType(root.TradeTier, careerLevel, "int");
      break;
    case "root:tradeTier":
      root.tradeTier = setNumericTagPreservingType(root.tradeTier, careerLevel, "int");
      break;
    case "root:CareerTier":
      root.CareerTier = setNumericTagPreservingType(root.CareerTier, careerLevel, "int");
      break;
    case "root:careerTier":
      root.careerTier = setNumericTagPreservingType(root.careerTier, careerLevel, "int");
      break;
    case "root:Tier":
      root.Tier = setNumericTagPreservingType(root.Tier, careerLevel, "int");
      break;
    case "root:tier":
      root.tier = setNumericTagPreservingType(root.tier, careerLevel, "int");
      break;

    case "offers:Tier":
      if (offersVal) offersVal.Tier = setNumericTagPreservingType(offersVal.Tier, careerLevel, "int");
      break;
    case "offers:tier":
      if (offersVal) offersVal.tier = setNumericTagPreservingType(offersVal.tier, careerLevel, "int");
      break;
    case "offers:CareerLevel":
      if (offersVal) offersVal.CareerLevel = setNumericTagPreservingType(offersVal.CareerLevel, careerLevel, "int");
      break;
    case "offers:careerLevel":
      if (offersVal) offersVal.careerLevel = setNumericTagPreservingType(offersVal.careerLevel, careerLevel, "int");
      break;
    case "offers:TradeTier":
      if (offersVal) offersVal.TradeTier = setNumericTagPreservingType(offersVal.TradeTier, careerLevel, "int");
      break;
    case "offers:tradeTier":
      if (offersVal) offersVal.tradeTier = setNumericTagPreservingType(offersVal.tradeTier, careerLevel, "int");
      break;
    case "offers:CareerTier":
      if (offersVal) offersVal.CareerTier = setNumericTagPreservingType(offersVal.CareerTier, careerLevel, "int");
      break;
    case "offers:careerTier":
      if (offersVal) offersVal.careerTier = setNumericTagPreservingType(offersVal.careerTier, careerLevel, "int");
      break;
    case "offers:MaxTier":
      if (offersVal) offersVal.MaxTier = setNumericTagPreservingType(offersVal.MaxTier, careerLevel, "int");
      break;
    case "offers:maxTier":
      if (offersVal) offersVal.maxTier = setNumericTagPreservingType(offersVal.maxTier, careerLevel, "int");
      break;

    case "definitions": {
      const defsKey = root.Definitions !== undefined ? "Definitions" : "definitions";
      const defsList = root[defsKey]?.value?.value || root[defsKey]?.value || root[defsKey];
      if (Array.isArray(defsList)) {
        const itemType = root[defsKey]?.value?.type || "string";
        let found = false;
        const updated = defsList.map((entry: any) => {
          const str = String(entry?.value !== undefined ? entry.value : entry);
          if (/tier_[0-9]+/i.test(str)) {
            found = true;
            return str.replace(/tier_[0-9]+/i, `tier_${careerLevel}`);
          }
          if (/(level[=_:][\s]*)[0-9]+/i.test(str)) {
            found = true;
            return str.replace(/(level[=_:][\s]*)[0-9]+/i, `$1${careerLevel}`);
          }
          if (/(tier[=_:][\s]*)[0-9]+/i.test(str)) {
            found = true;
            return str.replace(/(tier[=_:][\s]*)[0-9]+/i, `$1${careerLevel}`);
          }
          return str;
        });
        if (!found) {
          updated.push(`+minecraft:tier_${careerLevel}`);
        }
        root[defsKey] = {
          type: "list",
          value: {
            type: itemType,
            value: updated
          }
        };
      }
      break;
    }

    default:
      root.CareerLevel = setNumericTagPreservingType(root.CareerLevel, careerLevel, "int");
      break;
  }

  // Keep auxiliary TradeTier tags in sync if present
  if (root.TradeTier !== undefined) {
    root.TradeTier = setNumericTagPreservingType(root.TradeTier, careerLevel, "int");
  }
  if (root.tradeTier !== undefined) {
    root.tradeTier = setNumericTagPreservingType(root.tradeTier, careerLevel, "int");
  }
  if (offersVal && offersVal.TradeTier !== undefined) {
    offersVal.TradeTier = setNumericTagPreservingType(offersVal.TradeTier, careerLevel, "int");
  }
  if (offersVal && offersVal.tradeTier !== undefined) {
    offersVal.tradeTier = setNumericTagPreservingType(offersVal.tradeTier, careerLevel, "int");
  }
}

function patchPosition(root: any, pos: Coordinates3D): void {
  const existingPos = root.Pos;
  let itemType = "float";

  if (existingPos?.value?.type) {
    itemType = existingPos.value.type;
  } else if (existingPos?.type === "list" && existingPos?.value?.type) {
    itemType = existingPos.value.type;
  }

  root.Pos = {
    type: "list",
    value: {
      type: itemType,
      value: [pos.x, pos.y, pos.z]
    }
  };
}

export function patchOffers(
  root: any,
  currentTrades: TradeRecipe[],
  baselineTrades: TradeRecipe[]
): void {
  if (!root.Offers) {
    root.Offers = {
      type: "compound",
      value: {}
    };
  }

  const offersVal = root.Offers.value || root.Offers;
  const baselineMap = new Map<string, TradeRecipe>();
  baselineTrades.forEach((t) => {
    if (t.id) baselineMap.set(t.id, t);
  });

  const recipes: any[] = [];

  for (const currentTrade of currentTrades) {
    const baselineTrade = currentTrade.id ? baselineMap.get(currentTrade.id) : undefined;

    if (!baselineTrade) {
      recipes.push(createNewTradeRecipe(currentTrade));
      continue;
    }

    if (deepEqualSafe(currentTrade, baselineTrade)) {
      recipes.push(clonePreservingBinary(baselineTrade.rawRecipe));
      continue;
    }

    recipes.push(patchExistingTradeRecipe(baselineTrade.rawRecipe, currentTrade, baselineTrade));
  }

  offersVal.Recipes = {
    type: "list",
    value: {
      type: "compound",
      value: recipes
    }
  };
}

export function patchExistingTradeRecipe(
  originalRecipe: any,
  current: TradeRecipe,
  baseline: TradeRecipe
): any {
  const recipe = clonePreservingBinary(
    originalRecipe || {
      type: "compound",
      value: {}
    }
  );
  const value = recipe.value || recipe;

  // buyA item patching
  if (!deepEqualSafe(current.buyA, baseline.buyA)) {
    patchItemCompound(value, "buyA", current.buyA, baseline.buyA);
    if (value.buyCountA !== undefined) {
      value.buyCountA = setNumericTagPreservingType(value.buyCountA, current.buyA.count, "int");
    }
  }

  // buyB item patching
  if (!deepEqualSafe(current.buyB, baseline.buyB)) {
    if (!current.buyB) {
      delete value.buyB;
      delete value.buyCountB;
    } else if (!baseline.buyB) {
      value.buyB = createTradeItemCompound(current.buyB);
      // Preserve an existing raw recipe-level buyCountB if present.
      // Do not invent one when absent.
      if (value.buyCountB !== undefined) {
        value.buyCountB = setNumericTagPreservingType(
          value.buyCountB,
          current.buyB.count,
          "int"
        );
      }
    } else {
      patchItemCompound(value, "buyB", current.buyB, baseline.buyB);
      if (value.buyCountB !== undefined) {
        value.buyCountB = setNumericTagPreservingType(value.buyCountB, current.buyB.count, "int");
      }
    }
  }

  // sell item patching
  if (!deepEqualSafe(current.sell, baseline.sell)) {
    patchItemCompound(value, "sell", current.sell, baseline.sell);
  }

  // Scalar numeric & boolean fields
  if (current.maxUses !== baseline.maxUses) {
    value.maxUses = setNumericTagPreservingType(value.maxUses, current.maxUses, "int");
  }
  if (current.uses !== baseline.uses) {
    value.uses = setNumericTagPreservingType(value.uses, current.uses, "int");
  }
  if (current.tier !== baseline.tier) {
    value.tier = setNumericTagPreservingType(value.tier, current.tier, "int");
  }
  if (current.traderExp !== baseline.traderExp) {
    value.traderExp = setNumericTagPreservingType(value.traderExp, current.traderExp, "int");
  }
  if (current.rewardExp !== baseline.rewardExp) {
    value.rewardExp = setNumericTagPreservingType(
      value.rewardExp,
      current.rewardExp ? 1 : 0,
      "byte"
    );
  }
  if (current.priceMultiplierA !== baseline.priceMultiplierA) {
    value.priceMultiplierA = setNumericTagPreservingType(
      value.priceMultiplierA,
      current.priceMultiplierA,
      "float"
    );
  }
  if (current.priceMultiplierB !== baseline.priceMultiplierB) {
    if (current.priceMultiplierB === undefined || current.priceMultiplierB === null) {
      delete value.priceMultiplierB;
    } else {
      value.priceMultiplierB = setNumericTagPreservingType(
        value.priceMultiplierB,
        current.priceMultiplierB,
        "float"
      );
    }
  }
  if (current.demand !== baseline.demand) {
    if (current.demand === undefined || current.demand === null) {
      delete value.demand;
    } else {
      value.demand = setNumericTagPreservingType(value.demand, current.demand, "int");
    }
  }

  return recipe;
}

export function createTradeItemCompound(item: TradeItem): any {
  const value: any = {
    Name: {
      type: "string",
      value: item.id
    },
    Count: {
      type: "byte",
      value: item.count
    }
  };

  if (item.damage !== undefined) {
    value.Damage = {
      type: "short",
      value: item.damage
    };
  }

  if (item.enchantments && item.enchantments.length > 0) {
    value.tag = {
      type: "compound",
      value: {}
    };
    patchEnchantmentsOnly(value, item.enchantments);
  }

  return {
    type: "compound",
    value
  };
}

export function patchItemCompound(
  recipeValue: any,
  slot: "buyA" | "buyB" | "sell",
  currentItem: TradeItem,
  baselineItem: TradeItem
): void {
  if (currentItem.id !== baselineItem.id) {
    recipeValue[slot] = createTradeItemCompound(currentItem);
    return;
  }

  // Same item ID: leaf-patch existing raw compound below.
  if (!recipeValue[slot]) {
    recipeValue[slot] = createTradeItemCompound(currentItem);
    return;
  }

  const itemCompound = recipeValue[slot];
  const itemValue = itemCompound.value || itemCompound;

  if (currentItem.count !== baselineItem.count) {
    itemValue.Count = setNumericTagPreservingType(itemValue.Count, currentItem.count, "byte");
  }

  if (currentItem.damage !== baselineItem.damage) {
    if (currentItem.damage === undefined) {
      delete itemValue.Damage;
    } else {
      itemValue.Damage = setNumericTagPreservingType(itemValue.Damage, currentItem.damage, "short");
    }
  }

  if (!deepEqualSafe(currentItem.enchantments, baselineItem.enchantments)) {
    patchEnchantmentsOnly(itemValue, currentItem.enchantments || []);
  }
}

function resolveEnchantmentIdOrThrow(enchantment: EnchantmentData): number {
  if (typeof enchantment.id === "number") {
    return enchantment.id;
  }
  const definition = getEnchantmentByName(enchantment.name);
  if (!definition) {
    throw new Error(
      `Cannot serialize unknown enchantment "${enchantment.name}" without a numeric Bedrock ID.`
    );
  }
  return definition.id;
}

export function patchEnchantmentsOnly(
  itemValue: any,
  enchantments: EnchantmentData[]
): void {
  const tagCompound = itemValue.tag?.value || itemValue.tag;

  if (enchantments.length === 0) {
    if (tagCompound) {
      delete tagCompound.ench;
    }
    return;
  }

  if (!itemValue.tag) {
    itemValue.tag = {
      type: "compound",
      value: {}
    };
  }

  const activeTag = itemValue.tag.value || itemValue.tag;

  const encoded = enchantments.map((enchantment) => {
    if (enchantment.rawNbt) {
      const raw = clonePreservingBinary(enchantment.rawNbt);
      const value = raw.value || raw;
      const rawId = value.id?.value ?? value.id;

      if (
        typeof enchantment.id === "number" &&
        typeof rawId === "number" &&
        rawId !== enchantment.id
      ) {
        value.id = setNumericTagPreservingType(
          value.id,
          enchantment.id,
          "short"
        );
      }

      const rawLevel = value.lvl?.value ?? value.lvl;

      if (typeof rawLevel === "number") {
        if (rawLevel !== enchantment.level) {
          value.lvl = setNumericTagPreservingType(
            value.lvl,
            enchantment.level,
            "short"
          );
        }
      } else if (
        typeof enchantment.id === "number" &&
        getEnchantmentById(enchantment.id) &&
        enchantment.level !== 1
      ) {
        value.lvl = {
          type: "short",
          value: enchantment.level
        };
      }

      return raw;
    }

    const id = resolveEnchantmentIdOrThrow(enchantment);

    return {
      id: {
        type: "short",
        value: id
      },
      lvl: {
        type: "short",
        value: enchantment.level
      }
    };
  });

  activeTag.ench = {
    type: "list",
    value: {
      type: "compound",
      value: encoded
    }
  };
}

export function createNewTradeRecipe(trade: TradeRecipe): any {
  const value: any = {
    buyA: createTradeItemCompound(trade.buyA),
    sell: createTradeItemCompound(trade.sell),
    tier: {
      type: "int",
      value: trade.tier
    },
    maxUses: {
      type: "int",
      value: trade.maxUses
    },
    uses: {
      type: "int",
      value: trade.uses
    },
    traderExp: {
      type: "int",
      value: trade.traderExp
    },
    rewardExp: {
      type: "byte",
      value: trade.rewardExp ? 1 : 0
    },
    priceMultiplierA: {
      type: "float",
      value: trade.priceMultiplierA
    }
  };

  if (trade.buyB) {
    value.buyB = createTradeItemCompound(trade.buyB);
  }

  if (trade.priceMultiplierB !== undefined) {
    value.priceMultiplierB = {
      type: "float",
      value: trade.priceMultiplierB
    };
  }

  if (trade.demand !== undefined) {
    value.demand = {
      type: "int",
      value: trade.demand
    };
  }

  return value;
}

export function setNumericTagPreservingType(
  existingTag: any,
  value: number,
  fallbackType: "byte" | "short" | "int" | "long" | "float" | "double" = "int"
): any {
  const type = existingTag?.type || fallbackType;
  return {
    type,
    value
  };
}
