import { LevelDB } from "@8crafter/leveldb-zlib";
import archiver from "archiver";
import { createHash, randomUUID } from "node:crypto";
import extract from "extract-zip";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { atomicReplaceWorldDirectory, AtomicFs, defaultAtomicFs } from "./atomicWorldReplace";
import { cleanupPreviousRestoreDirectory, RestoreCleanupFs } from "./restoreCleanup";
import { isRestartRequiredStorageError, RestartRequiredStorageError } from "./storageFatalError";
import { deepEqualSafe } from "./clone";
import {
  encodeBedrockNbtPreservingFormat,
  parseBedrockNbt,
  writeBedrockNbt
} from "./nbtHelper";
import { assertVillagerSemanticMatch } from "./semanticVerify";
import {
  BackupSummary,
  BedLink,
  DirtyVillagerWrite,
  LinkStorageSource,
  ParsedVillager,
  VillagerLinkStorageMetadata,
  WorkstationLink,
  WorldMapTile,
  WorldMapTileRequest,
  WorldSummary,
  WorldVillagerDump
} from "./types";
import {
  getUniqueIdKey,
  normalizeDimensionName,
  parseVillagerNbt,
  VillagePoiData
} from "./villagerParser";
import { computeActorDigestMutation, createDigpKey, assertSupportedSpatialDimension } from "./chunkDigest";
import { writeVillagerToNbt } from "./villagerWriter";
import { renderWorldMapTile } from "./worldMap";

export interface ApplyDirtyResult {
  success: boolean;
  modifiedCount: number;
  verifiedCount: number;
  backupPath: string | null;
  closeWarning?: string;
}

const POI_NAME_TO_WORKSTATION: Record<string, string> = {
  armorer: "minecraft:blast_furnace",
  butcher: "minecraft:smoker",
  cartographer: "minecraft:cartography_table",
  cleric: "minecraft:brewing_stand",
  farmer: "minecraft:composter",
  fisherman: "minecraft:barrel",
  fletcher: "minecraft:fletching_table",
  leatherworker: "minecraft:cauldron",
  librarian: "minecraft:lectern",
  mason: "minecraft:stonecutter",
  shepherd: "minecraft:loom",
  toolsmith: "minecraft:smithing_table",
  weaponsmith: "minecraft:grindstone"
};

async function scanLivePoiMap(db: LevelDB): Promise<Map<string, VillagePoiData>> {
  const livePoiMap = new Map<string, VillagePoiData>();
  const iterator = db.getIterator();
  for await (const [key, value] of iterator) {
    const kStr = key.toString("utf8");
    if (kStr.startsWith("VILLAGE_") && kStr.endsWith("_POI")) {
      try {
        const parts = kStr.split("_");
        const dim = normalizeDimensionName(parts[1] || "overworld");
        const parsed = await parseBedrockNbt(value);
        const root = parsed.parsed?.value || parsed.parsed;
        const poiList = root.POI?.value?.value || root.POI?.value || root.POI || [];
        if (Array.isArray(poiList)) {
          for (const entry of poiList) {
            const eVal = entry?.value || entry;
            const villagerIdKey = getUniqueIdKey(eVal.VillagerID);
            if (!villagerIdKey) continue;

            const instances = eVal.instances?.value?.value || eVal.instances?.value || eVal.instances || [];
            if (Array.isArray(instances)) {
              let ws: WorkstationLink | undefined;
              let bed: BedLink | undefined;

              for (const inst of instances) {
                const iVal = inst?.value || inst;
                const skip = Number(iVal.Skip?.value !== undefined ? iVal.Skip.value : iVal.Skip);
                if (skip === 1) continue;

                const type = Number(iVal.Type?.value !== undefined ? iVal.Type.value : iVal.Type);
                const x = Number(iVal.X?.value !== undefined ? iVal.X.value : iVal.X);
                const y = Number(iVal.Y?.value !== undefined ? iVal.Y.value : iVal.Y);
                const z = Number(iVal.Z?.value !== undefined ? iVal.Z.value : iVal.Z);
                const name = String(iVal.Name?.value || iVal.Name || "").toLowerCase().replace(/^minecraft:/, "");

                if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;

                if (type === 0) {
                  bed = {
                    type: "minecraft:bed",
                    dimension: dim,
                    position: { x, y, z }
                  };
                } else if (type === 2) {
                  const blockType = POI_NAME_TO_WORKSTATION[name] || "minecraft:job_site";
                  ws = {
                    type: blockType,
                    dimension: dim,
                    position: { x, y, z },
                    blockVerified: false
                  };
                }
              }

              if (ws || bed) {
                const existing = livePoiMap.get(villagerIdKey);
                livePoiMap.set(villagerIdKey, {
                  workstation: ws || existing?.workstation,
                  bed: bed || existing?.bed
                });
              }
            }
          }
        }
      } catch {}
    }
  }
  return livePoiMap;
}

export interface BedrockDbTestHooks {
  beforePut?: (
    key: Buffer,
    value: Buffer,
    forwardWriteIndex: number
  ) => void | Promise<void>;

  afterPut?: (
    key: Buffer,
    value: Buffer,
    forwardWriteIndex: number
  ) => void | Promise<void>;

  beforeRollbackPut?: (
    key: Buffer,
    value: Buffer | null
  ) => void | Promise<void>;

  beforeVerificationRead?: (
    key: Buffer
  ) => void | Promise<void>;

  beforePrePutCheck?: (
    key: Buffer,
    forwardWriteIndex: number
  ) => void | Promise<void>;

  beforeSemanticVerify?: (
    key: Buffer
  ) => void | Promise<void>;

  afterPreparation?: (
    journalSize: number
  ) => void | Promise<void>;

  putDb?: (
    db: LevelDB,
    key: Buffer,
    value: Buffer,
    forwardWriteIndex: number
  ) => void | Promise<void>;

  readAfterFailedPut?: (
    db: LevelDB,
    key: Buffer,
    forwardWriteIndex: number
  ) => Buffer | null | Promise<Buffer | null>;

  closeDb?: (
    db: LevelDB
  ) => Promise<void>;
}

export interface BedrockDbManagerOptions {
  backupRoot?: string;
  testHooks?: BedrockDbTestHooks;
  restoreCleanupFs?: RestoreCleanupFs;
  atomicFs?: AtomicFs;
  stagingTestHooks?: BedrockDbTestHooks;
}

export function findBedrockWorlds(): WorldSummary[] {
  const roots: string[] = [];

  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData) {
    roots.push(
      path.join(
        localAppData,
        "Packages",
        "Microsoft.MinecraftUWP_8wekyb3d8bbwe",
        "LocalState",
        "games",
        "com.mojang",
        "minecraftWorlds"
      )
    );
  }

  const appData = process.env.APPDATA;
  if (appData) {
    const roamingMojang = path.join(appData, "Minecraft Bedrock", "Users");
    if (fs.existsSync(roamingMojang)) {
      try {
        const userDirs = fs.readdirSync(roamingMojang);
        for (const u of userDirs) {
          roots.push(path.join(roamingMojang, u, "games", "com.mojang", "minecraftWorlds"));
        }
      } catch {}
    }
  }

  const summaries: WorldSummary[] = [];

  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    try {
      const entries = fs.readdirSync(root, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const fullPath = path.join(root, entry.name);
        if (fs.existsSync(path.join(fullPath, "db"))) {
          let name = entry.name;
          const levelNameFile = path.join(fullPath, "levelname.txt");
          if (fs.existsSync(levelNameFile)) {
            try {
              name = fs.readFileSync(levelNameFile, "utf8").trim() || name;
            } catch {}
          }
          let lastPlayed = 0;
          try {
            lastPlayed = fs.statSync(fullPath).mtimeMs;
          } catch {}

          summaries.push({
            folderName: entry.name,
            name,
            path: fullPath,
            lastPlayed
          });
        }
      }
    } catch {}
  }

  return summaries;
}

export class BedrockDbManager {
  private readonly worldPath: string;
  private readonly backupRoot: string;
  private readonly testHooks?: BedrockDbTestHooks;
  private readonly restoreCleanupFs?: RestoreCleanupFs;
  private readonly atomicFs: AtomicFs;
  private readonly stagingTestHooks?: BedrockDbTestHooks;
  private retainedChildManagers: BedrockDbManager[] = [];
  private db: LevelDB | null = null;
  private openPromise: Promise<LevelDB> | null = null;

  constructor(worldPath: string, options: BedrockDbManagerOptions = {}) {
    this.worldPath = path.resolve(worldPath);
    this.backupRoot = path.resolve(
      options.backupRoot ||
        path.join(os.homedir(), ".bedrock-villager-editor", "backups")
    );
    this.testHooks = options.testHooks;
    this.restoreCleanupFs = options.restoreCleanupFs;
    this.atomicFs = options.atomicFs || defaultAtomicFs;
    this.stagingTestHooks = options.stagingTestHooks;
  }

  public getBackupRoot(): string {
    return this.getWorldBackupNamespace();
  }

  private getWorldBackupNamespace(): string {
    const normalized =
      process.platform === "win32"
        ? this.worldPath.toLowerCase()
        : this.worldPath;

    const worldId = createHash("sha256")
      .update(normalized)
      .digest("hex")
      .slice(0, 16);

    return path.join(this.backupRoot, worldId);
  }

  private assertBackupRootOutsideWorld(): void {
    const world = path.resolve(this.worldPath);
    const root = path.resolve(this.getBackupRoot());

    if (root === world || root.startsWith(world + path.sep)) {
      throw new Error(
        "Backup directory must not be inside the Minecraft world directory."
      );
    }
  }

  public async open(readOnly = true, createIfMissing = false): Promise<LevelDB> {
    if (this.db) {
      return this.db;
    }
    if (this.openPromise) {
      return this.openPromise;
    }

    this.openPromise = (async () => {
      const dbPath = path.join(this.worldPath, "db");
      if (!fs.existsSync(dbPath) && !createIfMissing) {
        throw new Error("Invalid Bedrock world: database directory is missing.");
      }

      const candidate = new LevelDB(dbPath, {
        createIfMissing
      });

      try {
        await candidate.open();
      } catch (openError) {
        try {
          await candidate.close();
        } catch (closeError) {
          // Retain the candidate so close() can retry it.
          this.db = candidate;

          throw new RestartRequiredStorageError(
            "STORAGE_CLOSE_FAILED",
            "The Bedrock database could not be opened or closed safely. Restart the editor before performing another world operation.",
            {
              openError: openError instanceof Error ? openError.message : String(openError),
              closeError: closeError instanceof Error ? closeError.message : String(closeError)
            }
          );
        }
        throw openError;
      }

      this.db = candidate;
      return candidate;
    })();

    try {
      return await this.openPromise;
    } finally {
      this.openPromise = null;
    }
  }

  public async close(): Promise<void> {
    let firstError: unknown = null;

    const current = this.db;

    if (current) {
      try {
        if (this.testHooks?.closeDb) {
          await this.testHooks.closeDb(current);
        } else {
          await current.close();
        }

        if (this.db === current) {
          this.db = null;
        }
      } catch (error) {
        firstError = error;
      }
    }

    if (this.retainedChildManagers.length > 0) {
      const stillRetained: BedrockDbManager[] = [];

      for (const child of this.retainedChildManagers) {
        try {
          await child.close();
        } catch (error) {
          stillRetained.push(child);
          if (!firstError) {
            firstError = error;
          }
        }
      }

      this.retainedChildManagers = stillRetained;
    }

    if (firstError) {
      throw firstError;
    }
  }

  private async closeForOperation(
    context: string
  ): Promise<void> {
    try {
      await this.close();
      return;
    } catch (firstCloseError) {
      console.error(
        `${context}: initial LevelDB close failed; retrying once`,
        firstCloseError
      );

      try {
        await this.close();
        return;
      } catch (secondCloseError) {
        throw new RestartRequiredStorageError(
          "STORAGE_CLOSE_FAILED",
          (
            "The world database could not be closed safely. " +
            "Restart the editor before performing another world operation."
          ),
          {
            context,
            firstCloseError:
              firstCloseError instanceof Error
                ? firstCloseError.message
                : String(firstCloseError),
            secondCloseError:
              secondCloseError instanceof Error
                ? secondCloseError.message
                : String(secondCloseError)
          }
        );
      }
    }
  }

  public async getWorldMapTile(request: WorldMapTileRequest): Promise<WorldMapTile> {
    const db = await this.open(true);

    // Deliberately hand the renderer helper only a read capability. Terrain map
    // generation must never gain access to put/delete/compaction APIs.
    return renderWorldMapTile(
      {
        get: async (key: Buffer): Promise<Buffer | null> => {
          const value = await db.get(key);
          return value == null ? null : Buffer.from(value);
        }
      },
      request
    );
  }

  public async dumpVillagers(): Promise<WorldVillagerDump> {
    const db = await this.open(true);
    let worldName = path.basename(this.worldPath);

    const levelnamePath = path.join(this.worldPath, "levelname.txt");
    if (fs.existsSync(levelnamePath)) {
      try {
        worldName = fs.readFileSync(levelnamePath, "utf8").trim() || worldName;
      } catch {}
    }

    const villagers: ParsedVillager[] = [];
    const actorPrefix = Buffer.from("actorprefix", "utf8");
    const villagePoiMap = new Map<string, VillagePoiData>();
    const rawActorEntries: { key: Buffer; value: Buffer; hash: string }[] = [];

    try {
      const iterator = db.getIterator();
      for await (const [key, value] of iterator) {
        const kStr = key.toString("utf8");
        if (kStr.startsWith("VILLAGE_") && kStr.endsWith("_POI")) {
          try {
            const parts = kStr.split("_");
            const dim = normalizeDimensionName(parts[1] || "overworld");
            const parsed = await parseBedrockNbt(value);
            const root = parsed.parsed?.value || parsed.parsed;
            const poiList = root.POI?.value?.value || root.POI?.value || root.POI || [];
            const poiKeyHex = key.toString("hex");
            const poiOriginalValueHash = sha256(value);
            const poiEncoding = parsed.metadata;

            if (Array.isArray(poiList)) {
              for (const entry of poiList) {
                const eVal = entry?.value || entry;
                const villagerIdKey = getUniqueIdKey(eVal.VillagerID);
                if (!villagerIdKey) continue;

                const instances = eVal.instances?.value?.value || eVal.instances?.value || eVal.instances || [];
                if (Array.isArray(instances)) {
                  let ws: WorkstationLink | undefined;
                  let bed: BedLink | undefined;
                  let wsStorage: LinkStorageSource | undefined;
                  let bedStorage: LinkStorageSource | undefined;

                  for (const inst of instances) {
                    const iVal = inst?.value || inst;
                    const skip = Number(iVal.Skip?.value !== undefined ? iVal.Skip.value : iVal.Skip);
                    if (skip === 1) continue;

                    const type = Number(iVal.Type?.value !== undefined ? iVal.Type.value : iVal.Type);
                    const x = Number(iVal.X?.value !== undefined ? iVal.X.value : iVal.X);
                    const y = Number(iVal.Y?.value !== undefined ? iVal.Y.value : iVal.Y);
                    const z = Number(iVal.Z?.value !== undefined ? iVal.Z.value : iVal.Z);
                    const name = String(iVal.Name?.value || iVal.Name || "").toLowerCase().replace(/^minecraft:/, "");

                    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;

                    if (type === 0) {
                      bed = {
                        type: "minecraft:bed",
                        dimension: dim,
                        position: { x, y, z }
                      };
                      bedStorage = {
                        source: "village_poi",
                        poiKeyHex,
                        poiOriginalValueHash,
                        poiEncoding,
                        villagerUniqueIdKey: villagerIdKey,
                        poiRole: "bed"
                      };
                    } else if (type === 2) {
                      const blockType = POI_NAME_TO_WORKSTATION[name] || "minecraft:job_site";
                      ws = {
                        type: blockType,
                        dimension: dim,
                        position: { x, y, z },
                        blockVerified: false
                      };
                      wsStorage = {
                        source: "village_poi",
                        poiKeyHex,
                        poiOriginalValueHash,
                        poiEncoding,
                        villagerUniqueIdKey: villagerIdKey,
                        poiRole: "workstation"
                      };
                    }
                  }

                  if (ws || bed) {
                    const existing = villagePoiMap.get(villagerIdKey);
                    villagePoiMap.set(villagerIdKey, {
                      workstation: ws || existing?.workstation,
                      bed: bed || existing?.bed,
                      linkStorageMetadata: {
                        workstation: wsStorage || existing?.linkStorageMetadata?.workstation,
                        bed: bedStorage || existing?.linkStorageMetadata?.bed
                      }
                    });
                  }
                }
              }
            }
          } catch (err) {
            console.warn(
              "Skipping unparseable Village POI record:",
              key.toString("hex"),
              err instanceof Error ? err.message : String(err)
            );
          }
        } else if (key.subarray(0, actorPrefix.length).equals(actorPrefix)) {
          rawActorEntries.push({
            key,
            value,
            hash: sha256(value)
          });
        }
      }

      for (const actor of rawActorEntries) {
        try {
          const parsedStorage = await parseBedrockNbt(actor.value);
          const root = parsedStorage.parsed?.value || parsedStorage.parsed;
          const id = String(
            root?.identifier?.value || root?.identifier || ""
          );

          if (id === "minecraft:villager_v2" || id === "minecraft:zombie_villager_v2") {
            const uidKey = getUniqueIdKey(root.UniqueID);
            const villagePoi = uidKey ? villagePoiMap.get(uidKey) : undefined;

            const parsed = parseVillagerNbt(
              parsedStorage.parsed,
              actor.key.toString("hex"),
              villagers.length,
              {
                originalDbValueHash: actor.hash,
                nbtEncoding: parsedStorage.metadata
              },
              villagePoi
            );

            if (parsed) {
              villagers.push(parsed);
            }
          }
        } catch {
          // Non-NBT or corrupt actor entry skipped during dump
        }
      }
    } finally {
      await this.closeForOperation(
        "Closing database after villager dump"
      );
    }

    const summary = {
      byProfession: {} as Record<string, number>,
      withTrades: 0,
      withoutWorkstation: 0,
      zombies: 0,
      cured: 0
    };

    for (const v of villagers) {
      const prof = v.professionKnown ? v.profession : "unknown";
      summary.byProfession[prof] = (summary.byProfession[prof] || 0) + 1;
      if (v.trades.length > 0) summary.withTrades++;
      if (!v.linkedWorkstation) summary.withoutWorkstation++;
      if (v.isZombie) summary.zombies++;
      if (v.isCured) summary.cured++;
    }

    return {
      worldName,
      worldPath: this.worldPath,
      exportedAt: new Date().toISOString(),
      villagerCount: villagers.length,
      summary,
      villagers
    };
  }

  public async hasWriteConflicts(writes: DirtyVillagerWrite[]): Promise<boolean> {
    if (writes.length === 0) return false;
    const db = await this.open(true);

    try {
      for (const write of writes) {
        const keyBuffer = Buffer.from(write.baseline.dbKeyHex, "hex");
        let liveBytes: Buffer | null = null;
        try {
          liveBytes = await db.get(keyBuffer);
        } catch {
          return true; // Actor record disappeared or read error
        }

        if (!liveBytes) {
          return true;
        }

        const liveHash = sha256(liveBytes);
        if (liveHash !== write.baseline.originalDbValueHash) {
          return true; // Live bytes changed on disk
        }
      }
      return false;
    } finally {
      await this.closeForOperation(
        "Closing database after write-conflict check"
      );
    }
  }

  public async applyDirtyVillagers(
    writes: DirtyVillagerWrite[],
    options: { createBackup?: boolean } = { createBackup: true }
  ): Promise<ApplyDirtyResult> {
    if (!writes || writes.length === 0) {
      return {
        success: true,
        modifiedCount: 0,
        verifiedCount: 0,
        backupPath: null
      };
    }

    let backupPath: string | null = null;
    if (options.createBackup !== false) {
      backupPath = await this.createBackup();
    }

    await this.closeForOperation(
      "Closing database before villager write transaction"
    );
    const db = await this.open(false, false);

    interface DbMutationJournalItem {
      kind: "actor" | "digp";
      key: Buffer;
      originalExisted: boolean;
      originalValue: Buffer | null;
      newValue: Buffer;
      description: string;
      expectedEncoding?: ParsedVillager["nbtEncoding"];
      actorMetadata?: {
        current: ParsedVillager;
        baseline: ParsedVillager;
      };
    }

    const writeJournal: DbMutationJournalItem[] = [];
    const writtenItems: DbMutationJournalItem[] = [];
    let verifiedCount = 0;

    const rollbackAndVerify = async (): Promise<void> => {
      const failures: string[] = [];
      const restoredItems: DbMutationJournalItem[] = [];

      for (const item of [...writtenItems].reverse()) {
        let live: Buffer | null;
        try {
          live = await db.get(item.key);
        } catch (error) {
          failures.push(
            `rollback read failed for ${item.kind} ${item.key.toString("hex")}: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
          continue;
        }

        // Already original: no write needed.
        if (
          (item.originalExisted && item.originalValue && live && live.equals(item.originalValue)) ||
          (!item.originalExisted && !live)
        ) {
          restoredItems.push(item);
          continue;
        }

        // The exact editor-written bytes are still present: safe to restore.
        if (live && live.equals(item.newValue)) {
          try {
            if (this.testHooks?.beforeRollbackPut) {
              await this.testHooks.beforeRollbackPut(item.key, item.originalValue);
            }
            if (item.originalExisted && item.originalValue) {
              await db.put(item.key, item.originalValue);
            } else {
              await db.delete(item.key);
            }
            restoredItems.push(item);
          } catch (error) {
            failures.push(
              `rollback write failed for ${item.kind} ${item.key.toString("hex")}: ${
                error instanceof Error ? error.message : String(error)
              }`
            );
          }
          continue;
        }

        // Neither original nor editor output.
        // A third party changed it. DO NOT overwrite.
        failures.push(
          `rollback conflict for ${item.kind} ${item.key.toString("hex")}: record changed externally after the editor write; external bytes were preserved`
        );
      }

      for (const item of restoredItems) {
        try {
          const restored = await db.get(item.key);
          if (item.originalExisted && item.originalValue) {
            if (!restored || !restored.equals(item.originalValue)) {
              failures.push(
                `rollback verification mismatch for ${item.kind} ${item.key.toString("hex")}`
              );
            }
          } else {
            if (restored !== null) {
              failures.push(
                `rollback verification mismatch for absent key ${item.kind} ${item.key.toString("hex")}`
              );
            }
          }
        } catch (error) {
          failures.push(
            `rollback verification read failed for ${item.kind} ${item.key.toString("hex")}: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      }

      if (failures.length > 0) {
        throw new RestartRequiredStorageError(
          "SAVE_ROLLBACK_FAILED",
          "SAVE FAILED AND AUTOMATIC ROLLBACK COULD NOT FULLY RESTORE THE EDITOR-WRITTEN RECORDS. " +
            "Do not continue editing this world. Restore the pre-save backup and restart the editor.",
          {
            failures: [...failures]
          }
        );
      }
    };

    let completedResult: ApplyDirtyResult | null = null;
    let terminalError: unknown = null;

    try {
      // Helper to retrieve or create staged auxiliary mutations (one entry per unique key)
      const auxiliaryJournalByKey = new Map<string, DbMutationJournalItem>();

      const getOrCreateAuxiliaryStage = async (
        kind: "digp",
        key: Buffer,
        description: string,
        expectedEncoding?: ParsedVillager["nbtEncoding"]
      ): Promise<DbMutationJournalItem> => {
        const hex = key.toString("hex");
        const existing = auxiliaryJournalByKey.get(hex);
        if (existing) {
          return existing;
        }

        let liveBytes: Buffer | null = null;
        try {
          liveBytes = await db.get(key);
        } catch (err) {
          throw new Error(`Failed to read ${kind} record (${hex}): ${err instanceof Error ? err.message : String(err)}`);
        }

        const originalExisted = liveBytes !== null;
        const originalValue = liveBytes ? Buffer.from(liveBytes) : null;
        const newValue = liveBytes ? Buffer.from(liveBytes) : Buffer.alloc(0);

        const item: DbMutationJournalItem = {
          kind,
          key,
          originalExisted,
          originalValue,
          newValue,
          description,
          expectedEncoding
        };

        auxiliaryJournalByKey.set(hex, item);
        return item;
      };

      // Step 1: Strict live-hash recheck & NBT preparation for ALL mutations
      for (const write of writes) {
        const villager = write.current;
        const baseline = write.baseline;
        const keyBuffer = Buffer.from(baseline.dbKeyHex, "hex");

        let originalValue: Buffer;
        try {
          const fetched = await db.get(keyBuffer);
          if (!fetched) {
            throw new Error(`Save conflict: actor record ${villager.sessionVillagerId} no longer exists.`);
          }
          originalValue = fetched;
        } catch (getErr) {
          if (getErr instanceof Error && getErr.message.startsWith("Save conflict:")) {
            throw getErr;
          }
          throw new Error(
            `Save conflict: actor record ${villager.sessionVillagerId} could not be read.`
          );
        }

        const liveHash = sha256(originalValue);
        if (liveHash !== baseline.originalDbValueHash) {
          throw new Error(
            `Save conflict: actor record ${villager.sessionVillagerId} changed after the session was loaded. Reload the world before saving.`
          );
        }

        const updatedNbt = writeVillagerToNbt(villager, baseline);
        const encodedBuffer = encodeBedrockNbtPreservingFormat(
          updatedNbt,
          baseline.nbtEncoding
        );

        writeJournal.push({
          kind: "actor",
          key: keyBuffer,
          originalExisted: true,
          originalValue,
          newValue: encodedBuffer,
          description: `Actor ${villager.sessionVillagerId}`,
          expectedEncoding: baseline.nbtEncoding,
          actorMetadata: {
            current: villager,
            baseline
          }
        });

        // Digp spatial digest mutations (ONLY on real chunk or dimension boundary crossing)
        if (
          keyBuffer.length === 19 &&
          keyBuffer.subarray(0, 11).toString("utf8") === "actorprefix"
        ) {
          const actorId8Bytes = keyBuffer.subarray(11);
          const oldCx = Math.floor(baseline.position.x / 16);
          const oldCz = Math.floor(baseline.position.z / 16);
          const oldDimId = baseline.dimensionId;
          const newCx = Math.floor(villager.position.x / 16);
          const newCz = Math.floor(villager.position.z / 16);
          const newDimId = villager.dimensionId;

          if (
            typeof oldDimId !== "number" ||
            !Number.isInteger(oldDimId) ||
            typeof newDimId !== "number" ||
            !Number.isInteger(newDimId)
          ) {
            throw new Error(
              `Villager dimensionId must be a valid integer, got old=${oldDimId}, new=${newDimId}`
            );
          }

          if (oldCx !== newCx || oldCz !== newCz || oldDimId !== newDimId) {
            assertSupportedSpatialDimension(oldDimId);
            assertSupportedSpatialDimension(newDimId);

            // Remove from old chunk digest stage
            const oldDigpKey = createDigpKey(oldCx, oldCz, oldDimId);
            const oldStage = await getOrCreateAuxiliaryStage(
              "digp",
              oldDigpKey,
              `Chunk (${oldCx}, ${oldCz}) digest`
            );

            if (oldStage.newValue && oldStage.newValue.length > 0) {
              const removeRes = computeActorDigestMutation(oldStage.newValue, actorId8Bytes, "remove");
              if (removeRes.changed) {
                oldStage.newValue = removeRes.next;
              }
            }

            // Add to new chunk digest stage
            const newDigpKey = createDigpKey(newCx, newCz, newDimId);
            const newStage = await getOrCreateAuxiliaryStage(
              "digp",
              newDigpKey,
              `Chunk (${newCx}, ${newCz}) digest`
            );

            const addRes = computeActorDigestMutation(newStage.newValue, actorId8Bytes, "add");
            if (addRes.changed) {
              newStage.newValue = addRes.next;
            }
          }
        }
      }

      // Append only changed auxiliary entries to writeJournal (skip staged no-ops)
      for (const auxItem of auxiliaryJournalByKey.values()) {
        const isNoOp =
          (auxItem.originalExisted && auxItem.originalValue && auxItem.newValue.equals(auxItem.originalValue)) ||
          (!auxItem.originalExisted && auxItem.newValue.length === 0);

        if (!isNoOp) {
          writeJournal.push(auxItem);
        }
      }

      if (this.testHooks?.afterPreparation) {
        await this.testHooks.afterPreparation(writeJournal.length);
      }

      // Step 2: Immediate pre-put check and DB writes for ALL coalesced journal entries
      let forwardWriteIndex = 0;
      for (const item of writeJournal) {
        forwardWriteIndex++;

        if (this.testHooks?.beforePrePutCheck) {
          await this.testHooks.beforePrePutCheck(item.key, forwardWriteIndex);
        }

        let liveBeforeWrite: Buffer | null;
        try {
          liveBeforeWrite = await db.get(item.key);
        } catch {
          throw new Error(
            `Save conflict: ${item.kind} record ${item.key.toString("hex")} disappeared immediately before write.`
          );
        }

        if (item.originalExisted) {
          if (!liveBeforeWrite || !liveBeforeWrite.equals(item.originalValue!)) {
            throw new Error(
              `Save conflict: ${item.kind} record ${item.key.toString("hex")} changed immediately before write.`
            );
          }
        } else {
          if (liveBeforeWrite !== null) {
            throw new Error(
              `Save conflict: ${item.kind} record ${item.key.toString("hex")} was created externally immediately before write.`
            );
          }
        }

        if (this.testHooks?.beforePut) {
          await this.testHooks.beforePut(item.key, item.newValue, forwardWriteIndex);
        }

        try {
          if (this.testHooks?.putDb) {
            await this.testHooks.putDb(
              db,
              item.key,
              item.newValue,
              forwardWriteIndex
            );
          } else {
            await db.put(item.key, item.newValue);
          }
          writtenItems.push(item);
        } catch (putError) {
          let liveAfterFailedPut: Buffer | null;

          try {
            liveAfterFailedPut = this.testHooks?.readAfterFailedPut
              ? await this.testHooks.readAfterFailedPut(
                  db,
                  item.key,
                  forwardWriteIndex
                )
              : await db.get(item.key);
          } catch (readError) {
            throw new RestartRequiredStorageError(
              "SAVE_WRITE_STATE_UNKNOWN",
              `A ${item.kind} write reported an error and the editor could not verify whether the record changed. ` +
                "Do not continue editing this world. Restore the pre-save backup if needed and restart the editor.",
              {
                kind: item.kind,
                key: item.key.toString("hex"),
                putError:
                  putError instanceof Error
                    ? putError.message
                    : String(putError),
                verificationReadError:
                  readError instanceof Error
                    ? readError.message
                    : String(readError)
              }
            );
          }

          if (liveAfterFailedPut && liveAfterFailedPut.equals(item.newValue)) {
            // The write committed despite reporting an error.
            // Journal it so the outer failure path rolls it back.
            writtenItems.push(item);
            throw putError;
          }

          if (
            (item.originalExisted && item.originalValue && liveAfterFailedPut && liveAfterFailedPut.equals(item.originalValue)) ||
            (!item.originalExisted && !liveAfterFailedPut)
          ) {
            // Confirmed not committed.
            throw putError;
          }

          throw new RestartRequiredStorageError(
            "SAVE_WRITE_STATE_UNKNOWN",
            `A ${item.kind} write reported an error and the live record no longer matches either the original or editor-written bytes. ` +
              "External bytes were preserved. Do not continue editing this world; restart the editor.",
            {
              kind: item.kind,
              key: item.key.toString("hex"),
              putError:
                putError instanceof Error
                  ? putError.message
                  : String(putError)
            }
          );
        }

        if (this.testHooks?.afterPut) {
          await this.testHooks.afterPut(item.key, item.newValue, forwardWriteIndex);
        }
      }

      // Step 3: Strict post-save verification (byte-equality + format + true observed semantic re-parse)
      const liveObservedPoiMap = await scanLivePoiMap(db);

      for (const item of writeJournal) {
        if (this.testHooks?.beforeVerificationRead) {
          await this.testHooks.beforeVerificationRead(item.key);
        }

        const readBackBuffer = await db.get(item.key);
        if (!readBackBuffer || !readBackBuffer.equals(item.newValue)) {
          throw new Error(`Post-save byte verification failed for ${item.kind}: read back bytes do not match written bytes.`);
        }

        if (item.kind === "actor" && item.actorMetadata && item.expectedEncoding) {
          const parsedStorage = await parseBedrockNbt(readBackBuffer);
          if (parsedStorage.metadata.format !== item.expectedEncoding.format) {
            throw new Error(
              `Post-save format mismatch: expected ${item.expectedEncoding.format}, got ${parsedStorage.metadata.format}`
            );
          }
          if (parsedStorage.metadata.prefixHex !== item.expectedEncoding.prefixHex) {
            throw new Error("Post-save header prefix mismatch.");
          }

          const uidKey = getUniqueIdKey(parsedStorage.parsed?.value?.UniqueID || parsedStorage.parsed?.UniqueID);
          const observedPoi = uidKey ? liveObservedPoiMap.get(uidKey) : undefined;

          const verifiedVillager = parseVillagerNbt(
            parsedStorage.parsed,
            item.key.toString("hex"),
            0,
            {
              originalDbValueHash: sha256(readBackBuffer),
              nbtEncoding: parsedStorage.metadata
            },
            observedPoi
          );

          if (!verifiedVillager) {
            throw new Error("Post-save semantic verification could not re-parse the villager.");
          }

          if (this.testHooks?.beforeSemanticVerify) {
            await this.testHooks.beforeSemanticVerify(item.key);
          }

          assertVillagerSemanticMatch(item.actorMetadata.current, verifiedVillager);
          verifiedCount++;
        }
      }

      completedResult = {
        success: true,
        modifiedCount: writes.length,
        verifiedCount,
        backupPath
      };
    } catch (error) {
      try {
        if (writtenItems.length > 0) {
          await rollbackAndVerify();
        }
      } catch (rollbackError) {
        terminalError = rollbackError;
      }

      if (!terminalError) {
        terminalError = error;
      }
    }


    let closeErrorAfterTransaction: unknown = null;
    let closeWarning: string | undefined;

    try {
      await this.close();
    } catch (closeError) {
      closeErrorAfterTransaction = closeError;
      console.error(
        "LevelDB close failed after save operation:",
        closeError
      );
      if (completedResult) {
        closeWarning =
          "The save was committed and verified, but LevelDB reported an error while closing. Reopen the world before further edits.";
      }
    }

    if (terminalError && closeErrorAfterTransaction) {
      if (isRestartRequiredStorageError(terminalError)) {
        throw terminalError;
      }

      throw new RestartRequiredStorageError(
        "STORAGE_CLOSE_FAILED",
        (
          "The save failed and the world database could not be closed safely afterward. " +
          "Restart the editor before performing another world operation."
        ),
        {
          transactionError:
            terminalError instanceof Error
              ? terminalError.message
              : String(terminalError),
          closeError:
            closeErrorAfterTransaction instanceof Error
              ? closeErrorAfterTransaction.message
              : String(closeErrorAfterTransaction)
        }
      );
    }

    if (terminalError) {
      throw terminalError;
    }

    if (!completedResult) {
      throw new Error("Save ended without a result.");
    }

    if (closeWarning) {
      completedResult.closeWarning = closeWarning;
    }

    return completedResult;
  }

  private backupIdForFileName(fileName: string): string {
    return createHash("sha256").update(fileName).digest("hex").slice(0, 16);
  }

  public getBackupIdForPath(backupPath: string): string {
    const resolved = path.resolve(backupPath);
    const root = path.resolve(this.getWorldBackupNamespace());
    if (!resolved.startsWith(root + path.sep)) {
      throw new Error("Backup path is outside the active world's backup namespace.");
    }
    return this.backupIdForFileName(path.basename(resolved));
  }

  public async createBackup(): Promise<string> {
    await this.closeForOperation(
      "Closing database before backup creation"
    );
    this.assertBackupRootOutsideWorld();

    const targetDir = this.getWorldBackupNamespace();
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const isoStamp = new Date().toISOString().replace(/:/g, "-").replace(/\..+/, "");
    const backupFileName = `backup_${isoStamp}_${randomUUID().slice(0, 6)}.zip`;
    const backupPath = path.join(targetDir, backupFileName);

    return new Promise((resolve, reject) => {
      const output = fs.createWriteStream(backupPath);
      const archive = archiver("zip", { zlib: { level: 6 } });

      let failed = false;

      const cleanupAndReject = (err: any) => {
        if (failed) return;
        failed = true;
        try {
          output.close();
        } catch {}
        if (fs.existsSync(backupPath)) {
          try {
            fs.unlinkSync(backupPath);
          } catch {}
        }
        reject(err);
      };

      output.on("close", () => {
        if (failed) return;
        try {
          const stat = fs.statSync(backupPath);
          if (stat.size === 0) {
            cleanupAndReject(new Error("Created backup archive is empty."));
            return;
          }
          resolve(backupPath);
        } catch (statError) {
          cleanupAndReject(statError);
        }
      });

      archive.on("error", cleanupAndReject);
      output.on("error", cleanupAndReject);

      archive.pipe(output);
      archive.directory(this.worldPath, false);
      archive.finalize().catch(cleanupAndReject);
    });
  }

  public async listBackups(): Promise<BackupSummary[]> {
    const targetDir = this.getWorldBackupNamespace();
    if (!fs.existsSync(targetDir)) return [];

    const files = fs.readdirSync(targetDir).filter((f) => f.endsWith(".zip"));
    const summaries: BackupSummary[] = [];

    for (const f of files) {
      const full = path.join(targetDir, f);
      try {
        const stat = fs.statSync(full);
        const id = this.backupIdForFileName(f);
        summaries.push({
          id,
          fileName: f,
          createdAt: stat.mtimeMs,
          sizeBytes: stat.size,
          integrityStatus: "not_checked"
        });
      } catch {}
    }

    return summaries.sort((a, b) => b.createdAt - a.createdAt);
  }

  public resolveBackupPathById(backupId: string): string | null {
    const targetDir = this.getWorldBackupNamespace();
    if (!fs.existsSync(targetDir)) return null;

    const files = fs.readdirSync(targetDir).filter((f) => f.endsWith(".zip"));
    for (const f of files) {
      const id = this.backupIdForFileName(f);
      if (id === backupId) {
        return path.join(targetDir, f);
      }
    }
    return null;
  }

  public async restoreBackup(
    backupZipPath: string
  ): Promise<{ warning?: string }> {
    await this.closeForOperation(
      "Closing database before backup restore"
    );
    const resolved = path.resolve(backupZipPath);

    if (!fs.existsSync(resolved)) {
      throw new Error("Backup file does not exist.");
    }

    // Create automatic safety backup before performing restore
    let safetyBackup: string | null = null;
    try {
      safetyBackup = await this.createBackup();
    } catch (error) {
      if (isRestartRequiredStorageError(error)) {
        throw error;
      }
      throw new Error("Failed to create pre-restore safety backup.");
    }

    const parent = path.dirname(this.worldPath);
    const base = path.basename(this.worldPath);
    const staging = fs.mkdtempSync(path.join(parent, `.${base}.restore-staging-`));
    const previous = path.join(parent, `.${base}.restore-previous-${Date.now()}`);

    try {
      await extract(resolved, { dir: staging });
    } catch (extractError) {
      try {
        fs.rmSync(staging, { recursive: true, force: true });
      } catch {}
      throw new Error("Backup is invalid or corrupted.");
    }

    const stagingDb = path.join(staging, "db");
    if (!fs.existsSync(stagingDb) || !fs.statSync(stagingDb).isDirectory()) {
      try {
        fs.rmSync(staging, { recursive: true, force: true });
      } catch {}
      throw new Error("Backup is invalid: extracted db directory is missing.");
    }

    const stagingManager = new BedrockDbManager(staging, {
      backupRoot: this.backupRoot,
      testHooks: this.stagingTestHooks
    });

    let stagingValidationError: unknown = null;

    try {
      await stagingManager.open(true, false);
    } catch (openError) {
      stagingValidationError = openError;
    }

    try {
      await stagingManager.close();
    } catch (closeError) {
      this.retainedChildManagers.push(stagingManager);

      if (!stagingValidationError) {
        stagingValidationError = new RestartRequiredStorageError(
          "STORAGE_CLOSE_FAILED",
          "The staged backup database could not be closed safely after validation. " +
            "Restart the editor before performing another world operation.",
          closeError instanceof Error ? closeError.message : String(closeError)
        );
      }
    }

    if (stagingValidationError) {
      try {
        fs.rmSync(staging, { recursive: true, force: true });
      } catch {}

      if (isRestartRequiredStorageError(stagingValidationError)) {
        throw stagingValidationError;
      }

      throw new Error(
        "Backup contains a db directory but the LevelDB database could not be validated safely."
      );
    }

    try {
      atomicReplaceWorldDirectory(
        this.worldPath,
        staging,
        previous,
        this.atomicFs
      );
    } catch (replaceError) {
      console.error("Atomic restore replacement failed:", {
        safetyBackup,
        previous,
        replaceError: isRestartRequiredStorageError(replaceError)
          ? {
              name: replaceError.name,
              code: replaceError.code,
              debugDetail: replaceError.debugDetail
            }
          : replaceError
      });

      if (isRestartRequiredStorageError(replaceError)) {
        throw replaceError;
      }

      throw new Error(
        "Backup restore failed. The original live world directory was restored automatically."
      );
    } finally {
      if (fs.existsSync(staging)) {
        try {
          fs.rmSync(staging, { recursive: true, force: true });
        } catch {}
      }
    }

    const cleanupResult = cleanupPreviousRestoreDirectory(
      previous,
      this.restoreCleanupFs
    );
    if (!cleanupResult.cleaned && cleanupResult.warning) {
      console.warn(cleanupResult.warning, { previous });
    }

    return {
      warning: cleanupResult.cleaned ? undefined : cleanupResult.warning
    };
  }

  public async restoreBackupById(
    backupId: string
  ): Promise<{ warning?: string }> {
    const backupPath = this.resolveBackupPathById(backupId);
    if (!backupPath) {
      throw new Error("Backup not found.");
    }
    return await this.restoreBackup(backupPath);
  }

  public async deleteBackupById(backupId: string): Promise<void> {
    const backupPath = this.resolveBackupPathById(backupId);
    if (!backupPath) {
      throw new Error("Backup not found.");
    }
    fs.unlinkSync(backupPath);
  }
}

function sha256(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}
