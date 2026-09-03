import { clonePreservingBinary } from "./clone";
import { getEnchantmentById } from "./enchantments";
import {
  CAREER_TIER_NAMES,
  getProfessionById,
  getProfessionDisplayName,
  inferProfessionFromTrades,
  normalizeProfession,
  normalizeProfessionId,
  WORKSTATION_BLOCK_TO_PROFESSION
} from "./professions";
import {
  BedLink,
  CareerLevelSource,
  Coordinates3D,
  DimensionName,
  EnchantmentData,
  LinkStorageSource,
  NbtEncodingMetadata,
  ParsedVillager,
  ProfessionSource,
  TradeItem,
  TradeRecipe,
  VillagerLinkStorageMetadata,
  WorkstationLink
} from "./types";

export function parseDimension(id: number): DimensionName {
  switch (id) {
    case 0:
      return "overworld";
    case 1:
      return "nether";
    case 2:
      return "the_end";
    default:
      return "unknown";
  }
}

export function normalizeDimensionName(dimension: unknown): DimensionName {
  if (typeof dimension === "number") {
    return parseDimension(dimension);
  }
  const str = String(dimension || "").toLowerCase().trim();
  if (str === "overworld" || str === "0") return "overworld";
  if (str === "nether" || str === "1") return "nether";
  if (str === "the_end" || str === "theend" || str === "end" || str === "2") return "the_end";
  return "unknown";
}

export const PROFESSION_DEFINITION_RE = /profession\s*[=:]\s*([a-z0-9_:.-]+)/i;

export function extractCoordinates(tag: any): Coordinates3D | null {
  if (!tag) return null;
  const val = tag.value !== undefined ? tag.value : tag;
  if (!val) return null;

  // 1. Plain array of numbers or [{value: number}, ...]
  if (Array.isArray(val)) {
    if (val.length >= 3) {
      const x = Number(val[0]?.value !== undefined ? val[0].value : val[0]);
      const y = Number(val[1]?.value !== undefined ? val[1].value : val[1]);
      const z = Number(val[2]?.value !== undefined ? val[2].value : val[2]);
      if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
        return { x: Math.floor(x), y: Math.floor(y), z: Math.floor(z) };
      }
    }
  }

  // 2. Nested .value array (e.g. NBT IntArray / List tag wrapper)
  if (val.value && Array.isArray(val.value) && val.value.length >= 3) {
    const x = Number(val.value[0]?.value !== undefined ? val.value[0].value : val.value[0]);
    const y = Number(val.value[1]?.value !== undefined ? val.value[1].value : val.value[1]);
    const z = Number(val.value[2]?.value !== undefined ? val.value[2].value : val.value[2]);
    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
      return { x: Math.floor(x), y: Math.floor(y), z: Math.floor(z) };
    }
  }

  // 3. Compound object with x, y, z properties
  const xCandidate = val.x ?? val.X ?? val.block_x ?? val.blockX;
  const yCandidate = val.y ?? val.Y ?? val.block_y ?? val.blockY;
  const zCandidate = val.z ?? val.Z ?? val.block_z ?? val.blockZ;

  if (xCandidate !== undefined && yCandidate !== undefined && zCandidate !== undefined) {
    const x = Number(xCandidate?.value !== undefined ? xCandidate.value : xCandidate);
    const y = Number(yCandidate?.value !== undefined ? yCandidate.value : yCandidate);
    const z = Number(zCandidate?.value !== undefined ? zCandidate.value : zCandidate);
    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
      return { x: Math.floor(x), y: Math.floor(y), z: Math.floor(z) };
    }
  }

  return null;
}

export function getDwellerRole(value: any): string {
  if (!value) return "";
  const unwrapped = value.value !== undefined ? value.value : value;

  const roleRaw =
    unwrapped?.role?.value ??
    unwrapped?.role ??
    unwrapped?.Role?.value ??
    unwrapped?.Role ??
    unwrapped?.type?.value ??
    unwrapped?.type ??
    unwrapped?.Type?.value ??
    unwrapped?.Type ??
    unwrapped?.role_name?.value ??
    unwrapped?.role_name ??
    unwrapped?.dweller_role?.value ??
    unwrapped?.dweller_role ??
    "";

  if (typeof roleRaw === "number") {
    if (roleRaw === 0) return "bed";
    if (roleRaw === 1) return "jobsite";
    if (roleRaw === 2) return "meeting";
  }

  const str = String(roleRaw).toLowerCase().replace(/[^a-z0-9]/g, "");
  if (str === "0" || str === "bed" || str === "home" || str === "b" || str.includes("bed") || str.includes("home")) {
    return "bed";
  }
  if (str === "1" || str === "jobsite" || str === "job" || str === "workstation" || str === "w" || str.includes("job") || str.includes("workstation")) {
    return "jobsite";
  }
  if (str === "2" || str === "meeting" || str === "bell" || str.includes("meeting") || str.includes("bell")) {
    return "meeting";
  }

  return str;
}

export interface VillagePoiData {
  workstation?: WorkstationLink;
  bed?: BedLink;
  linkStorageMetadata?: VillagerLinkStorageMetadata;
}

export function getUniqueIdKey(tag: any): string {
  if (!tag) return "";
  const val = tag.value !== undefined ? tag.value : tag;
  if (Array.isArray(val) && val.length >= 2) {
    return `${val[0]}:${val[1]}`;
  }
  if (typeof val === "bigint" || typeof val === "number" || typeof val === "string") {
    return String(val);
  }
  return "";
}

export function parseVillagerNbt(
  rawNbt: any,
  dbKeyHex: string,
  index = 0,
  storageMetadata?: {
    originalDbValueHash: string;
    nbtEncoding: NbtEncodingMetadata;
  },
  villagePoi?: VillagePoiData
): ParsedVillager | null {
  const root = rawNbt?.value || rawNbt;
  if (!root || typeof root !== "object") return null;

  const identifier = String(root.identifier?.value || root.identifier || "minecraft:villager_v2");

  // Determine custom name & preserved sources
  const customNameSources: Array<"CustomName" | "NameTag"> = [];
  if (root.CustomName !== undefined) {
    customNameSources.push("CustomName");
  }
  if (root.NameTag !== undefined) {
    customNameSources.push("NameTag");
  }

  let customName: string | null = null;
  if (root.CustomName?.value) {
    customName = String(root.CustomName.value);
  } else if (root.NameTag?.value) {
    customName = String(root.NameTag.value);
  }

  const dimensionId = typeof root.DimensionId?.value === "number" ? root.DimensionId.value : 0;
  const dimension = parseDimension(dimensionId);

  // Parse Position
  let position: Coordinates3D = { x: 0, y: 0, z: 0 };
  const posTag = root.Pos?.value;
  if (posTag?.value && Array.isArray(posTag.value) && posTag.value.length >= 3) {
    position = {
      x: Number(posTag.value[0]),
      y: Number(posTag.value[1]),
      z: Number(posTag.value[2])
    };
  } else if (Array.isArray(posTag) && posTag.length >= 3) {
    position = {
      x: Number(posTag[0]),
      y: Number(posTag[1]),
      z: Number(posTag[2])
    };
  }

  // Parse Definitions
  const defsList =
    root.Definitions?.value?.value ||
    root.Definitions?.value ||
    root.definitions?.value?.value ||
    root.definitions?.value ||
    root.Definitions ||
    root.definitions ||
    [];
  const definitions: string[] | undefined = Array.isArray(defsList)
    ? defsList.map((d: any) => String(d?.value ?? d))
    : undefined;

  // Initial Profession Resolution
  let rawProfessionValue: any = null;
  let professionSource: ProfessionSource | undefined;

  // 1. Check definitions for explicit profession strings (e.g. +minecraft:librarian, +minecraft:farmer, +minecraft:unemployed)
  if (Array.isArray(definitions)) {
    let foundUnemployed = false;
    for (const d of definitions) {
      const norm = normalizeProfession(d);
      if (norm) {
        if (norm !== "unemployed") {
          rawProfessionValue = norm;
          professionSource = root.Definitions !== undefined ? "Definitions" : "definitions";
          break;
        } else {
          foundUnemployed = true;
        }
      }
    }
    if (rawProfessionValue === null && foundUnemployed) {
      rawProfessionValue = "unemployed";
      professionSource = root.Definitions !== undefined ? "Definitions" : "definitions";
    }
  }

  // 2. Check root-level tags:
  if (rawProfessionValue === null) {
    const rootCandidates: Array<{ key: ProfessionSource; val: any }> = [
      { key: "root:Profession", val: root.Profession },
      { key: "root:profession", val: root.profession },
      { key: "root:ProfessionName", val: root.ProfessionName },
      { key: "root:professionName", val: root.professionName },
      { key: "root:Career", val: root.Career },
      { key: "root:career", val: root.career },
      { key: "root:PreferredProfession", val: root.PreferredProfession },
      { key: "root:preferredProfession", val: root.preferredProfession }
    ];
    for (const cand of rootCandidates) {
      if (cand.val !== undefined) {
        const unwrapped = cand.val?.value !== undefined ? cand.val.value : cand.val;
        rawProfessionValue = unwrapped;
        professionSource = cand.key;
        break;
      }
    }
  }

  const offers = root.Offers?.value || root.Offers;

  // 3. Check Offers-level tags:
  if (rawProfessionValue === null && offers) {
    const offerCandidates: Array<{ key: ProfessionSource; val: any }> = [
      { key: "offers:Profession", val: offers.Profession },
      { key: "offers:profession", val: offers.profession },
      { key: "offers:Career", val: offers.Career },
      { key: "offers:career", val: offers.career }
    ];
    for (const cand of offerCandidates) {
      if (cand.val !== undefined) {
        const unwrapped = cand.val?.value !== undefined ? cand.val.value : cand.val;
        rawProfessionValue = unwrapped;
        professionSource = cand.key;
        break;
      }
    }
  }

  const experience =
    typeof root.TradeExperience?.value === "number"
      ? root.TradeExperience.value
      : typeof root.TradeExperience === "number"
      ? root.TradeExperience
      : 0;

  const isZombie = identifier.includes("zombie");
  const curedRaw =
    root.IsCured?.value ??
    root.IsCured ??
    false;

  const isCured = Boolean(curedRaw);

  const conversionRaw =
    root.ConversionTime?.value ??
    root.ConversionTime;

  const conversionTime =
    typeof conversionRaw === "number"
      ? conversionRaw
      : undefined;

  const isConverting = Boolean(conversionTime);

  // Parse Trades
  const trades: TradeRecipe[] = [];
  const recipes = offers?.Recipes?.value?.value || offers?.Recipes?.value || offers?.Recipes || [];

  if (Array.isArray(recipes)) {
    recipes.forEach((rec: any, rIndex: number) => {
      const recVal = rec.value || rec;
      if (!recVal) return;

      const parseTradeItem = (itemTag: any): TradeItem | null => {
        if (!itemTag) return null;
        const itemVal = itemTag.value || itemTag;
        if (!itemVal) return null;

        const id = String(itemVal.Name?.value || itemVal.Name || itemVal.id?.value || itemVal.id || "minecraft:air");
        const count = typeof itemVal.Count?.value === "number" ? itemVal.Count.value : typeof itemVal.Count === "number" ? itemVal.Count : 1;
        const damage = typeof itemVal.Damage?.value === "number" ? itemVal.Damage.value : typeof itemVal.Damage === "number" ? itemVal.Damage : undefined;

        const enchs: EnchantmentData[] = [];
        const tag = itemVal.tag?.value || itemVal.tag;
        const enchList = tag?.ench?.value?.value || tag?.ench?.value || tag?.ench || [];

        if (Array.isArray(enchList)) {
          enchList.forEach((e: any) => {
            const eVal = e.value || e;
            const rawEnchantId = eVal.id?.value ?? eVal.id;
            const enchantmentId =
              typeof rawEnchantId === "number" && Number.isFinite(rawEnchantId)
                ? rawEnchantId
                : undefined;

            const levelValue = eVal.lvl?.value ?? eVal.lvl;
            const level =
              typeof levelValue === "number" && Number.isFinite(levelValue)
                ? levelValue
                : 1;

            const definition =
              typeof enchantmentId === "number"
                ? getEnchantmentById(enchantmentId)
                : null;

            enchs.push({
              id: enchantmentId,
              name: definition
                ? definition.name
                : typeof enchantmentId === "number"
                ? `unknown_${enchantmentId}`
                : "unknown_unidentified",
              level,
              rawNbt: clonePreservingBinary(e)
            });
          });
        }

        return {
          id,
          count,
          damage,
          enchantments: enchs.length > 0 ? enchs : undefined,
          rawTag: itemVal.tag ? clonePreservingBinary(itemVal.tag) : undefined
        };
      };

      const buyA = parseTradeItem(recVal.buyA);
      const buyB = parseTradeItem(recVal.buyB);
      const sell = parseTradeItem(recVal.sell);

      if (!buyA || !sell) return;

      // Handle recipe-level buyCountA / buyCountB if present
      const recipeBuyCountA = recVal.buyCountA?.value ?? recVal.buyCountA;
      if (typeof recipeBuyCountA === "number") {
        buyA.count = recipeBuyCountA;
      }

      const recipeBuyCountB = recVal.buyCountB?.value ?? recVal.buyCountB;
      if (buyB && typeof recipeBuyCountB === "number") {
        buyB.count = recipeBuyCountB;
      }

      const maxUses = typeof recVal.maxUses?.value === "number" ? recVal.maxUses.value : typeof recVal.maxUses === "number" ? recVal.maxUses : 16;
      const uses = typeof recVal.uses?.value === "number" ? recVal.uses.value : typeof recVal.uses === "number" ? recVal.uses : 0;
      const tier = typeof recVal.tier?.value === "number" ? recVal.tier.value : typeof recVal.tier === "number" ? recVal.tier : 1;
      const traderExp = typeof recVal.traderExp?.value === "number" ? recVal.traderExp.value : typeof recVal.traderExp === "number" ? recVal.traderExp : 1;
      const rewardExp = Boolean(recVal.rewardExp?.value ?? recVal.rewardExp ?? true);
      const priceMultiplierA = typeof recVal.priceMultiplierA?.value === "number" ? recVal.priceMultiplierA.value : typeof recVal.priceMultiplierA === "number" ? recVal.priceMultiplierA : 0.05;
      const priceMultiplierB = typeof recVal.priceMultiplierB?.value === "number" ? recVal.priceMultiplierB.value : typeof recVal.priceMultiplierB === "number" ? recVal.priceMultiplierB : undefined;
      const demand = typeof recVal.demand?.value === "number" ? recVal.demand.value : typeof recVal.demand === "number" ? recVal.demand : undefined;

      trades.push({
        id: `trade_${rIndex}_${idOrPlaceholder(buyA.id)}_${idOrPlaceholder(sell.id)}`,
        tier,
        buyA,
        buyB,
        sell,
        maxUses,
        uses,
        traderExp,
        rewardExp,
        priceMultiplierA,
        priceMultiplierB,
        demand,
        buyCountA: typeof recipeBuyCountA === "number" ? recipeBuyCountA : undefined,
        buyCountB: typeof recipeBuyCountB === "number" ? recipeBuyCountB : undefined,
        rawRecipe: clonePreservingBinary(rec)
      });
    });
  }

  // Determine Career Level (Tier)
  let explicitCareerLevel: number | undefined;
  let careerLevelSource: CareerLevelSource | undefined;

  // 1. Check root-level tags:
  const rootCareerCandidates: Array<{ key: CareerLevelSource; val: any }> = [
    { key: "root:CareerLevel", val: root.CareerLevel },
    { key: "root:careerLevel", val: root.careerLevel },
    { key: "root:TradeTier", val: root.TradeTier },
    { key: "root:tradeTier", val: root.tradeTier },
    { key: "root:CareerTier", val: root.CareerTier },
    { key: "root:careerTier", val: root.careerTier },
    { key: "root:Tier", val: root.Tier },
    { key: "root:tier", val: root.tier }
  ];
  for (const cand of rootCareerCandidates) {
    const val = cand.val?.value ?? cand.val;
    if (typeof val === "number" && Number.isFinite(val) && val >= 1) {
      explicitCareerLevel = Math.floor(val);
      careerLevelSource = cand.key;
      break;
    }
  }

  // 2. Check Offers-level tags:
  if (explicitCareerLevel === undefined && offers) {
    const offerCareerCandidates: Array<{ key: CareerLevelSource; val: any }> = [
      { key: "offers:Tier", val: offers.Tier },
      { key: "offers:tier", val: offers.tier },
      { key: "offers:CareerLevel", val: offers.CareerLevel },
      { key: "offers:careerLevel", val: offers.careerLevel },
      { key: "offers:TradeTier", val: offers.TradeTier },
      { key: "offers:tradeTier", val: offers.tradeTier },
      { key: "offers:CareerTier", val: offers.CareerTier },
      { key: "offers:careerTier", val: offers.careerTier },
      { key: "offers:MaxTier", val: offers.MaxTier },
      { key: "offers:maxTier", val: offers.maxTier }
    ];
    for (const cand of offerCareerCandidates) {
      const val = cand.val?.value ?? cand.val;
      if (typeof val === "number" && Number.isFinite(val) && val >= 1) {
        explicitCareerLevel = Math.floor(val);
        careerLevelSource = cand.key;
        break;
      }
    }
  }

  // 3. Check Definitions tags (e.g. tier_1..5, level=1..5, novice..master):
  if (explicitCareerLevel === undefined && Array.isArray(definitions)) {
    for (const def of definitions) {
      const lower = String(def).toLowerCase();
      const numMatch = lower.match(/(?:level|tier)[=_:]\s*(\d+)/i) || lower.match(/tier_(\d+)/i);
      if (numMatch && numMatch[1]) {
        const parsedTier = parseInt(numMatch[1], 10);
        if (parsedTier >= 1 && parsedTier <= 5) {
          explicitCareerLevel = parsedTier;
          careerLevelSource = "definitions";
          break;
        }
      }
      if (lower.includes("tier_5") || lower.includes("master")) {
        explicitCareerLevel = 5;
        careerLevelSource = "definitions";
        break;
      }
      if (lower.includes("tier_4") || lower.includes("expert")) {
        explicitCareerLevel = 4;
        careerLevelSource = "definitions";
        break;
      }
      if (lower.includes("tier_3") || lower.includes("journeyman")) {
        explicitCareerLevel = 3;
        careerLevelSource = "definitions";
        break;
      }
      if (lower.includes("tier_2") || lower.includes("apprentice")) {
        explicitCareerLevel = 2;
        careerLevelSource = "definitions";
        break;
      }
      if (lower.includes("tier_1") || lower.includes("novice")) {
        explicitCareerLevel = 1;
        careerLevelSource = "definitions";
        break;
      }
    }
  }

  if (explicitCareerLevel === undefined) {
    careerLevelSource = "default";
  }

  // 4. Derive from maximum recipe tier among trades:
  const maxRecipeTier = trades.reduce((max, t) => Math.max(max, t.tier || 1), 1);

  const careerLevel = Math.min(5, Math.max(1, explicitCareerLevel ?? maxRecipeTier));
  const careerLevelName = CAREER_TIER_NAMES[careerLevel] || `Tier ${careerLevel}`;

  // Parse DwellerComponent
  let linkedWorkstation: WorkstationLink | null = null;
  let linkedBed: BedLink | null = null;
  let linkStorageMetadata: VillagerLinkStorageMetadata | undefined;

  const dweller =
    root.DwellerComponent?.value ||
    root.DwellerComponent ||
    root.dweller_component?.value ||
    root.dweller_component ||
    root.Dweller?.value ||
    root.Dweller ||
    root.dweller?.value ||
    root.dweller;

  let dwellerPositions: any[] = [];
  if (dweller) {
    const listCandidates = [
      dweller.DwellerPositions,
      dweller.dweller_positions,
      dweller.DwellerRolePositions,
      dweller.dweller_role_positions,
      dweller.DwellerRoles,
      dweller.dweller_roles,
      dweller.Positions,
      dweller.positions,
      dweller.DwellerList,
      dweller.VillagePositions
    ];
    for (const cand of listCandidates) {
      if (cand) {
        const unwrapped = cand.value?.value || cand.value || cand;
        if (Array.isArray(unwrapped)) {
          dwellerPositions = unwrapped;
          break;
        }
      }
    }
  }

  for (const posEntry of dwellerPositions) {
    const pVal = posEntry?.value !== undefined ? posEntry.value : posEntry;
    if (!pVal) continue;

    const role = getDwellerRole(pVal);

    const coords =
      extractCoordinates(pVal.block_pos) ||
      extractCoordinates(pVal.blockPos) ||
      extractCoordinates(pVal.BlockPos) ||
      extractCoordinates(pVal.pos) ||
      extractCoordinates(pVal.Pos) ||
      extractCoordinates(pVal.coord) ||
      extractCoordinates(pVal.position) ||
      extractCoordinates(pVal.Position) ||
      extractCoordinates(pVal);

    if (!coords) continue;

    if (role === "jobsite") {
      linkedWorkstation = {
        type: "minecraft:job_site",
        dimension,
        position: coords,
        blockVerified: false
      };
      if (!linkStorageMetadata) linkStorageMetadata = {};
      linkStorageMetadata.workstation = {
        source: "actor_nbt",
        actorPath: "DwellerComponent.DwellerPositions:workstation"
      };
    } else if (role === "bed") {
      linkedBed = {
        type: "minecraft:bed",
        dimension,
        position: coords
      };
      if (!linkStorageMetadata) linkStorageMetadata = {};
      linkStorageMetadata.bed = {
        source: "actor_nbt",
        actorPath: "DwellerComponent.DwellerPositions:bed"
      };
    }
  }

  // Fallback: Check direct tags on dweller or root
  if (!linkedWorkstation) {
    const wsCoords =
      extractCoordinates(dweller?.JobSite) ||
      extractCoordinates(dweller?.job_site) ||
      extractCoordinates(dweller?.Workstation) ||
      extractCoordinates(dweller?.workstation) ||
      extractCoordinates(root.JobSite) ||
      extractCoordinates(root.job_site) ||
      extractCoordinates(root.Workstation) ||
      extractCoordinates(root.workstation);
    if (wsCoords) {
      linkedWorkstation = {
        type: "minecraft:job_site",
        dimension,
        position: wsCoords,
        blockVerified: false
      };
      if (!linkStorageMetadata) linkStorageMetadata = {};
      linkStorageMetadata.workstation = { source: "actor_nbt" };
    }
  }

  if (!linkedBed) {
    const bedCoords =
      extractCoordinates(dweller?.Bed) ||
      extractCoordinates(dweller?.bed) ||
      extractCoordinates(dweller?.Home) ||
      extractCoordinates(dweller?.home) ||
      extractCoordinates(root.Bed) ||
      extractCoordinates(root.bed) ||
      extractCoordinates(root.Home) ||
      extractCoordinates(root.home);
    if (bedCoords) {
      linkedBed = {
        type: "minecraft:bed",
        dimension,
        position: bedCoords
      };
      if (!linkStorageMetadata) linkStorageMetadata = {};
      linkStorageMetadata.bed = { source: "actor_nbt" };
    }
  }

  // Fallback: Village POI table data from LevelDB
  if (!linkedWorkstation && villagePoi?.workstation) {
    linkedWorkstation = clonePreservingBinary(villagePoi.workstation);
    if (!linkStorageMetadata) linkStorageMetadata = {};
    if (villagePoi.linkStorageMetadata?.workstation) {
      linkStorageMetadata.workstation = clonePreservingBinary(villagePoi.linkStorageMetadata.workstation);
    }
  }
  if (!linkedBed && villagePoi?.bed) {
    linkedBed = clonePreservingBinary(villagePoi.bed);
    if (!linkStorageMetadata) linkStorageMetadata = {};
    if (villagePoi.linkStorageMetadata?.bed) {
      linkStorageMetadata.bed = clonePreservingBinary(villagePoi.linkStorageMetadata.bed);
    }
  }

  let workstationLinkSource: "actor" | "village_poi" | "unknown" | undefined;
  if (linkedWorkstation !== null) {
    const wsMeta = linkStorageMetadata?.workstation;
    if (wsMeta?.source === "actor_nbt") {
      workstationLinkSource = "actor";
    } else if (wsMeta?.source === "village_poi") {
      workstationLinkSource = "village_poi";
    } else {
      workstationLinkSource = "unknown";
    }
  }

  let bedLinkSource: "actor" | "village_poi" | "unknown" | undefined;
  if (linkedBed !== null) {
    const bedMeta = linkStorageMetadata?.bed;
    if (bedMeta?.source === "actor_nbt") {
      bedLinkSource = "actor";
    } else if (bedMeta?.source === "village_poi") {
      bedLinkSource = "village_poi";
    } else {
      bedLinkSource = "unknown";
    }
  }

  // If profession is completely unresolved, check workstation block and trades
  if (rawProfessionValue === null || rawProfessionValue === "unknown") {
    // 1. Check linked workstation block if available
    if (linkedWorkstation?.type && linkedWorkstation.type !== "minecraft:job_site" && linkedWorkstation.type !== "none") {
      const wsProf = WORKSTATION_BLOCK_TO_PROFESSION[linkedWorkstation.type] ||
                     WORKSTATION_BLOCK_TO_PROFESSION[linkedWorkstation.type.replace(/^minecraft:/, "")];
      if (wsProf) {
        rawProfessionValue = wsProf;
        professionSource = "WorkstationBlock";
      }
    }

    // 2. If still unresolved and has trades, infer from trade offers
    if ((rawProfessionValue === null || rawProfessionValue === "unknown") && trades.length > 0) {
      const inferred = inferProfessionFromTrades(trades);
      if (inferred) {
        rawProfessionValue = inferred;
        professionSource = "TradesInferred";
      }
    }
  }

  if (rawProfessionValue === null) {
    if (identifier.includes("villager")) {
      rawProfessionValue = "unemployed";
      professionSource = "default";
    }
  }

  const parsedProf = normalizeProfessionId(rawProfessionValue);
  const profession = parsedProf.id;
  const professionDisplayName = parsedProf.displayName;
  const professionKnown = parsedProf.known;

  if (linkedWorkstation) {
    const profDef = getProfessionById(profession);
    linkedWorkstation.type =
      profDef?.workstationBlock && profDef.workstationBlock !== "none"
        ? profDef.workstationBlock
        : "minecraft:job_site";
  }

  return {
    sessionVillagerId: `villager_${index}_${dbKeyHex.slice(-8)}`,
    dbKeyHex,
    originalDbValueHash: storageMetadata?.originalDbValueHash || "",
    nbtEncoding: storageMetadata?.nbtEncoding || { format: "little" },
    customNameSources: customNameSources.length > 0 ? customNameSources : undefined,
    identifier,
    customName,
    dimension,
    dimensionId,
    position,
    profession,
    professionDisplayName,
    professionKnown,
    professionSource,
    careerLevel,
    careerLevelName,
    careerLevelSource,
    experience,
    isCured,
    isZombie,
    isConverting,
    conversionTime,
    trades,
    linkedWorkstation,
    linkedBed,
    workstationLinkSource,
    bedLinkSource,
    linkStorageMetadata,
    definitions,
    rawNbt: clonePreservingBinary(rawNbt)
  };
}

function idOrPlaceholder(id: string): string {
  return id.replace("minecraft:", "").replace(/[^a-zA-Z0-9]/g, "_");
}
