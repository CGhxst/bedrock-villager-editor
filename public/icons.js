/**
 * Minecraft Bedrock Villager Editor - Asset & Icon Renderer
 * Uses exact local Minecraft textures without external emoji fallbacks.
 */

const ASSET_ITEMS_DIR = "assets/items/";
const ASSET_BLOCKS_DIR = "assets/blocks/";

const ITEM_FILE_MAP = {
  "minecraft:clock": "clock_00.png",
  "minecraft:compass": "compass_00.png",
  "minecraft:turtle_scute": "scute.png",
  "minecraft:writable_book": "book_writable.png",
  "minecraft:written_book": "book_written.png",
  "minecraft:book": "book.png",
  "minecraft:enchanted_book": "enchanted_book.png",
  "minecraft:crossbow": "crossbow_standby.png",
  "minecraft:bow": "bow.png",
  "minecraft:fishing_rod": "fishing_rod.png",
  "minecraft:shield": "shield.png"
};

const BLOCK_FILE_MAP = {
  "minecraft:campfire": "campfire_log.png",
  "minecraft:lectern": "lectern_top.png",
  "minecraft:composter": "composter_side.png",
  "minecraft:barrel": "barrel_side.png",
  "minecraft:smoker": "smoker_front.png",
  "minecraft:blast_furnace": "blast_furnace_front.png",
  "minecraft:fletching_table": "fletching_table_top.png",
  "minecraft:cartography_table": "cartography_table_top.png",
  "minecraft:brewing_stand": "brewing_stand.png",
  "minecraft:smithing_table": "smithing_table_top.png",
  "minecraft:grindstone": "grindstone_side.png",
  "minecraft:cauldron": "cauldron_side.png",
  "minecraft:stonecutter": "stonecutter_top.png",
  "minecraft:loom": "loom_top.png",
  "minecraft:melon_block": "melon_side.png",
  "minecraft:pumpkin": "carved_pumpkin.png",
  "minecraft:stone": "stone.png",
  "minecraft:quartz_block": "quartz_block_side.png",
  "minecraft:dried_kelp_block": "dried_kelp_side.png",
  "minecraft:chiseled_stone_bricks": "chiseled_stone_bricks.png",
  "minecraft:diorite": "diorite.png",
  "minecraft:granite": "granite.png",
  "minecraft:polished_diorite": "polished_diorite.png",
  "minecraft:polished_granite": "polished_granite.png",
  "minecraft:bookshelf": "bookshelf.png",
  "minecraft:glass": "glass.png",
  "minecraft:glowstone": "glowstone.png",
  "minecraft:brown_terracotta": "brown_terracotta.png",
  "minecraft:pink_terracotta": "pink_terracotta.png",
  "minecraft:white_terracotta": "white_terracotta.png",
  "minecraft:orange_terracotta": "orange_terracotta.png",
  "minecraft:magenta_terracotta": "magenta_terracotta.png",
  "minecraft:light_blue_terracotta": "light_blue_terracotta.png",
  "minecraft:yellow_terracotta": "yellow_terracotta.png",
  "minecraft:lime_terracotta": "lime_terracotta.png",
  "minecraft:gray_terracotta": "gray_terracotta.png",
  "minecraft:light_gray_terracotta": "light_gray_terracotta.png",
  "minecraft:cyan_terracotta": "cyan_terracotta.png",
  "minecraft:purple_terracotta": "purple_terracotta.png",
  "minecraft:blue_terracotta": "blue_terracotta.png",
  "minecraft:green_terracotta": "green_terracotta.png",
  "minecraft:red_terracotta": "red_terracotta.png",
  "minecraft:black_terracotta": "black_terracotta.png"
};

const PROFESSION_ICON_MAP = {
  librarian: { file: "lectern_top.png", dir: "blocks", name: "Librarian" },
  farmer: { file: "composter_side.png", dir: "blocks", name: "Farmer" },
  fisherman: { file: "barrel_side.png", dir: "blocks", name: "Fisherman" },
  butcher: { file: "smoker_front.png", dir: "blocks", name: "Butcher" },
  armorer: { file: "blast_furnace_front.png", dir: "blocks", name: "Armorer" },
  fletcher: { file: "fletching_table_top.png", dir: "blocks", name: "Fletcher" },
  cartographer: { file: "cartography_table_top.png", dir: "blocks", name: "Cartographer" },
  cleric: { file: "brewing_stand.png", dir: "blocks", name: "Cleric" },
  toolsmith: { file: "smithing_table_top.png", dir: "blocks", name: "Toolsmith" },
  weaponsmith: { file: "grindstone_side.png", dir: "blocks", name: "Weaponsmith" },
  leatherworker: { file: "cauldron_side.png", dir: "blocks", name: "Leatherworker" },
  mason: { file: "stonecutter_top.png", dir: "blocks", name: "Mason" },
  shepherd: { file: "loom_top.png", dir: "blocks", name: "Shepherd" },
  unemployed: { file: "emerald.png", dir: "items", name: "Unemployed" },
  nitwit: { file: "glass.png", dir: "blocks", name: "Nitwit" },
  unknown: { file: "glass.png", dir: "blocks", name: "Unknown" }
};

function getItemAssetUrl(itemId) {
  if (!itemId) return null;
  const cleanId = itemId.toLowerCase().trim();
  const rawName = cleanId.replace(/^minecraft:/, "");
  const file = ITEM_FILE_MAP[cleanId] || ITEM_FILE_MAP[`minecraft:${rawName}`];
  if (file) {
    return `${ASSET_ITEMS_DIR}${file}`;
  }
  const blockFile = BLOCK_FILE_MAP[cleanId] || BLOCK_FILE_MAP[`minecraft:${rawName}`];
  if (blockFile) {
    return `${ASSET_BLOCKS_DIR}${blockFile}`;
  }
  return `${ASSET_ITEMS_DIR}${rawName}.png`;
}

function getBlockAssetUrl(blockId) {
  if (!blockId) return null;
  const cleanId = blockId.toLowerCase().trim();
  const rawName = cleanId.replace(/^minecraft:/, "");
  const file = BLOCK_FILE_MAP[cleanId] || BLOCK_FILE_MAP[`minecraft:${rawName}`];
  if (file) {
    return `${ASSET_BLOCKS_DIR}${file}`;
  }
  return `${ASSET_BLOCKS_DIR}${rawName}.png`;
}

function getProfessionAssetUrl(professionId) {
  const clean = (professionId || "unemployed").toLowerCase().replace("minecraft:", "");
  const p = PROFESSION_ICON_MAP[clean] || PROFESSION_ICON_MAP["unknown"];
  const baseDir = p.dir === "items" ? ASSET_ITEMS_DIR : ASSET_BLOCKS_DIR;
  return `${baseDir}${p.file}`;
}

function applyImageFallback(img, fallback) {
  img.addEventListener(
    "error",
    () => {
      if (img.dataset.fallbackApplied === "1") {
        return;
      }
      img.dataset.fallbackApplied = "1";
      img.src = fallback;
    },
    {
      once: true
    }
  );
}

function createItemIconElement(itemId, altText = "", customClass = "item-icon") {
  const img = document.createElement("img");
  img.className = customClass;
  img.alt = altText || itemId;
  const rawName = (itemId || "").toLowerCase().trim().replace(/^minecraft:/, "");
  const primaryUrl = getItemAssetUrl(itemId) || `${ASSET_ITEMS_DIR}${rawName}.png`;
  img.src = primaryUrl;

  const blockFallback = `${ASSET_BLOCKS_DIR}${rawName}.png`;
  const defaultFallback = `${ASSET_ITEMS_DIR}book.png`;

  img.addEventListener("error", () => {
    if (img.dataset.fallbackStage === "2") return;
    if (img.dataset.fallbackStage === "1") {
      img.dataset.fallbackStage = "2";
      img.src = defaultFallback;
      return;
    }
    img.dataset.fallbackStage = "1";
    img.src = blockFallback;
  });

  return img;
}

function createProfessionIconElement(professionId, customClass = "prof-icon", isZombie = false) {
  const img = document.createElement("img");
  img.className = customClass;
  img.alt = isZombie ? "Zombie Villager" : (professionId || "villager");
  img.src = isZombie ? `${ASSET_ITEMS_DIR}zombie_villager_spawn_egg.png` : getProfessionAssetUrl(professionId);
  applyImageFallback(img, `${ASSET_BLOCKS_DIR}lectern_top.png`);
  return img;
}
