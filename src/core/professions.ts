export interface ProfessionDefinition {
  id: string; // e.g. "librarian"
  displayName: string;
  workstationBlock: string; // e.g. "minecraft:lectern"
  workstationDisplayName: string;
  numericId: number;
}

export const BEDROCK_PROFESSIONS: Record<string, ProfessionDefinition> = {
  unemployed: {
    id: "unemployed",
    displayName: "Unemployed",
    workstationBlock: "none",
    workstationDisplayName: "None",
    numericId: 0
  },
  farmer: {
    id: "farmer",
    displayName: "Farmer",
    workstationBlock: "minecraft:composter",
    workstationDisplayName: "Composter",
    numericId: 1
  },
  fisherman: {
    id: "fisherman",
    displayName: "Fisherman",
    workstationBlock: "minecraft:barrel",
    workstationDisplayName: "Barrel",
    numericId: 2
  },
  shepherd: {
    id: "shepherd",
    displayName: "Shepherd",
    workstationBlock: "minecraft:loom",
    workstationDisplayName: "Loom",
    numericId: 3
  },
  fletcher: {
    id: "fletcher",
    displayName: "Fletcher",
    workstationBlock: "minecraft:fletching_table",
    workstationDisplayName: "Fletching Table",
    numericId: 4
  },
  librarian: {
    id: "librarian",
    displayName: "Librarian",
    workstationBlock: "minecraft:lectern",
    workstationDisplayName: "Lectern",
    numericId: 5
  },
  cartographer: {
    id: "cartographer",
    displayName: "Cartographer",
    workstationBlock: "minecraft:cartography_table",
    workstationDisplayName: "Cartography Table",
    numericId: 6
  },
  cleric: {
    id: "cleric",
    displayName: "Cleric",
    workstationBlock: "minecraft:brewing_stand",
    workstationDisplayName: "Brewing Stand",
    numericId: 7
  },
  armorer: {
    id: "armorer",
    displayName: "Armorer",
    workstationBlock: "minecraft:blast_furnace",
    workstationDisplayName: "Blast Furnace",
    numericId: 8
  },
  weaponsmith: {
    id: "weaponsmith",
    displayName: "Weaponsmith",
    workstationBlock: "minecraft:grindstone",
    workstationDisplayName: "Grindstone",
    numericId: 9
  },
  toolsmith: {
    id: "toolsmith",
    displayName: "Toolsmith",
    workstationBlock: "minecraft:smithing_table",
    workstationDisplayName: "Smithing Table",
    numericId: 10
  },
  butcher: {
    id: "butcher",
    displayName: "Butcher",
    workstationBlock: "minecraft:smoker",
    workstationDisplayName: "Smoker",
    numericId: 11
  },
  leatherworker: {
    id: "leatherworker",
    displayName: "Leatherworker",
    workstationBlock: "minecraft:cauldron",
    workstationDisplayName: "Cauldron",
    numericId: 12
  },
  mason: {
    id: "mason",
    displayName: "Mason / Stone Mason",
    workstationBlock: "minecraft:stonecutter",
    workstationDisplayName: "Stonecutter",
    numericId: 13
  },
  nitwit: {
    id: "nitwit",
    displayName: "Nitwit",
    workstationBlock: "none",
    workstationDisplayName: "None",
    numericId: 14
  }
};

export const NUMERIC_ID_TO_PROFESSION: Record<number, string> = {};
for (const def of Object.values(BEDROCK_PROFESSIONS)) {
  NUMERIC_ID_TO_PROFESSION[def.numericId] = def.id;
}

export const CAREER_TIER_NAMES: Record<number, string> = {
  1: "Novice",
  2: "Apprentice",
  3: "Journeyman",
  4: "Expert",
  5: "Master"
};

export const WORKSTATION_BLOCK_TO_PROFESSION: Record<string, string> = {};
for (const [prof, def] of Object.entries(BEDROCK_PROFESSIONS)) {
  if (def.workstationBlock !== "none") {
    WORKSTATION_BLOCK_TO_PROFESSION[def.workstationBlock] = prof;
    WORKSTATION_BLOCK_TO_PROFESSION[def.workstationBlock.replace(/^minecraft:/, "")] = prof;
  }
}

export function getProfessionById(id: string): ProfessionDefinition | null {
  if (!id) return null;
  const clean = id.toLowerCase().trim().replace(/^minecraft:/, "");
  if (clean === "stone_mason" || clean === "stonemason") return BEDROCK_PROFESSIONS.mason || null;
  return BEDROCK_PROFESSIONS[clean] || null;
}

export function getProfessionByNumericId(numId: number): ProfessionDefinition | null {
  const profId = NUMERIC_ID_TO_PROFESSION[numId];
  return profId ? (BEDROCK_PROFESSIONS[profId] || null) : null;
}

export function normalizeProfession(name: string | number): string | null {
  if (typeof name === "number") {
    return NUMERIC_ID_TO_PROFESSION[name] || null;
  }

  if (name === null || name === undefined) return null;

  let clean = String(name)
    .toLowerCase()
    .trim()
    .replace(/^[+-]/, "")
    .replace(/^minecraft:/, "")
    .replace(/_v2$/, "");

  if (!clean) return null;

  const match = clean.match(/profession\s*[=:]\s*([a-z0-9_:.-]+)/i);
  if (match && match[1]) {
    clean = match[1].replace(/^minecraft:/, "");
  }

  const num = Number(clean);
  if (Number.isInteger(num) && NUMERIC_ID_TO_PROFESSION[num]) {
    return NUMERIC_ID_TO_PROFESSION[num];
  }

  if (clean === "stone_mason" || clean === "stonemason") return "mason";
  if (clean === "none" || clean === "normal" || clean === "unemployed") return "unemployed";

  if (BEDROCK_PROFESSIONS[clean]) return clean;

  return null;
}

const PROFESSION_TRADE_SIGNATURES: Record<string, string[]> = {
  librarian: [
    "enchanted_book",
    "bookshelf",
    "lantern",
    "glass",
    "name_tag",
    "clock",
    "book",
    "paper",
    "ink_sac"
  ],
  cartographer: [
    "ocean_explorer_map",
    "woodland_explorer_map",
    "locator_map",
    "empty_map",
    "map",
    "banner_pattern",
    "item_frame",
    "cartography_table"
  ],
  cleric: [
    "ender_pearl",
    "redstone",
    "lapis_lazuli",
    "brewing_stand",
    "bottle_o_enchanting",
    "experience_bottle",
    "glowstone",
    "glowstone_dust",
    "nether_wart",
    "scute",
    "gold_ingot",
    "rotten_flesh"
  ],
  armorer: [
    "diamond_helmet",
    "diamond_chestplate",
    "diamond_leggings",
    "diamond_boots",
    "iron_helmet",
    "iron_chestplate",
    "iron_leggings",
    "iron_boots",
    "chainmail_helmet",
    "chainmail_chestplate",
    "chainmail_leggings",
    "chainmail_boots",
    "shield",
    "blast_furnace"
  ],
  weaponsmith: [
    "diamond_sword",
    "diamond_axe",
    "iron_sword",
    "iron_axe",
    "bell",
    "grindstone"
  ],
  toolsmith: [
    "diamond_pickaxe",
    "diamond_shovel",
    "diamond_hoe",
    "iron_pickaxe",
    "iron_shovel",
    "iron_hoe",
    "smithing_table"
  ],
  fletcher: [
    "arrow",
    "bow",
    "crossbow",
    "flint_and_steel",
    "tipped_arrow",
    "fletching_table",
    "flint",
    "feather"
  ],
  farmer: [
    "wheat",
    "carrot",
    "potato",
    "beetroot",
    "bread",
    "pumpkin",
    "melon",
    "apple",
    "cookie",
    "cake",
    "pumpkin_pie",
    "golden_carrot",
    "glistering_melon_slice",
    "suspicious_stew",
    "composter"
  ],
  fisherman: [
    "raw_cod",
    "raw_salmon",
    "cooked_cod",
    "cooked_salmon",
    "cod",
    "salmon",
    "campfire",
    "fishing_rod",
    "bucket_of_cod",
    "tropical_fish",
    "barrel"
  ],
  shepherd: [
    "shears",
    "white_wool",
    "wool",
    "carpet",
    "loom",
    "painting",
    "banner"
  ],
  butcher: [
    "cooked_beef",
    "cooked_porkchop",
    "cooked_chicken",
    "cooked_mutton",
    "raw_beef",
    "raw_porkchop",
    "raw_chicken",
    "raw_mutton",
    "raw_rabbit",
    "rabbit_stew",
    "smoker"
  ],
  leatherworker: [
    "leather",
    "leather_boots",
    "leather_leggings",
    "leather_chestplate",
    "leather_helmet",
    "leather_horse_armor",
    "saddle",
    "cauldron"
  ],
  mason: [
    "clay_ball",
    "brick",
    "stone",
    "stonecutter",
    "granite",
    "diorite",
    "andesite",
    "polished_granite",
    "polished_diorite",
    "polished_andesite",
    "terracotta",
    "glazed_terracotta",
    "quartz",
    "quartz_block",
    "quartz_pillar",
    "dripstone_block"
  ]
};

export function inferProfessionFromTrades(
  trades: Array<{ buyA?: { id?: string } | null; buyB?: { id?: string } | null; sell?: { id?: string } | null }>
): string | null {
  if (!Array.isArray(trades) || trades.length === 0) return null;

  const scores: Record<string, number> = {};
  for (const prof of Object.keys(PROFESSION_TRADE_SIGNATURES)) {
    scores[prof] = 0;
  }

  for (const t of trades) {
    const itemIds = [t.buyA?.id, t.buyB?.id, t.sell?.id]
      .filter((id): id is string => Boolean(id))
      .map((id) => id.toLowerCase().replace(/^minecraft:/, ""));

    for (const [prof, sigs] of Object.entries(PROFESSION_TRADE_SIGNATURES)) {
      for (const itemId of itemIds) {
        if (sigs.some((sig) => itemId === sig || itemId.includes(sig))) {
          const isSell = t.sell?.id && t.sell.id.toLowerCase().includes(itemId);
          scores[prof] = (scores[prof] ?? 0) + (isSell ? 3 : 1);
        }
      }
    }
  }

  let bestProf: string | null = null;
  let maxScore = 0;
  for (const [prof, score] of Object.entries(scores)) {
    if (score > maxScore) {
      maxScore = score;
      bestProf = prof;
    }
  }

  return maxScore > 0 ? bestProf : null;
}

export function getProfessionDisplayName(id: string): string {
  if (id === "unknown") return "Unknown (preserved)";
  return BEDROCK_PROFESSIONS[id]?.displayName || id;
}

export function isKnownProfession(id: string): boolean {
  return Boolean(BEDROCK_PROFESSIONS[id]);
}

export function getAllProfessions(): Record<string, ProfessionDefinition> {
  return BEDROCK_PROFESSIONS;
}

export function normalizeProfessionId(name: any): { id: string; displayName: string; known: boolean } {
  const norm = normalizeProfession(name);
  if (norm) {
    return {
      id: norm,
      displayName: getProfessionDisplayName(norm),
      known: true
    };
  }
  return {
    id: "unknown",
    displayName: getProfessionDisplayName("unknown"),
    known: false
  };
}
