import {
  ParsedVillager,
  TradeItem,
  TradeRecipe
} from "./types";

export interface EditableTradeItemState {
  id: string;
  count: number;
  damage?: number;
  enchantments?: Array<{
    id?: number;
    name: string;
    level: number;
  }>;
}

export interface EditableTradeState {
  tier: number;
  buyA: EditableTradeItemState;
  buyB: EditableTradeItemState | null;
  sell: EditableTradeItemState;
  maxUses: number;
  uses: number;
  traderExp: number;
  rewardExp: boolean;
  priceMultiplierA: number;
  priceMultiplierB?: number;
  demand?: number;
  buyCountA?: number;
  buyCountB?: number;
}

export interface EditableVillagerState {
  customName: string | null;
  profession: string;
  careerLevel: number;
  experience: number;
  position: {
    x: number;
    y: number;
    z: number;
  };
  trades: EditableTradeState[];
  linkedWorkstation:
    | {
        position: {
          x: number;
          y: number;
          z: number;
        };
      }
    | null;
  linkedBed:
    | {
        position: {
          x: number;
          y: number;
          z: number;
        };
      }
    | null;
}

function roundTo(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function itemState(item: TradeItem): EditableTradeItemState {
  return {
    id: item.id,
    count: item.count,
    damage: item.damage || 0,
    enchantments: item.enchantments?.map((enchantment) => ({
      id: enchantment.id,
      name: enchantment.name,
      level: enchantment.level
    }))
  };
}

function tradeState(trade: TradeRecipe): EditableTradeState {
  return {
    tier: trade.tier,
    buyA: itemState(trade.buyA),
    buyB: trade.buyB ? itemState(trade.buyB) : null,
    sell: itemState(trade.sell),
    maxUses: trade.maxUses,
    uses: trade.uses,
    traderExp: trade.traderExp,
    rewardExp: Boolean(trade.rewardExp),
    priceMultiplierA: roundTo(trade.priceMultiplierA, 6),
    priceMultiplierB:
      trade.priceMultiplierB !== undefined
        ? roundTo(trade.priceMultiplierB, 6)
        : undefined,
    demand: trade.demand ?? undefined,
    buyCountA: trade.buyCountA,
    buyCountB: trade.buyCountB
  };
}

export function toEditableVillagerState(
  villager: ParsedVillager
): EditableVillagerState {
  return {
    customName: villager.customName || null,
    profession: villager.profession,
    careerLevel: villager.careerLevel,
    experience: villager.experience,
    position: {
      x: roundTo(villager.position.x, 5),
      y: roundTo(villager.position.y, 5),
      z: roundTo(villager.position.z, 5)
    },
    trades: villager.trades.map(tradeState),
    linkedWorkstation: villager.linkedWorkstation
      ? {
          position: {
            x: Math.trunc(villager.linkedWorkstation.position.x),
            y: Math.trunc(villager.linkedWorkstation.position.y),
            z: Math.trunc(villager.linkedWorkstation.position.z)
          }
        }
      : null,
    linkedBed: villager.linkedBed
      ? {
          position: {
            x: Math.trunc(villager.linkedBed.position.x),
            y: Math.trunc(villager.linkedBed.position.y),
            z: Math.trunc(villager.linkedBed.position.z)
          }
        }
      : null
  };
}

export interface SessionDirtyVillagerState {
  editable: EditableVillagerState;
  tradeIds: Array<string | null>;
}

export function toSessionDirtyVillagerState(
  villager: ParsedVillager
): SessionDirtyVillagerState {
  return {
    editable: toEditableVillagerState(villager),
    tradeIds: villager.trades.map((trade) => trade.id ?? null)
  };
}

