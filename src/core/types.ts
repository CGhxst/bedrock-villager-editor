export type DimensionName = "overworld" | "nether" | "the_end" | "unknown";

export type BedrockNbtFormat = "little" | "littleVarint";

export interface NbtEncodingMetadata {
  format: BedrockNbtFormat;
  prefixHex?: string;
}

export interface Coordinates3D {
  x: number;
  y: number;
  z: number;
}

export interface DimensionCoordinates extends Coordinates3D {
  dimension: DimensionName;
}

export interface WorldMapTileRequest {
  dimensionId: 0 | 1 | 2;
  tileX: number;
  tileZ: number;
}

export interface WorldMapTile {
  dimensionId: 0 | 1 | 2;
  tileX: number;
  tileZ: number;
  originBlockX: number;
  originBlockZ: number;
  blockSize: number;
  rgbaBase64: string;
  generatedChunks: number;
  missingChunks: number;
  heightSourceCounts: {
    data3d: number;
    data2d: number;
  };
  terrainMode: "heightmap" | "biome-heightmap";
}

export interface WorldMapTileResult {
  success: boolean;
  tile?: WorldMapTile;
  restartRequired?: boolean;
  error?: string;
}

export interface EnchantmentData {
  id?: number;
  name: string;
  level: number;
  rawNbt?: any; // Preserved untouched original enchantment compound (Internal)
}

export interface TradeItem {
  id: string;
  count: number;
  damage?: number;
  displayName?: string;
  enchantments?: EnchantmentData[];
  rawTag?: any; // Preserved untouched tag compound (Internal)
}

export interface TradeRecipe {
  id?: string;
  tier: number;
  buyA: TradeItem;
  buyB: TradeItem | null;
  sell: TradeItem;
  maxUses: number;
  uses: number;
  traderExp: number;
  rewardExp: boolean;
  priceMultiplierA: number;
  priceMultiplierB?: number;
  demand?: number;
  buyCountA?: number;
  buyCountB?: number;
  rawRecipe?: any; // Preserved original recipe NBT for lossless round-trip (Internal)
}

export interface TradeItemView {
  id: string;
  count: number;
  damage?: number;
  displayName?: string;
  enchantments?: Array<{
    id?: number;
    name: string;
    level: number;
  }>;
}

export interface TradeRecipeView {
  id: string;
  tier: number;
  buyA: TradeItemView;
  buyB: TradeItemView | null;
  sell: TradeItemView;
  maxUses: number;
  uses: number;
  traderExp: number;
  rewardExp: boolean;
  priceMultiplierA: number;
  priceMultiplierB?: number;
  demand?: number;
}

export interface WorkstationLink {
  type: string;
  dimension: DimensionName;
  position: Coordinates3D;
  blockVerified?: boolean;
}

export interface BedLink {
  type: string;
  dimension: DimensionName;
  position: Coordinates3D;
}

export type ProfessionSource =
  | "root:Profession"
  | "root:profession"
  | "root:ProfessionName"
  | "root:professionName"
  | "root:Career"
  | "root:career"
  | "root:PreferredProfession"
  | "root:preferredProfession"
  | "offers:Profession"
  | "offers:profession"
  | "offers:Career"
  | "offers:career"
  | "definitions"
  | "Definitions"
  | "WorkstationBlock"
  | "TradesInferred"
  | "default";

export type CareerLevelSource =
  | "root:CareerLevel"
  | "root:careerLevel"
  | "root:TradeTier"
  | "root:tradeTier"
  | "root:CareerTier"
  | "root:careerTier"
  | "root:Tier"
  | "root:tier"
  | "offers:Tier"
  | "offers:tier"
  | "offers:CareerLevel"
  | "offers:careerLevel"
  | "offers:TradeTier"
  | "offers:tradeTier"
  | "offers:CareerTier"
  | "offers:careerTier"
  | "offers:MaxTier"
  | "offers:maxTier"
  | "definitions"
  | "default";

export type ActorLinkStoragePath =
  | "DwellerComponent.DwellerPositions:workstation"
  | "DwellerComponent.DwellerPositions:bed";

export interface LinkStorageSource {
  source: "actor_nbt" | "village_poi";
  actorPath?: ActorLinkStoragePath;
  poiKeyHex?: string;
  poiOriginalValueHash?: string;
  poiEncoding?: NbtEncodingMetadata;
  villagerUniqueIdKey?: string;
  poiRole?: "workstation" | "bed";
}

export interface VillagerLinkStorageMetadata {
  workstation?: LinkStorageSource;
  bed?: LinkStorageSource;
}

export interface DbMutationJournalEntry {
  kind: "actor" | "digp";
  key: Buffer;
  originalExisted: boolean;
  originalValue: Buffer | null;
  intendedValue: Buffer | null;
  writeAppliedOrMayHaveApplied: boolean;
  description: string;
}

export interface ParsedVillager {
  sessionVillagerId: string; // Opaque internal session ID
  dbKeyHex: string; // Immutable LevelDB actor key (Internal)
  originalDbValueHash: string; // SHA-256 hash of original LevelDB bytes (Internal)
  nbtEncoding: NbtEncodingMetadata; // Format & prefix preservation metadata (Internal)
  customNameSources?: Array<"CustomName" | "NameTag">; // Preserved source tags (Internal)
  identifier: string; // Original entity identifier e.g. "minecraft:villager_v2"
  customName: string | null;
  dimension: DimensionName;
  dimensionId: number;
  position: Coordinates3D;
  rotation?: { yaw: number; pitch: number };
  profession: string;
  professionDisplayName: string;
  professionKnown: boolean;
  professionSource?: ProfessionSource;
  careerLevel: number;
  careerLevelName: string;
  careerLevelSource?: CareerLevelSource;
  experience: number;
  isCured: boolean;
  isZombie: boolean;
  isConverting?: boolean;
  conversionTime?: number;
  trades: TradeRecipe[];
  linkedWorkstation: WorkstationLink | null;
  linkedBed: BedLink | null;
  workstationLinkSource?: "actor" | "village_poi" | "unknown";
  bedLinkSource?: "actor" | "village_poi" | "unknown";
  linkStorageMetadata?: VillagerLinkStorageMetadata;
  definitions?: string[];
  rawNbt: any; // Immutable clone of original NBT (Internal)
  isDirty?: boolean;
}

export interface VillagerViewModel {
  sessionVillagerId: string;
  identifier: string;
  customName: string | null;
  dimension: DimensionName;
  dimensionId: number;
  position: Coordinates3D;
  rotation?: { yaw: number; pitch: number };
  profession: string;
  professionDisplayName: string;
  professionKnown: boolean;
  professionSource?: string;
  careerLevel: number;
  careerLevelName: string;
  experience: number;
  isCured: boolean;
  isZombie: boolean;
  isConverting?: boolean;
  conversionTime?: number;
  trades: TradeRecipeView[];
  linkedWorkstation: WorkstationLink | null;
  linkedBed: BedLink | null;
  workstationLinkSource?: "actor" | "village_poi" | "unknown";
  bedLinkSource?: "actor" | "village_poi" | "unknown";
  isDirty?: boolean;
}

export interface VillagerDebugInfo {
  sessionVillagerId: string;
  actorKeySuffix: string;
  identifier: string;
  professionSource?: string;
  definitions: string[];
  originalDbValueHash: string;
  nbtEncoding: NbtEncodingMetadata;
  rawNbtJson: string;
}

export interface WorldOpenSnapshot {
  worldName: string;
  villagerCount: number;
  summary: WorldVillagerDump["summary"];
  villagers: VillagerViewModel[];
}

export interface WorldChoice {
  handle: string;
  folderName: string;
  name: string;
  lastPlayed: number;
  iconDataUrl?: string;
  isLocked?: boolean;
}

export interface TradeItemInput {
  id: string;
  count: number;
  damage?: number;
}

export interface TradeSettingsPatch {
  tier?: number;
  maxUses?: number;
  uses?: number;
  traderExp?: number;
  rewardExp?: boolean;
  priceMultiplierA?: number;
  priceMultiplierB?: number | null;
  demand?: number | null;
}

export type EditableVillagerPatch = Partial<{
  customName: string | null;
  profession: string;
  careerLevel: number;
  experience: number;
  position: Coordinates3D;
}>;

export type SessionCommandRequest =
  | {
      kind: "PATCH_VILLAGER";
      description: string;
      villagerId: string;
      patch: EditableVillagerPatch;
    }
  | {
      kind: "TRADE_ADD";
      description: string;
      villagerId: string;
    }
  | {
      kind: "TRADE_DELETE";
      description: string;
      villagerId: string;
      tradeId: string;
    }
  | {
      kind: "TRADE_RESTOCK";
      description: string;
      villagerId: string;
      tradeId: string;
    }
  | {
      kind: "TRADE_SET_ITEM";
      description: string;
      villagerId: string;
      tradeId: string;
      slot: "buyA" | "buyB" | "sell";
      item: TradeItemInput | null;
    }
  | {
      kind: "TRADE_SET_ITEM_COUNT";
      description: string;
      villagerId: string;
      tradeId: string;
      slot: "buyA" | "buyB" | "sell";
      count: number;
    }
  | {
      kind: "TRADE_SET_SETTINGS";
      description: string;
      villagerId: string;
      tradeId: string;
      patch: TradeSettingsPatch;
    }
  | {
      kind: "TRADE_ADD_ENCHANTMENT";
      description: string;
      villagerId: string;
      tradeId: string;
      slot: "sell";
      enchantmentId: number;
      level: number;
    }
  | {
      kind: "TRADE_REMOVE_ENCHANTMENT";
      description: string;
      villagerId: string;
      tradeId: string;
      slot: "sell";
      enchantmentIndex: number;
    }
  | {
      kind: "TRADE_SET_ENCHANTMENT_LEVEL";
      description: string;
      villagerId: string;
      tradeId: string;
      slot: "sell";
      enchantmentIndex: number;
      level: number;
    }
  | {
      kind: "BULK_SET_COST_QUANTITY_ONE";
      description: string;
      villagerIds: string[];
    }
  | {
      kind: "BULK_RESTOCK";
      description: string;
      villagerIds: string[];
    }
  | {
      kind: "BULK_SET_MAX_USES";
      description: string;
      villagerIds: string[];
      maxUses: number;
    };

export interface TrustedVillagerImportUpdate {
  villagerId: string;
  customName?: string | null;
  profession?: string;
  careerLevel?: number;
  experience?: number;
  position?: Coordinates3D;
  trades?: TradeRecipe[];
}

export interface SessionStateSnapshot {
  dirtyCount: number;
  canUndo: boolean;
  canRedo: boolean;
  worldName: string | null;
  busyOperation: string | null;
  restartRequired: boolean;
  restartMessage?: string;
}

export interface WorldOpenResult {
  success: boolean;
  snapshot?: WorldOpenSnapshot;
  canceled?: boolean;
  restartRequired?: boolean;
  error?: string;
}

export interface SessionCommandResult {
  success: boolean;
  canUndo: boolean;
  canRedo: boolean;
  description?: string;
  error?: string;
}

export interface DirtyVillagerWrite {
  current: ParsedVillager;
  baseline: ParsedVillager;
}

export interface WorldSummary {
  folderName: string;
  name: string;
  path: string;
  lastPlayed: number;
  iconPath?: string;
  isLocked?: boolean;
}

export interface WorldVillagerDump {
  worldName: string;
  worldPath: string;
  exportedAt: string;
  worldFingerprint?: string;
  villagerCount: number;
  summary: {
    byProfession: Record<string, number>;
    withTrades: number;
    withoutWorkstation: number;
    zombies: number;
    cured: number;
  };
  villagers: ParsedVillager[];
}

export interface SaveDiffItem {
  villagerId: string;
  villagerName: string;
  profession: string;
  changes: string[];
}

export interface SavePreview {
  modifiedVillagersCount: number;
  totalVillagersCount: number;
  diffs: SaveDiffItem[];
  backupDestinationLabel: string;
  hasConflicts: boolean;
  conflictCheckError?: string;
  restartRequired?: boolean;
}

export interface SaveResult {
  success: boolean;
  modifiedCount?: number;
  verifiedCount?: number;
  backupCreated?: boolean;
  backupId?: string;
  reloadRequired?: boolean;
  restartRequired?: boolean;
  warning?: string;
  error?: string;
}

export interface BackupSummary {
  id: string;
  fileName: string;
  createdAt: number;
  sizeBytes: number;
  integrityStatus: "not_checked";
}
