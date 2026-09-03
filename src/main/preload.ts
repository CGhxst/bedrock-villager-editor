import { contextBridge, ipcRenderer } from "electron";
import {
  BackupSummary,
  SavePreview,
  SaveResult,
  SessionCommandRequest,
  SessionCommandResult,
  SessionStateSnapshot,
  VillagerDebugInfo,
  VillagerViewModel,
  WorldChoice,
  WorldMapTileRequest,
  WorldMapTileResult,
  WorldOpenResult
} from "../core/types";

export interface VillagerEditorApi {
  listWorlds: () => Promise<WorldChoice[]>;
  openWorld: (handle: string) => Promise<WorldOpenResult>;
  chooseFolder: () => Promise<WorldOpenResult>;
  closeWorld: () => Promise<{ success: boolean; restartRequired?: boolean; error?: string }>;
  listVillagers: () => Promise<VillagerViewModel[]>;
  getWorldMapTile: (request: WorldMapTileRequest) => Promise<WorldMapTileResult>;
  getVillagerDebugInfo: (villagerId: string) => Promise<VillagerDebugInfo | null>;
  getProfessionDiagnostics: () => Promise<any>;
  executeCommand: (command: SessionCommandRequest) => Promise<SessionCommandResult>;
  undo: () => Promise<SessionCommandResult>;
  redo: () => Promise<SessionCommandResult>;
  getSessionState: () => Promise<SessionStateSnapshot>;
  getDirtyCount: () => Promise<number>;
  discardChanges: () =>
    Promise<{ success: boolean; restartRequired?: boolean; error?: string }>;
  getSavePreview: () => Promise<SavePreview>;
  saveToWorld: () => Promise<SaveResult>;
  createBackup: () =>
    Promise<{ success: boolean; backupId?: string; restartRequired?: boolean; error?: string }>;
  listBackups: () => Promise<BackupSummary[]>;
  restoreBackup: (backupId: string) => Promise<{
    success: boolean;
    reloadRequired?: boolean;
    restartRequired?: boolean;
    warning?: string;
    error?: string;
  }>;
  deleteBackup: (backupId: string) => Promise<{ success: boolean; error?: string }>;
  revealBackupFolder: () => Promise<{ success: boolean; error?: string }>;
  exportVillagersJson: () => Promise<{ success: boolean; filePath?: string; canceled?: boolean; error?: string }>;
  importVillagersJson: () => Promise<{ success: boolean; modifiedCount?: number; canceled?: boolean; error?: string }>;
  getMetadata: () => Promise<any>;
}

const api: VillagerEditorApi = {
  listWorlds: () => ipcRenderer.invoke("world:list"),
  openWorld: (handle: string) => ipcRenderer.invoke("world:open", handle),
  chooseFolder: () => ipcRenderer.invoke("dialog:chooseFolder"),
  closeWorld: () => ipcRenderer.invoke("world:close"),
  listVillagers: () => ipcRenderer.invoke("villager:list"),
  getWorldMapTile: (request: WorldMapTileRequest) =>
    ipcRenderer.invoke("world:mapTile", request),
  getVillagerDebugInfo: (villagerId: string) =>
    ipcRenderer.invoke("villager:debug", villagerId),
  getProfessionDiagnostics: () =>
    ipcRenderer.invoke("diagnostics:professions"),
  executeCommand: (command: SessionCommandRequest) =>
    ipcRenderer.invoke("session:command", command),
  undo: () => ipcRenderer.invoke("session:undo"),
  redo: () => ipcRenderer.invoke("session:redo"),
  getSessionState: () => ipcRenderer.invoke("session:state"),
  getDirtyCount: () => ipcRenderer.invoke("session:dirtyCount"),
  discardChanges: () => ipcRenderer.invoke("session:discardChanges"),
  getSavePreview: () => ipcRenderer.invoke("world:savePreview"),
  saveToWorld: () => ipcRenderer.invoke("world:save"),
  createBackup: () => ipcRenderer.invoke("world:backup"),
  listBackups: () => ipcRenderer.invoke("backup:list"),
  restoreBackup: (backupId: string) =>
    ipcRenderer.invoke("backup:restore", backupId),
  deleteBackup: (backupId: string) =>
    ipcRenderer.invoke("backup:delete", backupId),
  revealBackupFolder: () => ipcRenderer.invoke("backup:reveal"),
  exportVillagersJson: () => ipcRenderer.invoke("villager:exportJson"),
  importVillagersJson: () => ipcRenderer.invoke("villager:importJson"),
  getMetadata: () => ipcRenderer.invoke("metadata:get")
};

contextBridge.exposeInMainWorld("api", api);
