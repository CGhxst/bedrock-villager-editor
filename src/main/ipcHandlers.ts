import { BrowserWindow, dialog, ipcMain, IpcMainInvokeEvent, shell } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import { BedrockDbManager } from "../core/bedrockDb";
import { getAllProfessions } from "../core/professions";
import { BEDROCK_ENCHANTMENTS } from "../core/enchantments";
import { WorldSession } from "../core/session/WorldSession";
import {
  BackupSummary,
  SavePreview,
  SaveResult,
  SessionStateSnapshot,
  VillagerDebugInfo,
  VillagerViewModel,
  WorldChoice,
  WorldMapTileResult,
  WorldOpenResult,
  WorldOpenSnapshot
} from "../core/types";
import { backupIdSchema, sessionCommandSchema, worldMapTileRequestSchema } from "../core/validation";
import { exportVillagersToJson, importVillagersFromJson } from "../core/jsonExchange";
import { OperationBusyError, OperationGate } from "./operationGate";
import {
  isRestartRequiredStorageError,
  RestartRequiredStorageError
} from "../core/storageFatalError";
import { MapReadBarrier } from "./mapReadBarrier";
import { StorageHealth } from "./storageHealth";
import {
  handleCommittedRestartRequiredStorageFailure,
  handleRestartRequiredStorageFailure
} from "./fatalStorageWorkflow";

export function publicStorageError(
  error: unknown,
  fallback: string
): string {
  if (isRestartRequiredStorageError(error)) {
    return error.publicMessage;
  }

  const message =
    error instanceof Error
      ? error.message
      : String(error);

  const safePrefixes = [
    "Save conflict:",
    "Post-save ",
    "Backup is invalid",
    "Backup not found.",
    "Invalid backup ID.",
    "UNSAVED_CHANGES"
  ];

  if (
    safePrefixes.some(
      (prefix) =>
        message.startsWith(
          prefix
        )
    )
  ) {
    return message;
  }

  return fallback;
}

export function assertTrustedSender(
  event: IpcMainInvokeEvent,
  expectedWindow: BrowserWindow
): void {
  if (
    expectedWindow.isDestroyed() ||
    event.sender.isDestroyed()
  ) {
    throw new Error(
      "Rejected IPC from a destroyed window."
    );
  }

  if (
    event.sender !==
    expectedWindow.webContents
  ) {
    throw new Error(
      "Rejected IPC from an unexpected webContents."
    );
  }

  if (
    event.senderFrame !==
    expectedWindow.webContents.mainFrame
  ) {
    throw new Error(
      "Rejected IPC from a non-main renderer frame."
    );
  }

  const url =
    event.sender.getURL();

  if (
    !url.startsWith(
      "file://"
    )
  ) {
    throw new Error(
      "Rejected IPC from a non-local renderer."
    );
  }
}

function handleTrusted<T>(
  channel: string,
  mainWindow: BrowserWindow,
  handler: (event: IpcMainInvokeEvent, ...args: any[]) => Promise<T> | T
): void {
  ipcMain.handle(channel, async (event, ...args) => {
    assertTrustedSender(event, mainWindow);
    return await handler(event, ...args);
  });
}

const REGISTERED_CHANNELS = [
  "world:list",
  "world:open",
  "world:close",
  "villager:list",
  "world:mapTile",
  "villager:debug",
  "diagnostics:professions",
  "session:command",
  "session:undo",
  "session:redo",
  "session:state",
  "session:dirtyCount",
  "session:discardChanges",
  "world:savePreview",
  "world:save",
  "world:backup",
  "backup:list",
  "backup:restore",
  "backup:delete",
  "backup:reveal",
  "dialog:chooseFolder",
  "metadata:get",
  "villager:exportJson",
  "villager:importJson"
] as const;

export function unregisterIpcHandlers(): void {
  for (const channel of REGISTERED_CHANNELS) {
    ipcMain.removeHandler(channel);
  }
}

export interface IpcHandlerOptions {
  backupRoot?: string;
}

export interface IpcHandlerController {
  getSessionState: () => SessionStateSnapshot;
  disposeStorage: () => Promise<{ success: boolean }>;
}

export async function quarantineAfterReloadFailure(
  manager: BedrockDbManager,
  callbacks?: {
    clearSession?: () => void;
    clearManager?: () => void;
    retainManager?: (m: BedrockDbManager) => void;
  }
): Promise<{ managerClosed: boolean }> {
  if (callbacks?.clearSession) {
    callbacks.clearSession();
  }

  try {
    await manager.close();
    if (callbacks?.clearManager) {
      callbacks.clearManager();
    }
    return { managerClosed: true };
  } catch (closeError) {
    console.error("Failed closing manager during reload-failure quarantine:", closeError);
    if (callbacks?.retainManager) {
      callbacks.retainManager(manager);
    }
    return { managerClosed: false };
  }
}

export function registerIpcHandlers(
  mainWindow: BrowserWindow,
  options: IpcHandlerOptions = {}
): IpcHandlerController {
  unregisterIpcHandlers();

  const operationGate = new OperationGate();
  let activeDbManager: BedrockDbManager | null = null;
  let activeSession: WorldSession | null = null;

  const storageHealth = new StorageHealth();
  const mapReadBarrier = new MapReadBarrier();

  function requireStorageHealthy(): void {
    storageHealth.requireHealthy();
  }

  function markStorageRestartRequired(message: string): void {
    storageHealth.markRestartRequired(message);
  }

  async function closeManagerOrQuarantine(
    manager: BedrockDbManager,
    context: string
  ): Promise<boolean> {
    try {
      await manager.close();
      storageHealth.release(manager);
      return true;
    } catch (error) {
      console.error(context, error);
      storageHealth.quarantine(
        manager,
        "A world database could not be closed safely. Restart the editor before performing another world operation."
      );
      return false;
    }
  }

  const worldHandleMap = new Map<string, string>();
  let nextHandleId = 1;

  function createHandle(worldPath: string): string {
    const handle = `wh_${nextHandleId++}`;
    worldHandleMap.set(handle, worldPath);
    return handle;
  }

  function resolveHandle(handle: string): string | null {
    return worldHandleMap.get(handle) || null;
  }

  async function openCandidateWorld(worldPath: string): Promise<{
    manager: BedrockDbManager;
    session: WorldSession;
  }> {
    const candidateManager = new BedrockDbManager(worldPath, {
      backupRoot: options.backupRoot
    });

    try {
      const dump = await candidateManager.dumpVillagers();
      const candidateSession = new WorldSession(dump);
      return {
        manager: candidateManager,
        session: candidateSession
      };
    } catch (error) {
      const closed = await closeManagerOrQuarantine(
        candidateManager,
        "Failed closing rejected world candidate:"
      );

      if (!closed) {
        throw new RestartRequiredStorageError(
          "STORAGE_CLOSE_FAILED",
          "A candidate world database could not be closed safely. " +
            "Restart the editor before performing another world operation.",
          {
            originalError: error instanceof Error ? error.message : String(error)
          }
        );
      }

      throw error;
    }
  }

  async function commitCandidateWorld(candidate: {
    manager: BedrockDbManager;
    session: WorldSession;
  }): Promise<void> {
    const previousManager = activeDbManager;

    if (previousManager && previousManager !== candidate.manager) {
      try {
        // The operation gate blocks new terrain requests while switching worlds.
        // Wait for any read-only map tiles that started just before the gate closed.
        await mapReadBarrier.drain();

        if (storageHealth.isRestartRequired()) {
          const publicMessage =
            storageHealth.getRestartMessage() ||
            "Restart the editor before performing another world operation.";

          const candidateClosed = await closeManagerOrQuarantine(
            candidate.manager,
            "Failed closing uncommitted candidate after a fatal map-read storage state:"
          );

          if (!candidateClosed) {
            throw new RestartRequiredStorageError(
              "STORAGE_CLOSE_FAILED",
              (
                "The editor entered a restart-required storage state and the uncommitted " +
                "candidate world database could not be closed safely. Restart the editor " +
                "before performing another world operation."
              ),
              {
                previousRestartMessage: publicMessage
              }
            );
          }

          throw new RestartRequiredStorageError(
            "STORAGE_CLOSE_FAILED",
            publicMessage,
            {
              context:
                "Storage became restart-required while draining map reads before previous-world close."
            }
          );
        }

        await previousManager.close();
        storageHealth.release(previousManager);
      } catch (error) {
        console.error(
          "Failed closing previous world before candidate commit:",
          error
        );

        storageHealth.quarantine(
          previousManager,
          "The previously active world database could not be closed safely. Restart the editor before switching worlds."
        );

        await closeManagerOrQuarantine(
          candidate.manager,
          "Failed closing uncommitted candidate manager:"
        );

        throw new RestartRequiredStorageError(
          "STORAGE_CLOSE_FAILED",
          "The previously active world database could not be closed safely. " +
            "Restart the editor before switching worlds.",
          error instanceof Error ? error.message : String(error)
        );
      }
    }

    activeDbManager = candidate.manager;
    activeSession = candidate.session;
  }

  // 1. List detected worlds
  handleTrusted<WorldChoice[]>("world:list", mainWindow, async () => {
    worldHandleMap.clear();
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

    const choices: WorldChoice[] = [];

    for (const root of roots) {
      if (!fs.existsSync(root)) continue;

      try {
        const entries = fs.readdirSync(root, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          const fullPath = path.join(root, entry.name);
          const dbPath = path.join(fullPath, "db");
          if (!fs.existsSync(dbPath)) continue;

          let worldName = entry.name;
          const levelNameFile = path.join(fullPath, "levelname.txt");
          if (fs.existsSync(levelNameFile)) {
            try {
              worldName = fs.readFileSync(levelNameFile, "utf8").trim() || worldName;
            } catch {}
          }

          let lastPlayed = 0;
          try {
            lastPlayed = fs.statSync(fullPath).mtimeMs;
          } catch {}

          let iconDataUrl: string | undefined;
          const iconPath = path.join(fullPath, "world_icon.jpeg");
          if (fs.existsSync(iconPath)) {
            try {
              const buf = fs.readFileSync(iconPath);
              iconDataUrl = `data:image/jpeg;base64,${buf.toString("base64")}`;
            } catch {}
          }

          choices.push({
            handle: createHandle(fullPath),
            folderName: entry.name,
            name: worldName,
            lastPlayed,
            iconDataUrl,
            isLocked: false
          });
        }
      } catch {}
    }

    return choices.sort((a, b) => b.lastPlayed - a.lastPlayed);
  });

  // 2. Open World (with unsaved changes protection & atomic candidate load)
  handleTrusted<WorldOpenResult>(
    "world:open",
    mainWindow,
    async (_event, handle: string) => {
      requireStorageHealthy();

      if (activeSession && activeSession.getDirtyCount() > 0) {
        return {
          success: false,
          error: "UNSAVED_CHANGES"
        };
      }

      const worldPath = resolveHandle(handle);
      if (!worldPath || !fs.existsSync(worldPath)) {
        return {
          success: false,
          error: "Invalid or expired world handle."
        };
      }

      return operationGate.run("Opening world", async () => {
        try {
          await mapReadBarrier.drainAndRequireHealthy(
            storageHealth,
            "Opening world"
          );
          const candidate = await openCandidateWorld(worldPath);
          await commitCandidateWorld(candidate);

          return {
            success: true,
            snapshot: {
              worldName: candidate.session.getWorldName(),
              villagerCount: candidate.session.getVillagerCount(),
              summary: candidate.session.getSummary(),
              villagers: candidate.session.getVillagers()
            }
          };
        } catch (err) {
          console.error("World open failed:", err);

          if (isRestartRequiredStorageError(err)) {
            markStorageRestartRequired(err.publicMessage);
            return {
              success: false,
              restartRequired: true,
              error: err.publicMessage
            };
          }

          return {
            success: false,
            error: publicStorageError(
              err,
              "Could not open the selected Bedrock world. Ensure Minecraft is closed and the world database is accessible."
            )
          };
        }
      });
    }
  );

  // 3. Close World
  handleTrusted<{ success: boolean; restartRequired?: boolean; error?: string }>(
    "world:close",
    mainWindow,
    async () => {
      return operationGate.run("Closing world", async () => {
        if (activeSession && activeSession.getDirtyCount() > 0) {
          return {
            success: false,
            error: "UNSAVED_CHANGES"
          };
        }

        const manager = activeDbManager;

        if (manager) {
          try {
            await mapReadBarrier.drain();
            await manager.close();
            storageHealth.release(manager);
          } catch (error) {
            console.error("Failed to close active world database:", error);
            storageHealth.quarantine(
              manager,
              "A world database could not be closed safely. Restart the editor before performing another world operation."
            );
            return {
              success: false,
              restartRequired: true,
              error:
                "Could not close the active world database safely. Restart the editor before switching worlds."
            };
          }
        }

        activeDbManager = null;
        activeSession = null;

        if (storageHealth.isRestartRequired()) {
          return {
            success: true,
            restartRequired: true,
            error:
              storageHealth.getRestartMessage() ||
              "Restart the editor before performing another world operation."
          };
        }

        return { success: true };
      });
    }
  );

  // 4. Discard active session changes
  handleTrusted<{ success: boolean; restartRequired?: boolean; error?: string }>(
    "session:discardChanges",
    mainWindow,
    async () => {
      requireStorageHealthy();

      return operationGate.run("Discarding changes", async () => {
        if (!activeDbManager) {
          activeSession = null;
          return { success: true };
        }

        try {
          await mapReadBarrier.drainAndRequireHealthy(
            storageHealth,
            "Discarding changes"
          );
          const dump = await activeDbManager.dumpVillagers();
          activeSession = new WorldSession(dump);
          return { success: true };
        } catch (error) {
          console.error(
            "Failed to reload world while discarding session changes:",
            error
          );

          if (isRestartRequiredStorageError(error)) {
            console.error("Fatal storage error while discarding changes:", {
              code: error.code,
              debugDetail: error.debugDetail
            });

            return await handleRestartRequiredStorageFailure(error, {
              storageHealth,
              manager: activeDbManager,
              clearSession: () => {
                activeSession = null;
              },
              clearManager: (m) => {
                if (activeDbManager === m) activeDbManager = null;
              }
            });
          }

          return {
            success: false,
            error:
              "Could not reload the active world to discard changes. Keep the editor open and reopen the world before continuing."
          };
        }
      });
    }
  );

  // 5. List Villagers View Models
  handleTrusted<VillagerViewModel[]>("villager:list", mainWindow, async () => {
    if (!activeSession) throw new Error("No active world session.");
    return activeSession.getVillagers();
  });

  // 6. Read-only overhead world-map terrain tile
  handleTrusted<WorldMapTileResult>(
    "world:mapTile",
    mainWindow,
    async (_event, rawRequest: unknown) => {
      requireStorageHealthy();

      if (!activeDbManager || !activeSession) {
        return {
          success: false,
          error: "No active world session."
        };
      }

      if (operationGate.current) {
        return {
          success: false,
          error: `Map terrain is unavailable while ${operationGate.current} is in progress.`
        };
      }

      const parsed = worldMapTileRequestSchema.safeParse(rawRequest);
      if (!parsed.success) {
        return {
          success: false,
          error: "Invalid world-map tile request."
        };
      }

      const manager = activeDbManager;

      return await mapReadBarrier.run(async () => {
        try {
          const tile = await manager.getWorldMapTile(parsed.data);
          return { success: true, tile };
        } catch (error) {
          if (isRestartRequiredStorageError(error)) {
            console.error("Fatal storage error during read-only map tile rendering:", {
              code: error.code,
              debugDetail: error.debugDetail
            });

            activeSession = null;

            storageHealth.quarantine(
              manager,
              error.publicMessage
            );

            return {
              success: false,
              restartRequired: true,
              error: error.publicMessage
            };
          }

          console.warn(
            "Read-only map tile rendering failed:",
            error instanceof Error ? error.message : String(error)
          );
          return {
            success: false,
            error: "Could not read terrain for this map tile."
          };
        }
      });
    }
  );

  // 7. Get Villager Debug Info
  handleTrusted<VillagerDebugInfo | null>(
    "villager:debug",
    mainWindow,
    async (_event, villagerId: string) => {
      if (!activeSession) throw new Error("No active world session.");
      return activeSession.getVillagerDebugInfo(villagerId);
    }
  );

  // 7. Diagnostics
  handleTrusted<any>("diagnostics:professions", mainWindow, async () => {
    if (!activeSession) throw new Error("No active world session.");
    const villagers = activeSession.getVillagers();
    const sourceBreakdown: Record<string, number> = {};
    const unknownEntities: any[] = [];

    for (const v of villagers) {
      const src = v.professionSource || "none";
      sourceBreakdown[src] = (sourceBreakdown[src] || 0) + 1;
      if (!v.professionKnown) {
        unknownEntities.push({
          id: v.sessionVillagerId,
          name: v.customName,
          profession: v.profession,
          pos: v.position
        });
      }
    }

    return {
      totalVillagers: villagers.length,
      sourceBreakdown,
      unknownCount: unknownEntities.length,
      unknownEntities
    };
  });

  // 8. Session Command Execution
  handleTrusted<any>(
    "session:command",
    mainWindow,
    async (_event, rawCommand: unknown) => {
      if (storageHealth.isRestartRequired()) {
        return {
          success: false,
          canUndo: false,
          canRedo: false,
          error:
            storageHealth.getRestartMessage() ||
            "Restart the editor before performing another world operation."
        };
      }

      if (operationGate.current) {
        return {
          success: false,
          canUndo: activeSession?.canUndo() || false,
          canRedo: activeSession?.canRedo() || false,
          error: `Cannot edit while ${operationGate.current} is in progress.`
        };
      }
      if (!activeSession) throw new Error("No active world session.");
      const parsed = sessionCommandSchema.safeParse(rawCommand);
      if (!parsed.success) {
        return {
          success: false,
          error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
        };
      }
      return activeSession.executeRequest(parsed.data);
    }
  );

  // 9. Session Undo & Redo & State
  handleTrusted<any>("session:undo", mainWindow, async () => {
    if (storageHealth.isRestartRequired()) {
      return {
        success: false,
        error:
          storageHealth.getRestartMessage() ||
          "Restart the editor before performing another world operation."
      };
    }

    if (operationGate.current) {
      return {
        success: false,
        error: `Cannot undo while ${operationGate.current} is in progress.`
      };
    }
    if (!activeSession) throw new Error("No active world session.");
    return activeSession.undo();
  });

  handleTrusted<any>("session:redo", mainWindow, async () => {
    if (storageHealth.isRestartRequired()) {
      return {
        success: false,
        error:
          storageHealth.getRestartMessage() ||
          "Restart the editor before performing another world operation."
      };
    }

    if (operationGate.current) {
      return {
        success: false,
        error: `Cannot redo while ${operationGate.current} is in progress.`
      };
    }
    if (!activeSession) throw new Error("No active world session.");
    return activeSession.redo();
  });

  handleTrusted<SessionStateSnapshot>("session:state", mainWindow, async () => {
    const base = activeSession
      ? activeSession.getStateSnapshot()
      : {
          dirtyCount: 0,
          canUndo: false,
          canRedo: false,
          worldName: null,
          busyOperation: null,
          restartRequired: false
        };

    return {
      ...base,
      busyOperation: operationGate.current,
      restartRequired: storageHealth.isRestartRequired(),
      restartMessage: storageHealth.isRestartRequired() ? storageHealth.getRestartMessage() : undefined
    };
  });

  handleTrusted<number>("session:dirtyCount", mainWindow, async () => {
    return activeSession ? activeSession.getDirtyCount() : 0;
  });

  // 10. Save Preview & Execution
  handleTrusted<SavePreview>(
    "world:savePreview",
    mainWindow,
    async () => {
      requireStorageHealthy();

      return operationGate.run(
        "Preparing save review",
        async () => {
          if (
            !activeSession ||
            !activeDbManager
          ) {
            throw new Error(
              "No active world session."
            );
          }

          const preview =
            activeSession
              .getSavePreview();

          try {
            await mapReadBarrier.drainAndRequireHealthy(
              storageHealth,
              "Preparing save review"
            );
            const hasConflicts =
              await activeDbManager
                .hasWriteConflicts(
                  activeSession
                    .getDirtyWrites()
                );

            return {
              ...preview,
              hasConflicts
            };
          } catch (error) {
            console.error(
              "Save-preview conflict check failed:",
              error
            );

            if (
              isRestartRequiredStorageError(
                error
              )
            ) {
              console.error(
                "Fatal storage error during Save Preview:",
                {
                  code:
                    error.code,
                  debugDetail:
                    error
                      .debugDetail
                }
              );

              await handleRestartRequiredStorageFailure(
                error,
                {
                  storageHealth,
                  manager:
                    activeDbManager,
                  clearSession:
                    () => {
                      activeSession =
                        null;
                    },
                  clearManager:
                    (manager) => {
                      if (
                        activeDbManager ===
                        manager
                      ) {
                        activeDbManager =
                          null;
                      }
                    }
                }
              );

              return {
                ...preview,
                hasConflicts:
                  true,
                restartRequired:
                  true,
                conflictCheckError:
                  error
                    .publicMessage
              };
            }

            return {
              ...preview,
              hasConflicts:
                true,
              conflictCheckError:
                (
                  "The editor could not safely verify the live world state. " +
                  "Save is disabled. Ensure Minecraft is closed and reopen the world."
                )
            };
          }
        }
      );
    }
  );

  handleTrusted<SaveResult>("world:save", mainWindow, async () => {
    requireStorageHealthy();

    return operationGate.run("Saving world", async () => {
      if (!activeSession || !activeDbManager) throw new Error("No active world session.");
      const dirtyWrites = activeSession.getDirtyWrites();
      if (dirtyWrites.length === 0) {
        return {
          success: true,
          modifiedCount: 0,
          verifiedCount: 0,
          backupCreated: false
        };
      }

      let result;
      try {
        await mapReadBarrier.drainAndRequireHealthy(
          storageHealth,
          "Saving world"
        );
        result = await activeDbManager.applyDirtyVillagers(dirtyWrites, {
          createBackup: true
        });
      } catch (err) {
        console.error("World database save failed:", err);

        if (isRestartRequiredStorageError(err)) {
          console.error("Fatal save storage error:", {
            code: err.code,
            debugDetail: err.debugDetail
          });

          return await handleRestartRequiredStorageFailure(err, {
            storageHealth,
            manager: activeDbManager,
            clearSession: () => {
              activeSession = null;
            },
            clearManager: (m) => {
              if (activeDbManager === m) activeDbManager = null;
            }
          });
        }

        return {
          success: false,
          error: publicStorageError(
            err,
            "World database save failed. Ensure Minecraft is closed, reopen the world, and try again."
          )
        };
      }

      const backupId = result.backupPath
        ? activeDbManager.getBackupIdForPath(result.backupPath)
        : undefined;

      try {
        const dump = await activeDbManager.dumpVillagers();
        activeSession = new WorldSession(dump);

        return {
          success: true,
          modifiedCount: result.modifiedCount,
          verifiedCount: result.verifiedCount,
          backupCreated: Boolean(result.backupPath),
          backupId,
          warning: result.closeWarning
        };
      } catch (reloadError) {
        console.error("Save committed, but canonical reload failed:", reloadError);

        if (
          isRestartRequiredStorageError(
            reloadError
          )
        ) {
          console.error(
            "Fatal storage error during post-save canonical reload:",
            {
              code:
                reloadError.code,
              debugDetail:
                reloadError.debugDetail
            }
          );

          const committedFatal =
            await handleCommittedRestartRequiredStorageFailure(
              reloadError,
              {
                storageHealth,
                manager:
                  activeDbManager,
                clearSession:
                  () => {
                    activeSession =
                      null;
                  },
                clearManager:
                  (manager) => {
                    if (
                      activeDbManager ===
                      manager
                    ) {
                      activeDbManager =
                        null;
                    }
                  }
              },
              (
                "The save was committed and verified, but the world database became unsafe during canonical reload. " +
                "Restart the editor before opening or editing another world."
              )
            );

          return {
            ...committedFatal,
            modifiedCount:
              result.modifiedCount,
            verifiedCount:
              result.verifiedCount,
            backupCreated:
              Boolean(
                result.backupPath
              ),
            backupId
          };
        }

        const manager = activeDbManager!;
        const quarantine = await quarantineAfterReloadFailure(manager, {
          clearSession: () => {
            activeSession = null;
          },
          clearManager: () => {
            if (activeDbManager === manager) activeDbManager = null;
          },
          retainManager: (m) => {
            activeDbManager = m;
          }
        });

        const warningMsg = quarantine.managerClosed
          ? (result.closeWarning
              ? `${result.closeWarning} Reopen the world before making further edits.`
              : "The save was committed and verified, but the editor could not reload the world. Reopen the world before making further edits.")
          : "The save was committed and verified, but the world database could not be closed cleanly afterward. Restart the editor before opening or editing a world.";

        if (!quarantine.managerClosed) {
          storageHealth.quarantine(
            manager,
            "A world database could not be closed safely. Restart the editor before performing another world operation."
          );
        }

        return {
          success: true,
          modifiedCount: result.modifiedCount,
          verifiedCount: result.verifiedCount,
          backupCreated: Boolean(result.backupPath),
          backupId,
          reloadRequired: true,
          restartRequired: !quarantine.managerClosed,
          warning: warningMsg
        };
      }
    });
  });

  // 11. Backups Management
  handleTrusted<{ success: boolean; backupId?: string; restartRequired?: boolean; error?: string }>(
    "world:backup",
    mainWindow,
    async () => {
      requireStorageHealthy();

      return operationGate.run("Creating backup", async () => {
        if (!activeDbManager) {
          return {
            success: false,
            error: "No active world."
          };
        }

        try {
          await mapReadBarrier.drainAndRequireHealthy(
            storageHealth,
            "Creating backup"
          );
          const backupPath = await activeDbManager.createBackup();
          return {
            success: true,
            backupId: activeDbManager.getBackupIdForPath(backupPath)
          };
        } catch (error) {
          console.error("Manual backup creation failed:", error);

          if (isRestartRequiredStorageError(error)) {
            console.error("Fatal storage error during manual backup:", {
              code: error.code,
              debugDetail: error.debugDetail
            });

            return await handleRestartRequiredStorageFailure(error, {
              storageHealth,
              manager: activeDbManager,
              clearSession: () => {
                activeSession = null;
              },
              clearManager: (m) => {
                if (activeDbManager === m) activeDbManager = null;
              }
            });
          }

          return {
            success: false,
            error: "Could not create the world backup. Ensure the world is accessible and try again."
          };
        }
      });
    }
  );

  handleTrusted<BackupSummary[]>("backup:list", mainWindow, async () => {
    if (!activeDbManager) return [];
    try {
      return await activeDbManager.listBackups();
    } catch (error) {
      console.error("Backup list failed:", error);
      throw new Error("Could not read the backup list.");
    }
  });

  handleTrusted<{
    success: boolean;
    reloadRequired?: boolean;
    restartRequired?: boolean;
    warning?: string;
    error?: string;
  }>("backup:restore", mainWindow, async (_event, backupId: string) => {
    requireStorageHealthy();

    if (!activeDbManager) throw new Error("No active world.");
    const parsed = backupIdSchema.safeParse(backupId);
    if (!parsed.success) {
      return { success: false, error: "Invalid backup ID." };
    }

    if (activeSession && activeSession.getDirtyCount() > 0) {
      return {
        success: false,
        error: "UNSAVED_CHANGES"
      };
    }

    return operationGate.run("Restoring backup", async () => {
      try {
        await mapReadBarrier.drainAndRequireHealthy(
          storageHealth,
          "Restoring backup"
        );
        const restoreRes = await activeDbManager!.restoreBackupById(backupId);

        try {
          const dump = await activeDbManager!.dumpVillagers();
          activeSession = new WorldSession(dump);
          return {
            success: true,
            warning: restoreRes.warning
          };
        } catch (reloadError) {
          console.error("Restore committed, but canonical reload failed:", reloadError);

          if (
            isRestartRequiredStorageError(
              reloadError
            )
          ) {
            console.error(
              "Fatal storage error during post-restore canonical reload:",
              {
                code:
                  reloadError.code,
                debugDetail:
                  reloadError.debugDetail
              }
            );

            return await handleCommittedRestartRequiredStorageFailure(
              reloadError,
              {
                storageHealth,
                manager:
                  activeDbManager,
                clearSession:
                  () => {
                    activeSession =
                      null;
                  },
                clearManager:
                  (manager) => {
                    if (
                      activeDbManager ===
                      manager
                    ) {
                      activeDbManager =
                        null;
                    }
                  }
              },
              (
                "The backup was restored, but the world database became unsafe during canonical reload. " +
                "Restart the editor before opening or editing another world."
              )
            );
          }

          const manager = activeDbManager!;
          const quarantine = await quarantineAfterReloadFailure(manager, {
            clearSession: () => {
              activeSession = null;
            },
            clearManager: () => {
              if (activeDbManager === manager) activeDbManager = null;
            },
            retainManager: (m) => {
              activeDbManager = m;
            }
          });

          if (!quarantine.managerClosed) {
            storageHealth.quarantine(
              manager,
              "A world database could not be closed safely. Restart the editor before performing another world operation."
            );
          }

          return {
            success: true,
            reloadRequired: true,
            restartRequired: !quarantine.managerClosed,
            warning: quarantine.managerClosed
              ? "The backup was restored, but the editor could not reload the world. Reopen the world before making further edits."
              : "The backup was restored, but the world database could not be closed cleanly afterward. Restart the editor before opening or editing a world."
          };
        }
      } catch (err) {
        console.error("Restore failed:", err);

        if (isRestartRequiredStorageError(err)) {
          console.error("Fatal restore storage error:", {
            code: err.code,
            debugDetail: err.debugDetail
          });

          return await handleRestartRequiredStorageFailure(err, {
            storageHealth,
            manager: activeDbManager,
            clearSession: () => {
              activeSession = null;
            },
            clearManager: (m) => {
              if (activeDbManager === m) activeDbManager = null;
            }
          });
        }

        return {
          success: false,
          error: publicStorageError(
            err,
            "Backup restore failed. The live world was not replaced unless the staged restore completed successfully. See application logs for technical details."
          )
        };
      }
    });
  });

  handleTrusted<{ success: boolean; error?: string }>(
    "backup:delete",
    mainWindow,
    async (_event, backupId: string) => {
      requireStorageHealthy();

      return operationGate.run("Deleting backup", async () => {
        if (!activeDbManager) throw new Error("No active world.");
        const parsed = backupIdSchema.safeParse(backupId);
        if (!parsed.success) {
          return { success: false, error: "Invalid backup ID." };
        }
        try {
          await activeDbManager.deleteBackupById(backupId);
          return { success: true };
        } catch (err) {
          console.error("Delete backup failed:", err);
          return {
            success: false,
            error: publicStorageError(err, "Could not delete the selected backup.")
          };
        }
      });
    }
  );

  handleTrusted<{ success: boolean; error?: string }>(
    "backup:reveal",
    mainWindow,
    async () => {
      if (!activeDbManager) {
        return {
          success: false,
          error: "No active world."
        };
      }

      const backupDir = activeDbManager.getBackupRoot();
      try {
        if (!fs.existsSync(backupDir)) {
          fs.mkdirSync(backupDir, { recursive: true });
        }

        const openError = await shell.openPath(backupDir);
        if (openError) {
          console.error("OS could not open backup folder:", openError);
          return {
            success: false,
            error: "Could not open the backup folder."
          };
        }

        return { success: true };
      } catch (error) {
        console.error("Reveal backup folder failed:", error);
        return {
          success: false,
          error: "Could not open the backup folder."
        };
      }
    }
  );

  // 12. Folder Dialog
  handleTrusted<WorldOpenResult>(
    "dialog:chooseFolder",
    mainWindow,
    async () => {
      requireStorageHealthy();

      if (activeSession && activeSession.getDirtyCount() > 0) {
        return {
          success: false,
          error: "UNSAVED_CHANGES"
        };
      }

      return operationGate.run("Choosing world folder", async () => {
        const res = await dialog.showOpenDialog(mainWindow, {
          properties: ["openDirectory"],
          title: "Select Minecraft Bedrock World Folder"
        });

        if (res.canceled || res.filePaths.length === 0) {
          return { success: false, canceled: true };
        }

        const worldPath = res.filePaths[0]!;

        try {
          await mapReadBarrier.drainAndRequireHealthy(
            storageHealth,
            "Opening world"
          );
          const candidate = await openCandidateWorld(worldPath);
          await commitCandidateWorld(candidate);

          return {
            success: true,
            snapshot: {
              worldName: candidate.session.getWorldName(),
              villagerCount: candidate.session.getVillagerCount(),
              summary: candidate.session.getSummary(),
              villagers: candidate.session.getVillagers()
            }
          };
        } catch (error) {
          if (isRestartRequiredStorageError(error)) {
            markStorageRestartRequired(error.publicMessage);
            return {
              success: false,
              restartRequired: true,
              error: error.publicMessage
            };
          }

          console.error("Error opening chosen folder:", error);
          return {
            success: false,
            error:
              "Could not open the selected folder. Ensure it contains a valid Bedrock world with levelname.txt and a LevelDB database."
          };
        }
      });
    }
  );

  // 13. Metadata
  handleTrusted<any>("metadata:get", mainWindow, async () => {
    return {
      professions: getAllProfessions(),
      enchantments: BEDROCK_ENCHANTMENTS
    };
  });

  // 14. Export Villagers to JSON
  handleTrusted<{ success: boolean; filePath?: string; canceled?: boolean; error?: string }>(
    "villager:exportJson",
    mainWindow,
    async () => {
      if (storageHealth.isRestartRequired()) {
        return { success: false, error: storageHealth.getRestartMessage() || "Restart required." };
      }
      if (operationGate.current) {
        return { success: false, error: `Cannot export while ${operationGate.current} is in progress.` };
      }
      if (!activeSession) {
        return { success: false, error: "No world is currently open." };
      }

      const rawWorldName = activeSession.getWorldName() || "world";
      const sanitized = rawWorldName.replace(/[^a-zA-Z0-9_\-]/g, "_");
      const defaultFilename = `villagers_${sanitized}.json`;

      const saveResult = await dialog.showSaveDialog(mainWindow, {
        title: "Export Villagers to JSON",
        defaultPath: defaultFilename,
        filters: [{ name: "JSON Files", extensions: ["json"] }]
      });

      if (saveResult.canceled || !saveResult.filePath) {
        return { success: false, canceled: true };
      }

      if (storageHealth.isRestartRequired()) {
        return { success: false, error: storageHealth.getRestartMessage() || "Restart required." };
      }
      if (operationGate.current) {
        return { success: false, error: `Cannot export while ${operationGate.current} is in progress.` };
      }
      if (!activeSession) {
        return { success: false, error: "No world is currently open." };
      }

      return await operationGate.run("Exporting villager JSON", async () => {
        if (storageHealth.isRestartRequired()) {
          return { success: false, error: storageHealth.getRestartMessage() || "Restart required." };
        }
        if (!activeSession) {
          return { success: false, error: "No world is currently open." };
        }
        try {
          const jsonContent = exportVillagersToJson(activeSession);
          fs.writeFileSync(saveResult.filePath!, jsonContent, "utf8");
          return { success: true, filePath: saveResult.filePath };
        } catch (err: any) {
          return { success: false, error: err.message || "Failed to write export JSON file." };
        }
      });
    }
  );

  // 15. Import Villagers from JSON
  handleTrusted<{ success: boolean; modifiedCount?: number; canceled?: boolean; error?: string }>(
    "villager:importJson",
    mainWindow,
    async () => {
      if (storageHealth.isRestartRequired()) {
        return { success: false, error: storageHealth.getRestartMessage() || "Restart required." };
      }
      if (operationGate.current) {
        return { success: false, error: `Cannot import while ${operationGate.current} is in progress.` };
      }
      if (!activeSession) {
        return { success: false, error: "No world is currently open." };
      }

      const openResult = await dialog.showOpenDialog(mainWindow, {
        title: "Import Villagers from JSON",
        filters: [{ name: "JSON Files", extensions: ["json"] }],
        properties: ["openFile"]
      });

      if (openResult.canceled || openResult.filePaths.length === 0) {
        return { success: false, canceled: true };
      }

      if (storageHealth.isRestartRequired()) {
        return { success: false, error: storageHealth.getRestartMessage() || "Restart required." };
      }
      if (operationGate.current) {
        return { success: false, error: `Cannot import while ${operationGate.current} is in progress.` };
      }
      if (!activeSession) {
        return { success: false, error: "No world is currently open." };
      }

      const selectedPath = openResult.filePaths[0]!;

      return await operationGate.run("Importing villager JSON", async () => {
        if (storageHealth.isRestartRequired()) {
          return { success: false, error: storageHealth.getRestartMessage() || "Restart required." };
        }
        if (!activeSession) {
          return { success: false, error: "No world is currently open." };
        }
        try {
          const jsonContent = fs.readFileSync(selectedPath, "utf8");
          const importResult = importVillagersFromJson(activeSession, jsonContent);
          return importResult;
        } catch (err: any) {
          return { success: false, modifiedCount: 0, error: err.message || "Failed to read JSON file." };
        }
      });
    }
  );

  return {
    getSessionState: () => {
      const base = activeSession
        ? activeSession.getStateSnapshot()
        : {
            dirtyCount: 0,
            canUndo: false,
            canRedo: false,
            worldName: null,
            busyOperation: null,
            restartRequired: false
          };

      return {
        ...base,
        busyOperation: operationGate.current,
        restartRequired: storageHealth.isRestartRequired(),
        restartMessage: storageHealth.isRestartRequired() ? storageHealth.getRestartMessage() : undefined
      };
    },
    disposeStorage: async () => {
      activeSession = null;
      await mapReadBarrier.drain();
      const allClosed = await storageHealth.disposeAll(activeDbManager);
      if (allClosed) {
        activeDbManager = null;
      }
      return { success: allClosed };
    }
  };
}
