export interface EnchantmentDefinition {
  id: number;
  name: string;
  displayName: string;
  maxLevel: number;
}

export const BEDROCK_ENCHANTMENTS: Record<number, EnchantmentDefinition> = {
  0: { id: 0, name: "protection", displayName: "Protection", maxLevel: 4 },
  1: { id: 1, name: "fire_protection", displayName: "Fire Protection", maxLevel: 4 },
  2: { id: 2, name: "feather_falling", displayName: "Feather Falling", maxLevel: 4 },
  3: { id: 3, name: "blast_protection", displayName: "Blast Protection", maxLevel: 4 },
  4: { id: 4, name: "projectile_protection", displayName: "Projectile Protection", maxLevel: 4 },
  5: { id: 5, name: "thorns", displayName: "Thorns", maxLevel: 3 },
  6: { id: 6, name: "respiration", displayName: "Respiration", maxLevel: 3 },
  7: { id: 7, name: "depth_strider", displayName: "Depth Strider", maxLevel: 3 },
  8: { id: 8, name: "aqua_affinity", displayName: "Aqua Affinity", maxLevel: 1 },
  9: { id: 9, name: "sharpness", displayName: "Sharpness", maxLevel: 5 },
  10: { id: 10, name: "smite", displayName: "Smite", maxLevel: 5 },
  11: { id: 11, name: "bane_of_arthropods", displayName: "Bane of Arthropods", maxLevel: 5 },
  12: { id: 12, name: "knockback", displayName: "Knockback", maxLevel: 2 },
  13: { id: 13, name: "fire_aspect", displayName: "Fire Aspect", maxLevel: 2 },
  14: { id: 14, name: "looting", displayName: "Looting", maxLevel: 3 },
  15: { id: 15, name: "efficiency", displayName: "Efficiency", maxLevel: 5 },
  16: { id: 16, name: "silk_touch", displayName: "Silk Touch", maxLevel: 1 },
  17: { id: 17, name: "unbreaking", displayName: "Unbreaking", maxLevel: 3 },
  18: { id: 18, name: "fortune", displayName: "Fortune", maxLevel: 3 },
  19: { id: 19, name: "power", displayName: "Power", maxLevel: 5 },
  20: { id: 20, name: "punch", displayName: "Punch", maxLevel: 2 },
  21: { id: 21, name: "flame", displayName: "Flame", maxLevel: 1 },
  22: { id: 22, name: "infinity", displayName: "Infinity", maxLevel: 1 },
  23: { id: 23, name: "luck_of_the_sea", displayName: "Luck of the Sea", maxLevel: 3 },
  24: { id: 24, name: "lure", displayName: "Lure", maxLevel: 3 },
  25: { id: 25, name: "frost_walker", displayName: "Frost Walker", maxLevel: 2 },
  26: { id: 26, name: "mending", displayName: "Mending", maxLevel: 1 },
  27: { id: 27, name: "curse_of_binding", displayName: "Curse of Binding", maxLevel: 1 },
  28: { id: 28, name: "curse_of_vanishing", displayName: "Curse of Vanishing", maxLevel: 1 },
  29: { id: 29, name: "impaling", displayName: "Impaling", maxLevel: 5 },
  30: { id: 30, name: "riptide", displayName: "Riptide", maxLevel: 3 },
  31: { id: 31, name: "loyalty", displayName: "Loyalty", maxLevel: 3 },
  32: { id: 32, name: "channeling", displayName: "Channeling", maxLevel: 1 },
  33: { id: 33, name: "multishot", displayName: "Multishot", maxLevel: 1 },
  34: { id: 34, name: "piercing", displayName: "Piercing", maxLevel: 4 },
  35: { id: 35, name: "quick_charge", displayName: "Quick Charge", maxLevel: 3 },
  36: { id: 36, name: "soul_speed", displayName: "Soul Speed", maxLevel: 3 },
  37: { id: 37, name: "swift_sneak", displayName: "Swift Sneak", maxLevel: 3 },
  38: { id: 38, name: "wind_burst", displayName: "Wind Burst", maxLevel: 3 },
  39: { id: 39, name: "density", displayName: "Density", maxLevel: 5 },
  40: { id: 40, name: "breach", displayName: "Breach", maxLevel: 4 },
  41: { id: 41, name: "lunge", displayName: "Lunge", maxLevel: 3 }
};

const NAME_TO_ID: Record<string, number> = {};
for (const [idStr, def] of Object.entries(BEDROCK_ENCHANTMENTS)) {
  const id = parseInt(idStr, 10);
  NAME_TO_ID[def.name.toLowerCase()] = id;
  NAME_TO_ID[def.displayName.toLowerCase()] = id;
  NAME_TO_ID[def.name.toLowerCase().replace(/_/g, "")] = id;
}

export function getEnchantmentById(id: number): EnchantmentDefinition | null {
  return BEDROCK_ENCHANTMENTS[id] || null;
}

export function getEnchantmentByName(name: string): EnchantmentDefinition | null {
  if (!name) return null;

  const clean = name.toLowerCase().trim().replace(/^minecraft:/, "");
  const id = NAME_TO_ID[clean] ?? NAME_TO_ID[clean.replace(/_/g, "")];
  if (id !== undefined && BEDROCK_ENCHANTMENTS[id]) {
    return BEDROCK_ENCHANTMENTS[id];
  }

  const numId = parseInt(name, 10);
  if (!isNaN(numId) && BEDROCK_ENCHANTMENTS[numId]) {
    return BEDROCK_ENCHANTMENTS[numId];
  }

  return null;
}
