/**
 * Bedrock Vanilla Biome Palette and Color Categories.
 *
 * Maps Minecraft Bedrock numeric biome IDs to curated, readable 2D map colors.
 * Height is decoupled from base biome color: biomes define what the terrain is,
 * while elevation provides subtle relief shading.
 *
 * Reference identity: Bedrock 1.26.x int_map registry snapshot.
 */

export interface BiomeColorEntry {
  name: string;
  color: [number, number, number];
}

// Curated RGB colors for Bedrock biomes [R, G, B]
export const BEDROCK_BIOME_COLORS: Record<number, BiomeColorEntry> = {
  // Vanilla Base Biomes
  0: { name: "ocean", color: [32, 82, 148] },
  1: { name: "plains", color: [118, 168, 70] },
  2: { name: "desert", color: [216, 196, 136] },
  3: { name: "extreme_hills", color: [108, 134, 94] },
  4: { name: "forest", color: [56, 122, 45] },
  5: { name: "taiga", color: [72, 108, 76] },
  6: { name: "swampland", color: [60, 84, 50] },
  7: { name: "river", color: [44, 106, 175] },
  8: { name: "hell", color: [115, 35, 30] },
  9: { name: "the_end", color: [220, 222, 158] },
  10: { name: "legacy_frozen_ocean", color: [136, 178, 208] },
  11: { name: "frozen_river", color: [118, 162, 202] },
  12: { name: "ice_plains", color: [236, 246, 252] },
  13: { name: "ice_mountains", color: [212, 226, 236] },
  14: { name: "mushroom_island", color: [128, 104, 124] },
  15: { name: "mushroom_island_shore", color: [142, 118, 132] },
  16: { name: "beach", color: [224, 208, 146] },
  17: { name: "desert_hills", color: [208, 186, 126] },
  18: { name: "forest_hills", color: [68, 118, 52] },
  19: { name: "taiga_hills", color: [66, 100, 70] },
  20: { name: "extreme_hills_edge", color: [104, 126, 88] },
  21: { name: "jungle", color: [44, 146, 36] },
  22: { name: "jungle_hills", color: [40, 136, 32] },
  23: { name: "jungle_edge", color: [66, 140, 48] },
  24: { name: "deep_ocean", color: [22, 58, 118] },
  25: { name: "stone_beach", color: [138, 136, 128] },
  26: { name: "cold_beach", color: [222, 226, 218] },
  27: { name: "birch_forest", color: [84, 148, 66] },
  28: { name: "birch_forest_hills", color: [80, 140, 62] },
  29: { name: "roofed_forest", color: [32, 76, 26] },
  30: { name: "cold_taiga", color: [172, 192, 182] },
  31: { name: "cold_taiga_hills", color: [162, 182, 172] },
  32: { name: "mega_taiga", color: [54, 94, 58] },
  33: { name: "mega_taiga_hills", color: [50, 86, 54] },
  34: { name: "extreme_hills_plus_trees", color: [84, 116, 74] },
  35: { name: "savanna", color: [164, 158, 66] },
  36: { name: "savanna_plateau", color: [154, 148, 60] },
  37: { name: "mesa", color: [196, 106, 50] },
  38: { name: "mesa_plateau_stone", color: [166, 116, 60] },
  39: { name: "mesa_plateau", color: [186, 100, 46] },
  40: { name: "warm_ocean", color: [42, 138, 172] },
  41: { name: "deep_warm_ocean", color: [24, 102, 138] },
  42: { name: "lukewarm_ocean", color: [34, 112, 155] },
  43: { name: "deep_lukewarm_ocean", color: [20, 80, 125] },
  44: { name: "cold_ocean", color: [28, 74, 130] },
  45: { name: "deep_cold_ocean", color: [18, 56, 106] },
  46: { name: "frozen_ocean", color: [136, 178, 208] },
  47: { name: "deep_frozen_ocean", color: [56, 90, 136] },
  48: { name: "bamboo_jungle", color: [76, 166, 40] },
  49: { name: "bamboo_jungle_hills", color: [70, 156, 36] },

  // Legacy / Mutated Biomes (129-167)
  129: { name: "sunflower_plains", color: [132, 180, 68] },
  130: { name: "desert_mutated", color: [202, 192, 140] },
  131: { name: "extreme_hills_mutated", color: [130, 134, 128] },
  132: { name: "flower_forest", color: [72, 156, 76] },
  133: { name: "taiga_mutated", color: [66, 102, 72] },
  134: { name: "swampland_mutated", color: [54, 78, 46] },
  140: { name: "ice_plains_spikes", color: [214, 236, 246] },
  149: { name: "jungle_mutated", color: [42, 142, 34] },
  151: { name: "jungle_edge_mutated", color: [62, 136, 46] },
  155: { name: "birch_forest_mutated", color: [86, 152, 68] },
  156: { name: "birch_forest_hills_mutated", color: [82, 144, 64] },
  157: { name: "roofed_forest_mutated", color: [28, 70, 24] },
  158: { name: "cold_taiga_mutated", color: [166, 186, 176] },
  160: { name: "redwood_taiga_mutated", color: [48, 88, 52] },
  161: { name: "redwood_taiga_hills_mutated", color: [44, 82, 48] },
  162: { name: "extreme_hills_plus_trees_mutated", color: [124, 126, 120] },
  163: { name: "savanna_mutated", color: [156, 150, 58] },
  164: { name: "savanna_plateau_mutated", color: [148, 142, 54] },
  165: { name: "mesa_bryce", color: [208, 112, 46] },
  166: { name: "mesa_plateau_stone_mutated", color: [160, 110, 56] },
  167: { name: "mesa_plateau_mutated", color: [180, 96, 44] },

  // Modern Bedrock Biomes (178-193)
  178: { name: "soul_sand_valley", color: [84, 70, 60] },
  179: { name: "crimson_forest", color: [144, 28, 28] },
  180: { name: "warped_forest", color: [22, 126, 124] },
  181: { name: "basalt_deltas", color: [68, 64, 72] },
  182: { name: "jagged_peaks", color: [238, 244, 250] },
  183: { name: "frozen_peaks", color: [218, 234, 246] },
  184: { name: "snowy_slopes", color: [228, 236, 244] },
  185: { name: "grove", color: [182, 202, 192] },
  186: { name: "meadow", color: [108, 174, 76] },
  187: { name: "lush_caves", color: [90, 156, 60] },
  188: { name: "dripstone_caves", color: [134, 104, 80] },
  189: { name: "stony_peaks", color: [136, 130, 122] },
  190: { name: "deep_dark", color: [14, 26, 38] },
  191: { name: "mangrove_swamp", color: [50, 96, 62] },
  192: { name: "cherry_grove", color: [238, 172, 196] },
  193: { name: "pale_garden", color: [156, 168, 152] }
};

export const DEFAULT_OVERWORLD_COLOR: [number, number, number] = [118, 168, 70]; // Plains green
export const DEFAULT_NETHER_COLOR: [number, number, number] = [115, 35, 30]; // Nether red-brown
export const DEFAULT_END_COLOR: [number, number, number] = [220, 222, 158]; // End stone cream

export const NETHER_BIOME_IDS = new Set<number>([
  8,
  178,
  179,
  180,
  181
]);

export const END_BIOME_IDS = new Set<number>([
  9
]);

export const OVERWORLD_BIOME_IDS = new Set<number>(
  Object.keys(BEDROCK_BIOME_COLORS)
    .map(Number)
    .filter((id) => !NETHER_BIOME_IDS.has(id) && !END_BIOME_IDS.has(id))
);

/**
 * Returns the base RGB color for a given biome ID and dimension.
 */
export function getBiomeBaseColor(
  biomeId: number | undefined,
  dimensionId: 0 | 1 | 2
): [number, number, number] {
  if (dimensionId === 1) {
    if (
      biomeId !== undefined &&
      NETHER_BIOME_IDS.has(biomeId) &&
      BEDROCK_BIOME_COLORS[biomeId]
    ) {
      return BEDROCK_BIOME_COLORS[biomeId]!.color;
    }
    return DEFAULT_NETHER_COLOR;
  }

  if (dimensionId === 2) {
    if (
      biomeId !== undefined &&
      END_BIOME_IDS.has(biomeId) &&
      BEDROCK_BIOME_COLORS[biomeId]
    ) {
      return BEDROCK_BIOME_COLORS[biomeId]!.color;
    }
    return DEFAULT_END_COLOR;
  }

  // Overworld
  if (
    biomeId !== undefined &&
    OVERWORLD_BIOME_IDS.has(biomeId) &&
    BEDROCK_BIOME_COLORS[biomeId]
  ) {
    return BEDROCK_BIOME_COLORS[biomeId]!.color;
  }

  return DEFAULT_OVERWORLD_COLOR;
}

export const WATER_BIOME_IDS = new Set<number>([
  0,  // ocean
  7,  // river
  10, // legacy_frozen_ocean
  11, // frozen_river
  24, // deep_ocean
  40, // warm_ocean
  41, // deep_warm_ocean
  42, // lukewarm_ocean
  43, // deep_lukewarm_ocean
  44, // cold_ocean
  45, // deep_cold_ocean
  46, // frozen_ocean
  47  // deep_frozen_ocean
]);

export const NON_SOLID_PASS_THROUGH_BLOCKS = new Set<string>([
  "minecraft:air",
  "minecraft:cave_air",
  "minecraft:void_air",
  "minecraft:short_grass",
  "minecraft:tall_grass",
  "minecraft:grass",
  "minecraft:fern",
  "minecraft:large_fern",
  "minecraft:bush",
  "minecraft:dandelion",
  "minecraft:poppy",
  "minecraft:blue_orchid",
  "minecraft:allium",
  "minecraft:azure_bluet",
  "minecraft:red_tulip",
  "minecraft:orange_tulip",
  "minecraft:white_tulip",
  "minecraft:pink_tulip",
  "minecraft:oxeye_daisy",
  "minecraft:cornflower",
  "minecraft:lily_of_the_valley",
  "minecraft:sunflower",
  "minecraft:lilac",
  "minecraft:rose_bush",
  "minecraft:peony",
  "minecraft:wildflowers",
  "minecraft:deadbush",
  "minecraft:torch",
  "minecraft:redstone_torch",
  "minecraft:soul_torch",
  "minecraft:lantern",
  "minecraft:soul_lantern",
  "minecraft:chain",
  "minecraft:iron_bars",
  "minecraft:ladder",
  "minecraft:redstone_wire",
  "minecraft:tripwire",
  "minecraft:tripwire_hook",
  "minecraft:lever",
  "minecraft:flower_pot",
  "minecraft:carpet",
  "minecraft:vine",
  "minecraft:glow_lichen",
  "minecraft:spore_blossom",
  "minecraft:hanging_roots"
]);

// Authentic material colors for common Minecraft surface blocks [R, G, B]
export const BLOCK_MATERIAL_COLORS: Record<string, [number, number, number]> = {
  // Village dirt paths & roads
  "minecraft:grass_path": [165, 138, 92],
  "minecraft:dirt_path": [165, 138, 92],

  // Farmland & crops
  "minecraft:farmland": [88, 56, 32],
  "minecraft:wheat": [146, 182, 54],
  "minecraft:carrots": [142, 178, 50],
  "minecraft:potatoes": [140, 175, 48],
  "minecraft:beetroot": [148, 160, 52],
  "minecraft:beetroots": [148, 160, 52],
  "minecraft:hay_block": [212, 174, 38],
  "minecraft:composter": [130, 88, 46],

  // Wood: Planks, logs, stairs, slabs, fences, doors
  // Oak
  "minecraft:oak_planks": [162, 130, 78],
  "minecraft:oak_log": [112, 88, 52],
  "minecraft:oak_wood": [112, 88, 52],
  "minecraft:stripped_oak_log": [178, 144, 90],
  "minecraft:stripped_oak_wood": [178, 144, 90],
  "minecraft:oak_stairs": [162, 130, 78],
  "minecraft:oak_slab": [162, 130, 78],
  "minecraft:oak_fence": [162, 130, 78],
  "minecraft:oak_fence_gate": [162, 130, 78],
  "minecraft:wooden_door": [162, 130, 78],
  "minecraft:trapdoor": [152, 120, 70],
  "minecraft:fence_gate": [162, 130, 78],

  // Spruce
  "minecraft:spruce_planks": [114, 84, 56],
  "minecraft:spruce_log": [64, 46, 28],
  "minecraft:spruce_wood": [64, 46, 28],
  "minecraft:stripped_spruce_log": [116, 90, 60],
  "minecraft:spruce_stairs": [114, 84, 56],
  "minecraft:spruce_slab": [114, 84, 56],
  "minecraft:spruce_fence": [114, 84, 56],
  "minecraft:spruce_door": [108, 80, 52],

  // Birch
  "minecraft:birch_planks": [216, 202, 150],
  "minecraft:birch_log": [224, 224, 220],
  "minecraft:birch_wood": [224, 224, 220],
  "minecraft:stripped_birch_log": [216, 204, 154],
  "minecraft:birch_stairs": [216, 202, 150],
  "minecraft:birch_slab": [216, 202, 150],
  "minecraft:birch_fence": [216, 202, 150],

  // Jungle
  "minecraft:jungle_planks": [160, 115, 80],
  "minecraft:jungle_log": [92, 70, 48],
  "minecraft:stripped_jungle_log": [164, 120, 84],

  // Acacia
  "minecraft:acacia_planks": [168, 90, 50],
  "minecraft:acacia_log": [108, 100, 92],
  "minecraft:stripped_acacia_log": [174, 94, 54],

  // Dark Oak
  "minecraft:dark_oak_planks": [66, 43, 20],
  "minecraft:dark_oak_log": [60, 40, 20],
  "minecraft:stripped_dark_oak_log": [70, 46, 22],

  // Mangrove & Cherry & Bamboo
  "minecraft:mangrove_planks": [118, 54, 48],
  "minecraft:mangrove_log": [84, 38, 34],
  "minecraft:cherry_planks": [228, 176, 172],
  "minecraft:cherry_log": [60, 36, 40],
  "minecraft:bamboo_planks": [192, 176, 78],
  "minecraft:bamboo_block": [108, 146, 52],

  // Stone, cobblestone, masonry, walls
  "minecraft:cobblestone": [122, 122, 122],
  "minecraft:mossy_cobblestone": [108, 122, 102],
  "minecraft:cobblestone_wall": [122, 122, 122],
  "minecraft:cobblestone_stairs": [122, 122, 122],
  "minecraft:cobblestone_slab": [122, 122, 122],
  "minecraft:stone": [125, 125, 125],
  "minecraft:smooth_stone": [140, 140, 140],
  "minecraft:smooth_stone_double_slab": [140, 140, 140],
  "minecraft:stone_stairs": [125, 125, 125],
  "minecraft:stone_slab": [125, 125, 125],
  "minecraft:stone_bricks": [120, 120, 120],
  "minecraft:mossy_stone_bricks": [112, 122, 108],
  "minecraft:cracked_stone_bricks": [115, 115, 115],
  "minecraft:andesite": [132, 134, 133],
  "minecraft:polished_andesite": [134, 136, 135],
  "minecraft:diorite": [180, 180, 182],
  "minecraft:polished_diorite": [188, 188, 190],
  "minecraft:granite": [150, 103, 84],
  "minecraft:polished_granite": [154, 106, 88],
  "minecraft:gravel": [130, 126, 125],
  "minecraft:deepslate": [80, 80, 84],
  "minecraft:cobbled_deepslate": [76, 76, 80],
  "minecraft:polished_deepslate": [84, 84, 88],
  "minecraft:deepslate_bricks": [78, 78, 82],
  "minecraft:bedrock": [50, 50, 50],
  "minecraft:obsidian": [20, 18, 30],
  "minecraft:crying_obsidian": [36, 22, 54],
  "minecraft:brick_block": [150, 67, 52],
  "minecraft:mud_bricks": [138, 106, 80],

  // Minerals & Ores
  "minecraft:coal_ore": [108, 108, 108],
  "minecraft:iron_ore": [138, 128, 120],
  "minecraft:copper_ore": [130, 116, 110],
  "minecraft:gold_ore": [148, 136, 92],
  "minecraft:redstone_ore": [156, 96, 96],
  "minecraft:emerald_ore": [112, 138, 116],
  "minecraft:lapis_ore": [98, 112, 142],
  "minecraft:diamond_ore": [112, 146, 150],

  // Dirt & Ground
  "minecraft:dirt": [134, 96, 67],
  "minecraft:coarse_dirt": [122, 86, 58],
  "minecraft:rooted_dirt": [140, 102, 74],
  "minecraft:podzol": [102, 74, 44],
  "minecraft:mud": [60, 58, 62],
  "minecraft:packed_mud": [140, 108, 82],
  "minecraft:clay": [158, 164, 176],
  "minecraft:mycelium": [111, 99, 105],
  "minecraft:soul_sand": [84, 64, 52],
  "minecraft:soul_soil": [78, 58, 46],

  // Sand & Terracotta
  "minecraft:sand": [218, 208, 154],
  "minecraft:sandstone": [214, 202, 148],
  "minecraft:red_sand": [190, 102, 42],
  "minecraft:red_sandstone": [186, 98, 38],
  "minecraft:terracotta": [150, 92, 66],

  // Liquids & Ice & Snow
  "minecraft:water": [46, 108, 186],
  "minecraft:flowing_water": [46, 108, 186],
  "minecraft:lava": [216, 100, 32],
  "minecraft:flowing_lava": [216, 100, 32],
  "minecraft:ice": [160, 196, 240],
  "minecraft:packed_ice": [140, 180, 234],
  "minecraft:blue_ice": [116, 166, 242],
  "minecraft:snow": [242, 248, 255],
  "minecraft:snow_layer": [242, 248, 255],
  "minecraft:powder_snow": [245, 250, 255],

  // Village items/furniture
  "minecraft:bed": [182, 40, 40],
  "minecraft:chest": [168, 126, 44],
  "minecraft:smoker": [96, 96, 98],
  "minecraft:lit_smoker": [110, 96, 90],
  "minecraft:furnace": [110, 110, 112],
  "minecraft:blast_furnace": [86, 86, 90],
  "minecraft:brewing_stand": [124, 112, 92],
  "minecraft:fletching_table": [196, 178, 134],
  "minecraft:cartography_table": [114, 94, 68],
  "minecraft:smithing_table": [56, 58, 68],
  "minecraft:grindstone": [142, 142, 144],
  "minecraft:lectern": [172, 138, 86],
  "minecraft:loom": [174, 144, 108],
  "minecraft:stonecutter_block": [128, 128, 130],
  "minecraft:bell": [226, 196, 68],

  // Glass & Crystals
  "minecraft:glass": [180, 210, 220],
  "minecraft:glass_pane": [180, 210, 220],
  "minecraft:white_stained_glass_pane": [240, 244, 248],
  "minecraft:yellow_stained_glass_pane": [234, 214, 68],
  "minecraft:amethyst_block": [132, 92, 182]
};

/**
 * Attenuates water RGB color based on depth below sea level.
 * Shallow waters (depth 0-2) are bright clear aqua, while deep waters (depth 20+) are dark navy.
 */
export function getWaterColorWithDepth(
  depth: number,
  baseColor: [number, number, number] = [46, 108, 186]
): [number, number, number] {
  const factor = Math.max(-28, Math.min(18, 18 - depth * 1.5));
  return [
    Math.max(0, Math.min(255, Math.round(baseColor[0] + factor * 0.7))),
    Math.max(0, Math.min(255, Math.round(baseColor[1] + factor * 0.8))),
    Math.max(0, Math.min(255, Math.round(baseColor[2] + factor * 1.1)))
  ];
}

/**
 * Returns the material color for an identified surface block or falls back to biome color.
 */
export function getBlockOrBiomeColor(
  blockName: string | null | undefined,
  biomeId: number | undefined,
  dimensionId: 0 | 1 | 2
): [number, number, number] {
  if (blockName) {
    const mat = BLOCK_MATERIAL_COLORS[blockName];
    if (mat) {
      return mat;
    }

    if (
      blockName === "minecraft:grass_block" ||
      blockName.endsWith("_leaves") ||
      blockName === "minecraft:leaves"
    ) {
      if (blockName === "minecraft:cherry_leaves") {
        return [242, 178, 203];
      }
      return getBiomeBaseColor(biomeId, dimensionId);
    }
  }

  return getBiomeBaseColor(biomeId, dimensionId);
}

