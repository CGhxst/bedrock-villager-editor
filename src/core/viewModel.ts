import {
  ParsedVillager,
  TradeItem,
  TradeItemView,
  TradeRecipe,
  TradeRecipeView,
  VillagerViewModel
} from "./types";

function toTradeItemView(item: TradeItem): TradeItemView {
  return {
    id: item.id,
    count: item.count,
    damage: item.damage,
    displayName: item.displayName,
    enchantments: item.enchantments
      ? item.enchantments.map((enchantment) => ({
          id: enchantment.id,
          name: enchantment.name,
          level: enchantment.level
        }))
      : undefined
  };
}

function toTradeRecipeView(recipe: TradeRecipe): TradeRecipeView {
  return {
    id: recipe.id || "trade_unassigned",
    tier: recipe.tier,
    buyA: toTradeItemView(recipe.buyA),
    buyB: recipe.buyB ? toTradeItemView(recipe.buyB) : null,
    sell: toTradeItemView(recipe.sell),
    maxUses: recipe.maxUses,
    uses: recipe.uses,
    traderExp: recipe.traderExp,
    rewardExp: recipe.rewardExp,
    priceMultiplierA: recipe.priceMultiplierA,
    priceMultiplierB: recipe.priceMultiplierB,
    demand: recipe.demand
  };
}

/**
 * Strips all internal, privileged, and DB storage metadata from a ParsedVillager
 * producing a safe VillagerViewModel for transmission across the IPC boundary to the renderer.
 */
export function toVillagerViewModel(
  villager: ParsedVillager,
  isDirty: boolean
): VillagerViewModel {
  return {
    sessionVillagerId: villager.sessionVillagerId,
    identifier: villager.identifier,
    customName: villager.customName,
    dimension: villager.dimension,
    dimensionId: villager.dimensionId,
    position: { ...villager.position },
    rotation: villager.rotation ? { ...villager.rotation } : undefined,
    profession: villager.profession,
    professionDisplayName: villager.professionDisplayName,
    professionKnown: villager.professionKnown,
    professionSource: villager.professionSource,
    careerLevel: villager.careerLevel,
    careerLevelName: villager.careerLevelName,
    experience: villager.experience,
    isCured: villager.isCured,
    isZombie: villager.isZombie,
    isConverting: villager.isConverting,
    conversionTime: villager.conversionTime,
    trades: villager.trades.map(toTradeRecipeView),
    linkedWorkstation: villager.linkedWorkstation
      ? {
          type: villager.linkedWorkstation.type,
          dimension: villager.linkedWorkstation.dimension,
          position: { ...villager.linkedWorkstation.position },
          blockVerified: villager.linkedWorkstation.blockVerified
        }
      : null,
    linkedBed: villager.linkedBed
      ? {
          type: villager.linkedBed.type,
          dimension: villager.linkedBed.dimension,
          position: { ...villager.linkedBed.position }
        }
      : null,
    workstationLinkSource: villager.workstationLinkSource,
    bedLinkSource: villager.bedLinkSource,
    isDirty
  };
}
