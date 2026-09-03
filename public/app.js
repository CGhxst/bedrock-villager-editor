/**
 * Minecraft Bedrock Villager Editor - Renderer Controller
 * Communicates exclusively with main process via typed Preload IPC API.
 * Strict DOM security: zero dynamic HTML interpolation, zero inline onclick/onerror.
 */

// Application State
let activeVillagers = [];
let selectedVillagerId = null;
let activeWorldSummary = null;
let dirtyCount = 0;
let detectedWorlds = [];
let worldSearchQuery = "";
let villagerSearchQuery = "";
let selectedProfessionFilter = "all";
let selectedTierFilter = "all";
let metadata = { professions: {}, enchantments: {} };
let currentProfessionDiagnostics = null;

let localUiBusy = false;
let localUiBusyLabel = "";
let localRestartRequired = false;
let localRestartMessage = "";

let lastSessionState = {
  dirtyCount: 0,
  canUndo: false,
  canRedo: false,
  worldName: null,
  busyOperation: null,
  restartRequired: false
};

// Item / Enchantment Picker State
let activeItemPickerContext = null; // { villagerId, tradeId, slot }
let customItemCatalog = [];

// Read-only world-map state. Terrain tiles are derived from Bedrock heightmaps;
// villager markers are always drawn separately from activeVillagers.
const WORLD_MAP_TILE_BLOCKS = 128;
const WORLD_MAP_MIN_ZOOM = 0.125;
const WORLD_MAP_MAX_ZOOM = 16;
const WORLD_MAP_DEFAULT_ZOOM = 2;
const WORLD_MAP_MAX_REQUESTED_TILES = 64;
const WORLD_MAP_MAX_CACHED_TILES = 128;
const WORLD_MAP_MAX_CONCURRENT_TILE_LOADS = 4;

const worldMapState = {
  worldGeneration: 0,
  dimensionId: 0,
  centerX: 0,
  centerZ: 0,
  zoom: WORLD_MAP_DEFAULT_ZOOM,
  cssWidth: 1,
  cssHeight: 1,
  tileCache: new Map(),
  pendingTiles: new Map(),
  tileQueue: [],
  queuedTileKeys: new Set(),
  activeTileLoads: 0,
  markerHitboxes: [],
  iconCache: new Map(),
  dragging: false,
  dragMoved: false,
  dragStartClientX: 0,
  dragStartClientY: 0,
  dragStartCenterX: 0,
  dragStartCenterZ: 0,
  lastPointerClientX: 0,
  lastPointerClientY: 0
};

// DOM References
const worldPickerView = document.getElementById("worldPickerView");
const villagerEditorView = document.getElementById("villagerEditorView");
const worldBreadcrumb = document.getElementById("worldBreadcrumb");
const currentWorldName = document.getElementById("currentWorldName");
const sessionControls = document.getElementById("sessionControls");
const btnUndo = document.getElementById("btnUndo");
const btnRedo = document.getElementById("btnRedo");
const dirtyIndicator = document.getElementById("dirtyIndicator");
const btnBulkActionsMenu = document.getElementById("btnBulkActionsMenu");
const btnBackupsMenu = document.getElementById("btnBackupsMenu");
const btnSaveToWorld = document.getElementById("btnSaveToWorld");
const toastContainer = document.getElementById("toastContainer");
const unknownProfessionBanner = document.getElementById("unknownProfessionBanner");
const unknownProfessionBannerText = document.getElementById("unknownProfessionBannerText");
const restartRequiredBanner = document.getElementById("restartRequiredBanner");
const restartRequiredBannerText = document.getElementById("restartRequiredBannerText");

// Initialize on DOM Load
window.addEventListener("DOMContentLoaded", async () => {
  try {
    metadata = await api.getMetadata();
  } catch (e) {
    console.error("Failed to load metadata:", e);
  }

  setupEventListeners();
  loadWorldPicker();
});

function enterRestartRequiredState(message) {
  localRestartRequired = true;
  localRestartMessage = String(
    message ||
      "Restart the editor before performing another world operation."
  );

  if (restartRequiredBannerText) {
    restartRequiredBannerText.textContent = localRestartMessage;
  }

  if (restartRequiredBanner) {
    restartRequiredBanner.classList.remove("hidden");
  }

  resetLoadedWorldUi();
  applyControlState();
}

function isAnyOperationBusy() {
  return Boolean(
    localUiBusy ||
      localRestartRequired ||
      lastSessionState?.busyOperation ||
      lastSessionState?.restartRequired
  );
}

// -------------------------------------------------------------
// Minecraft Formatting Codes & Display Formatting Helpers
// -------------------------------------------------------------

const MC_COLOR_CODES = {
  "0": "#000000",
  "1": "#0000AA",
  "2": "#00AA00",
  "3": "#00AAAA",
  "4": "#AA0000",
  "5": "#AA00AA",
  "6": "#FFAA00",
  "7": "#AAAAAA",
  "8": "#555555",
  "9": "#5555FF",
  "a": "#55FF55",
  "b": "#55FFFF",
  "c": "#FF5555",
  "d": "#FF55FF",
  "e": "#FFFF55",
  "f": "#FFFFFF",
  "g": "#DDD605"
};

function stripMinecraftFormatting(text) {
  if (!text) return "";
  return String(text).replace(/§[0-9a-gk-or]/gi, "");
}

function renderMinecraftFormattedText(rawText, containerEl) {
  if (!containerEl) return;
  containerEl.replaceChildren();
  if (!rawText) return;

  const str = String(rawText);
  if (!str.includes("§")) {
    containerEl.textContent = str;
    return;
  }

  let currentColor = null;
  let isBold = false;
  let isItalic = false;
  let isUnderline = false;
  let isStrike = false;

  const parts = str.split(/(§[0-9a-gk-or])/gi);
  for (const part of parts) {
    if (!part) continue;
    if (part.startsWith("§") && part.length === 2) {
      const code = part[1].toLowerCase();
      if (MC_COLOR_CODES[code] !== undefined) {
        currentColor = MC_COLOR_CODES[code];
        isBold = false;
        isItalic = false;
        isUnderline = false;
        isStrike = false;
      } else if (code === "l") {
        isBold = true;
      } else if (code === "o") {
        isItalic = true;
      } else if (code === "n") {
        isUnderline = true;
      } else if (code === "m") {
        isStrike = true;
      } else if (code === "r") {
        currentColor = null;
        isBold = false;
        isItalic = false;
        isUnderline = false;
        isStrike = false;
      }
    } else {
      const span = document.createElement("span");
      span.textContent = part;
      if (currentColor) span.style.color = currentColor;
      if (isBold) span.classList.add("mc-format-bold");
      if (isItalic) span.classList.add("mc-format-italic");
      if (isUnderline) span.classList.add("mc-format-underline");
      if (isStrike) span.classList.add("mc-format-strikethrough");
      containerEl.appendChild(span);
    }
  }
}

function formatDecimalDisplay(value, maxDecimals = 4) {
  if (value === undefined || value === null || value === "") return "";
  const num = Number(value);
  if (!Number.isFinite(num)) return "";
  return String(Number(num.toFixed(maxDecimals)));
}

function applyControlState() {
  const busy = isAnyOperationBusy();
  const restart = Boolean(
    localRestartRequired ||
      lastSessionState?.restartRequired
  );

  if (villagerEditorView) {
    villagerEditorView.inert = busy;
  }

  if (worldPickerView) {
    worldPickerView.inert = busy;
  }

  document.body.classList.toggle(
    "app-busy",
    busy
  );

  btnSaveToWorld.disabled =
    busy ||
    (lastSessionState?.dirtyCount || 0) === 0;

  btnUndo.disabled =
    busy ||
    !lastSessionState?.canUndo;

  btnRedo.disabled =
    busy ||
    !lastSessionState?.canRedo;

  for (const id of [
    "btnCreateManualBackup",
    "btnBulkActionsMenu",
    "btnSwitchWorld",
    "btnBackupsMenu",
    "btnBrowseFolder",
    "btnRefreshWorlds"
  ]) {
    const element = document.getElementById(id);
    if (element) {
      element.disabled = busy;
    }
  }

  const operationStatus = document.getElementById("operationStatus");
  if (operationStatus) {
    if (restart) {
      operationStatus.textContent = "Restart required";
    } else {
      operationStatus.textContent = localUiBusy
        ? localUiBusyLabel
        : (lastSessionState?.busyOperation || "");
    }

    operationStatus.classList.toggle(
      "hidden",
      !busy
    );
  }
}

function setUiBusy(busy, label = "") {
  localUiBusy = Boolean(busy);
  localUiBusyLabel = localUiBusy ? String(label || "") : "";
  applyControlState();
}

function parseIntegerField(
  raw,
  { label, min, max, nullable = false }
) {
  const text = String(raw ?? "").trim();

  if (nullable && text === "") {
    return {
      ok: true,
      value: null
    };
  }

  if (!/^-?\d+$/.test(text)) {
    return {
      ok: false,
      error: `${label} must be a whole number.`
    };
  }

  const value = Number(text);

  if (
    !Number.isSafeInteger(value) ||
    value < min ||
    value > max
  ) {
    return {
      ok: false,
      error: `${label} must be an integer from ${min} to ${max}.`
    };
  }

  return {
    ok: true,
    value
  };
}

async function rejectNumericEdit(message) {
  if (
    localRestartRequired ||
    lastSessionState?.restartRequired
  ) {
    return;
  }

  const ownsBusy = !localUiBusy;

  if (ownsBusy) {
    setUiBusy(true, "Restoring value...");
  }

  try {
    showToast(message, "error");
    await refreshLoadedWorldFromMain();
  } catch (error) {
    console.error(
      "Failed restoring UI after invalid numeric input:",
      error
    );
  } finally {
    if (ownsBusy) {
      setUiBusy(false);
    }
  }
}

function errorMessage(error, fallback) {
  if (
    error &&
    typeof error === "object" &&
    typeof error.message === "string" &&
    error.message
  ) {
    return error.message;
  }
  return fallback;
}

function showToast(message, type = "info") {
  if (!toastContainer) {
    console.log(`[${type}] ${message}`);
    return;
  }

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transition = "opacity 0.3s ease";
    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 300);
  }, 4000);
}

function getSelectedVillager() {
  return activeVillagers.find((x) => x.sessionVillagerId === selectedVillagerId) || null;
}

function getEnchantmentDefinition(idOrName) {
  if (!metadata || !metadata.enchantments) {
    return null;
  }

  const all = Object.values(metadata.enchantments);

  if (typeof idOrName === "number") {
    return all.find((entry) => entry.id === idOrName) || null;
  }

  const clean = String(idOrName || "")
    .trim()
    .toLowerCase()
    .replace(/^minecraft:/, "");

  return (
    all.find(
      (entry) =>
        entry.name.toLowerCase() === clean ||
        entry.displayName.toLowerCase() === clean
    ) || null
  );
}

function normalizeItemIdInput(raw) {
  const trimmed = String(raw || "").trim().toLowerCase();
  if (!trimmed) {
    return null;
  }

  const normalized = trimmed.includes(":") ? trimmed : `minecraft:${trimmed}`;
  if (!/^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(normalized)) {
    return null;
  }

  return normalized;
}

async function copyCurrentCoordinates() {
  const v = getSelectedVillager();
  if (!v) return;

  const text = `${v.position.x} ${v.position.y} ${v.position.z}`;
  try {
    await navigator.clipboard.writeText(text);
    showToast("Coordinates copied to clipboard!", "success");
  } catch {
    showToast("Could not copy coordinates.", "error");
  }
}

async function copyRawNbtJson() {
  const text = document.getElementById("advRawNbtText").value;
  try {
    await navigator.clipboard.writeText(text);
    showToast("Raw NBT JSON copied to clipboard!", "success");
  } catch {
    showToast("Could not copy Raw NBT.", "error");
  }
}

function mapDimensionIdFromVillager(villager) {
  const id = Number(villager?.dimensionId);
  return id === 0 || id === 1 || id === 2 ? id : null;
}

function getWorldMapModal() {
  return document.getElementById("worldMapModal");
}

function isWorldMapOpen() {
  return Boolean(getWorldMapModal()?.open);
}

function worldMapTileKey(dimensionId, tileX, tileZ, generation = worldMapState.worldGeneration) {
  return `${generation}:${dimensionId}:${tileX}:${tileZ}`;
}

function clearQueuedWorldMapTiles() {
  worldMapState.tileQueue = [];
  worldMapState.queuedTileKeys.clear();
  updateWorldMapLoadingIndicator();
}

function clearWorldMapCache() {
  worldMapState.worldGeneration += 1;
  worldMapState.tileCache.clear();
  clearQueuedWorldMapTiles();
  worldMapState.markerHitboxes = [];
  worldMapState.iconCache.clear();
}

function getWorldMapVillagers() {
  return activeVillagers.filter(
    (villager) => mapDimensionIdFromVillager(villager) === worldMapState.dimensionId
  );
}

function updateWorldMapSelectedLabel() {
  const label = document.getElementById("worldMapSelectedLabel");
  const selected = getSelectedVillager();
  if (!label) return;

  if (!selected) {
    label.textContent = "No villager selected";
    return;
  }

  const name = selected.customName || "Unnamed Villager";
  label.textContent = `${name} - ${selected.professionDisplayName} - X ${Math.floor(selected.position.x)}, Z ${Math.floor(selected.position.z)}`;
}

function updateWorldMapZoomLabel() {
  const label = document.getElementById("worldMapZoomLabel");
  if (!label) return;
  label.textContent = `${Math.round(worldMapState.zoom * 100)}%`;
}

function setWorldMapMessage(message) {
  const el = document.getElementById("worldMapMessage");
  if (!el) return;
  el.textContent = message || "";
  el.classList.toggle("hidden", !message);
}

function updateWorldMapLoadingIndicator() {
  const el = document.getElementById("worldMapLoading");
  if (!el) return;
  const count = worldMapState.pendingTiles.size + worldMapState.tileQueue.length;
  el.textContent = count > 1 ? `Loading ${count} terrain tiles…` : "Loading terrain…";
  el.classList.toggle("hidden", count === 0);
}

function resizeWorldMapCanvas() {
  const canvas = document.getElementById("worldMapCanvas");
  const viewport = document.getElementById("worldMapViewport");
  if (!canvas || !viewport || !isWorldMapOpen()) return false;

  const rect = viewport.getBoundingClientRect();
  const width = Math.max(1, Math.floor(rect.width));
  const height = Math.max(1, Math.floor(rect.height));
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));

  worldMapState.cssWidth = width;
  worldMapState.cssHeight = height;

  const pixelWidth = Math.max(1, Math.floor(width * dpr));
  const pixelHeight = Math.max(1, Math.floor(height * dpr));
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }

  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  return true;
}

function worldMapWorldToScreen(worldX, worldZ) {
  return {
    x: worldMapState.cssWidth / 2 + (worldX - worldMapState.centerX) * worldMapState.zoom,
    y: worldMapState.cssHeight / 2 + (worldZ - worldMapState.centerZ) * worldMapState.zoom
  };
}

function worldMapScreenToWorld(screenX, screenY) {
  return {
    x: worldMapState.centerX + (screenX - worldMapState.cssWidth / 2) / worldMapState.zoom,
    z: worldMapState.centerZ + (screenY - worldMapState.cssHeight / 2) / worldMapState.zoom
  };
}

function trimWorldMapTileCache() {
  while (worldMapState.tileCache.size > WORLD_MAP_MAX_CACHED_TILES) {
    const firstKey = worldMapState.tileCache.keys().next().value;
    if (!firstKey) break;
    worldMapState.tileCache.delete(firstKey);
  }
}

function decodeWorldMapTileCanvas(tile) {
  const raw = atob(tile.rgbaBase64);
  const expected = tile.blockSize * tile.blockSize * 4;
  if (raw.length !== expected) {
    throw new Error(`Map tile pixel length mismatch: expected ${expected}, got ${raw.length}.`);
  }

  const tileCanvas = document.createElement("canvas");
  tileCanvas.width = tile.blockSize;
  tileCanvas.height = tile.blockSize;
  const ctx = tileCanvas.getContext("2d", { alpha: true });
  if (!ctx) throw new Error("Could not create map tile canvas context.");

  const image = ctx.createImageData(tile.blockSize, tile.blockSize);
  for (let i = 0; i < raw.length; i += 1) {
    image.data[i] = raw.charCodeAt(i);
  }
  ctx.putImageData(image, 0, 0);
  return tileCanvas;
}

async function loadQueuedWorldMapTile(item) {
  const { dimensionId, tileX, tileZ, key, generation } = item;
  worldMapState.activeTileLoads += 1;

  const request = (async () => {
    try {
      const result = await api.getWorldMapTile({ dimensionId, tileX, tileZ });

      if (result?.restartRequired) {
        enterRestartRequiredState(
          result.error || "Restart the editor before performing another world operation."
        );
        return;
      }

      if (!result?.success || !result.tile) {
        if (isWorldMapOpen() && dimensionId === worldMapState.dimensionId && result?.error) {
          setWorldMapMessage(result.error);
        }
        return;
      }

      if (generation === worldMapState.worldGeneration) {
        const tileCanvas = decodeWorldMapTileCanvas(result.tile);
        worldMapState.tileCache.set(key, {
          tile: result.tile,
          canvas: tileCanvas
        });
        trimWorldMapTileCache();

        if (isWorldMapOpen() && dimensionId === worldMapState.dimensionId) {
          setWorldMapMessage("");
        }
      }
    } catch (error) {
      console.warn("World map tile request failed:", error);
      if (isWorldMapOpen() && dimensionId === worldMapState.dimensionId) {
        setWorldMapMessage("Terrain tile could not be loaded. Villager markers are still available.");
      }
    } finally {
      worldMapState.pendingTiles.delete(key);
      worldMapState.activeTileLoads = Math.max(0, worldMapState.activeTileLoads - 1);
      updateWorldMapLoadingIndicator();
      drainWorldMapTileQueue();
      if (isWorldMapOpen()) {
        drawWorldMap();
      }
    }
  })();

  worldMapState.pendingTiles.set(key, request);
  updateWorldMapLoadingIndicator();
}

function drainWorldMapTileQueue() {
  while (
    worldMapState.activeTileLoads < WORLD_MAP_MAX_CONCURRENT_TILE_LOADS &&
    worldMapState.tileQueue.length > 0
  ) {
    const item = worldMapState.tileQueue.shift();
    if (!item) break;
    worldMapState.queuedTileKeys.delete(item.key);

    if (worldMapState.tileCache.has(item.key) || worldMapState.pendingTiles.has(item.key)) {
      continue;
    }

    void loadQueuedWorldMapTile(item);
  }

  updateWorldMapLoadingIndicator();
}

function enqueueWorldMapTileIfNeeded(dimensionId, tileX, tileZ) {
  const generation = worldMapState.worldGeneration;
  const key = worldMapTileKey(dimensionId, tileX, tileZ, generation);
  if (
    worldMapState.tileCache.has(key) ||
    worldMapState.pendingTiles.has(key) ||
    worldMapState.queuedTileKeys.has(key)
  ) {
    return;
  }

  worldMapState.queuedTileKeys.add(key);
  worldMapState.tileQueue.push({ dimensionId, tileX, tileZ, key, generation });
}

function getVisibleWorldMapTileRange() {
  const halfWidthBlocks = worldMapState.cssWidth / (2 * worldMapState.zoom);
  const halfHeightBlocks = worldMapState.cssHeight / (2 * worldMapState.zoom);
  const minX = worldMapState.centerX - halfWidthBlocks;
  const maxX = worldMapState.centerX + halfWidthBlocks;
  const minZ = worldMapState.centerZ - halfHeightBlocks;
  const maxZ = worldMapState.centerZ + halfHeightBlocks;

  return {
    minTileX: Math.floor(minX / WORLD_MAP_TILE_BLOCKS) - 1,
    maxTileX: Math.floor(maxX / WORLD_MAP_TILE_BLOCKS) + 1,
    minTileZ: Math.floor(minZ / WORLD_MAP_TILE_BLOCKS) - 1,
    maxTileZ: Math.floor(maxZ / WORLD_MAP_TILE_BLOCKS) + 1
  };
}

function ensureVisibleWorldMapTiles() {
  if (!isWorldMapOpen()) return;
  const range = getVisibleWorldMapTileRange();
  const width = range.maxTileX - range.minTileX + 1;
  const height = range.maxTileZ - range.minTileZ + 1;
  const count = width * height;

  if (count > WORLD_MAP_MAX_REQUESTED_TILES) {
    clearQueuedWorldMapTiles();
    setWorldMapMessage("Zoom in to load terrain at this scale. Villager markers remain visible.");
    return;
  }

  const centerTileX = Math.floor(worldMapState.centerX / WORLD_MAP_TILE_BLOCKS);
  const centerTileZ = Math.floor(worldMapState.centerZ / WORLD_MAP_TILE_BLOCKS);
  const tiles = [];
  for (let tileZ = range.minTileZ; tileZ <= range.maxTileZ; tileZ += 1) {
    for (let tileX = range.minTileX; tileX <= range.maxTileX; tileX += 1) {
      tiles.push({
        tileX,
        tileZ,
        distance: Math.abs(tileX - centerTileX) + Math.abs(tileZ - centerTileZ)
      });
    }
  }
  tiles.sort((a, b) => a.distance - b.distance);

  const desiredKeys = new Set(
    tiles.map((t) =>
      worldMapTileKey(
        worldMapState.dimensionId,
        t.tileX,
        t.tileZ,
        worldMapState.worldGeneration
      )
    )
  );

  // Prune existing not-yet-started queue to current generation, dimension, and desired viewport
  worldMapState.tileQueue = worldMapState.tileQueue.filter(
    (item) =>
      item.generation === worldMapState.worldGeneration &&
      item.dimensionId === worldMapState.dimensionId &&
      desiredKeys.has(item.key)
  );

  // Rebuild queuedTileKeys from the pruned queue
  worldMapState.queuedTileKeys.clear();
  for (const item of worldMapState.tileQueue) {
    worldMapState.queuedTileKeys.add(item.key);
  }

  // Add desired items that are not already cached, pending, or queued
  for (const tile of tiles) {
    if (worldMapState.tileQueue.length >= WORLD_MAP_MAX_REQUESTED_TILES) {
      break;
    }
    enqueueWorldMapTileIfNeeded(worldMapState.dimensionId, tile.tileX, tile.tileZ);
  }

  if (worldMapState.tileQueue.length > WORLD_MAP_MAX_REQUESTED_TILES) {
    worldMapState.tileQueue = worldMapState.tileQueue.slice(0, WORLD_MAP_MAX_REQUESTED_TILES);
    worldMapState.queuedTileKeys.clear();
    for (const item of worldMapState.tileQueue) {
      worldMapState.queuedTileKeys.add(item.key);
    }
  }

  drainWorldMapTileQueue();
}

function getWorldMapProfessionIcon(villager) {
  const professionId = villager.professionKnown ? villager.profession : "unknown";
  const src = getProfessionAssetUrl(professionId);
  const existing = worldMapState.iconCache.get(src);
  if (existing) return existing;

  const image = new Image();
  image.decoding = "async";
  image.src = src;
  image.addEventListener("load", () => {
    if (isWorldMapOpen()) drawWorldMap();
  }, { once: true });
  image.addEventListener("error", () => {
    image.dataset.failed = "1";
    if (isWorldMapOpen()) drawWorldMap();
  }, { once: true });
  worldMapState.iconCache.set(src, image);
  return image;
}

function drawWorldMapTerrain(ctx) {
  const range = getVisibleWorldMapTileRange();
  ctx.imageSmoothingEnabled = worldMapState.zoom < 1;

  for (let tileZ = range.minTileZ; tileZ <= range.maxTileZ; tileZ += 1) {
    for (let tileX = range.minTileX; tileX <= range.maxTileX; tileX += 1) {
      const key = worldMapTileKey(worldMapState.dimensionId, tileX, tileZ);
      const cached = worldMapState.tileCache.get(key);
      if (!cached) continue;

      const originX = tileX * WORLD_MAP_TILE_BLOCKS;
      const originZ = tileZ * WORLD_MAP_TILE_BLOCKS;
      const screen = worldMapWorldToScreen(originX, originZ);
      const size = WORLD_MAP_TILE_BLOCKS * worldMapState.zoom;
      ctx.drawImage(cached.canvas, screen.x, screen.y, size, size);
    }
  }
}

function drawWorldMapGrid(ctx) {
  if (worldMapState.zoom < 1.25) return;

  const halfWidthBlocks = worldMapState.cssWidth / (2 * worldMapState.zoom);
  const halfHeightBlocks = worldMapState.cssHeight / (2 * worldMapState.zoom);
  const minX = Math.floor((worldMapState.centerX - halfWidthBlocks) / 16) * 16;
  const maxX = worldMapState.centerX + halfWidthBlocks;
  const minZ = Math.floor((worldMapState.centerZ - halfHeightBlocks) / 16) * 16;
  const maxZ = worldMapState.centerZ + halfHeightBlocks;

  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.07)";
  ctx.lineWidth = 1;

  for (let x = minX; x <= maxX; x += 16) {
    const sx = worldMapWorldToScreen(x, worldMapState.centerZ).x;
    ctx.beginPath();
    ctx.moveTo(Math.round(sx) + 0.5, 0);
    ctx.lineTo(Math.round(sx) + 0.5, worldMapState.cssHeight);
    ctx.stroke();
  }

  for (let z = minZ; z <= maxZ; z += 16) {
    const sy = worldMapWorldToScreen(worldMapState.centerX, z).y;
    ctx.beginPath();
    ctx.moveTo(0, Math.round(sy) + 0.5);
    ctx.lineTo(worldMapState.cssWidth, Math.round(sy) + 0.5);
    ctx.stroke();
  }
  ctx.restore();
}

function drawWorldMapVillagers(ctx) {
  worldMapState.markerHitboxes = [];
  const villagers = getWorldMapVillagers();

  for (const villager of villagers) {
    const screen = worldMapWorldToScreen(villager.position.x, villager.position.z);
    if (
      screen.x < -32 ||
      screen.y < -32 ||
      screen.x > worldMapState.cssWidth + 32 ||
      screen.y > worldMapState.cssHeight + 32
    ) {
      continue;
    }

    const selected = villager.sessionVillagerId === selectedVillagerId;
    const radius = selected ? 15 : 12;

    ctx.save();
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, radius + 3, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0,0,0,0.68)";
    ctx.fill();

    ctx.beginPath();
    ctx.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = selected ? "#10b981" : "#334155";
    ctx.fill();
    ctx.lineWidth = selected ? 3 : 2;
    ctx.strokeStyle = "#ffffff";
    ctx.stroke();

    const icon = getWorldMapProfessionIcon(villager);
    if (icon.complete && icon.naturalWidth > 0 && icon.dataset.failed !== "1") {
      const iconSize = radius * 1.35;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(
        icon,
        screen.x - iconSize / 2,
        screen.y - iconSize / 2,
        iconSize,
        iconSize
      );
    } else {
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 11px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("V", screen.x, screen.y + 0.5);
    }

    if (villager.isDirty) {
      ctx.beginPath();
      ctx.arc(screen.x + radius - 1, screen.y - radius + 1, 4, 0, Math.PI * 2);
      ctx.fillStyle = "#f59e0b";
      ctx.fill();
      ctx.strokeStyle = "#111827";
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    ctx.restore();
    worldMapState.markerHitboxes.push({
      villager,
      x: screen.x,
      y: screen.y,
      radius: radius + 6
    });
  }
}

function drawWorldMapCrosshair(ctx) {
  const selected = getSelectedVillager();
  if (!selected || mapDimensionIdFromVillager(selected) !== worldMapState.dimensionId) return;

  const screen = worldMapWorldToScreen(selected.position.x, selected.position.z);
  if (screen.x < 0 || screen.y < 0 || screen.x > worldMapState.cssWidth || screen.y > worldMapState.cssHeight) {
    return;
  }

  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.4)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(screen.x - 24, screen.y);
  ctx.lineTo(screen.x - 18, screen.y);
  ctx.moveTo(screen.x + 18, screen.y);
  ctx.lineTo(screen.x + 24, screen.y);
  ctx.moveTo(screen.x, screen.y - 24);
  ctx.lineTo(screen.x, screen.y - 18);
  ctx.moveTo(screen.x, screen.y + 18);
  ctx.lineTo(screen.x, screen.y + 24);
  ctx.stroke();
  ctx.restore();
}

function drawWorldMap() {
  if (!isWorldMapOpen()) return;
  if (!resizeWorldMapCanvas()) return;

  const canvas = document.getElementById("worldMapCanvas");
  const ctx = canvas?.getContext("2d", { alpha: true });
  if (!canvas || !ctx) return;

  const dpr = canvas.width / Math.max(1, worldMapState.cssWidth);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, worldMapState.cssWidth, worldMapState.cssHeight);

  drawWorldMapTerrain(ctx);
  drawWorldMapGrid(ctx);
  drawWorldMapVillagers(ctx);
  drawWorldMapCrosshair(ctx);
  updateWorldMapZoomLabel();
  updateWorldMapSelectedLabel();
  ensureVisibleWorldMapTiles();
}

function findWorldMapMarkerAt(screenX, screenY) {
  let best = null;
  let bestDistance = Infinity;
  for (const marker of worldMapState.markerHitboxes) {
    const dx = screenX - marker.x;
    const dy = screenY - marker.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= marker.radius && distance < bestDistance) {
      best = marker;
      bestDistance = distance;
    }
  }
  return best;
}

function updateWorldMapPointerReadout(event) {
  const canvas = document.getElementById("worldMapCanvas");
  const coord = document.getElementById("worldMapCoordinates");
  if (!canvas || !coord) return null;

  const rect = canvas.getBoundingClientRect();
  const screenX = event.clientX - rect.left;
  const screenY = event.clientY - rect.top;
  const world = worldMapScreenToWorld(screenX, screenY);
  coord.textContent = `X: ${Math.floor(world.x)} Z: ${Math.floor(world.z)}`;
  return { screenX, screenY, world, rect };
}

function updateWorldMapTooltip(event) {
  const tooltip = document.getElementById("worldMapTooltip");
  const viewport = document.getElementById("worldMapViewport");
  if (!tooltip || !viewport || worldMapState.dragging) return;

  const pointer = updateWorldMapPointerReadout(event);
  if (!pointer) return;
  const marker = findWorldMapMarkerAt(pointer.screenX, pointer.screenY);
  if (!marker) {
    tooltip.classList.add("hidden");
    return;
  }

  const v = marker.villager;
  const dirtySuffix = v.isDirty ? " • Unsaved position/state" : "";
  tooltip.textContent = `${v.customName || "Unnamed Villager"}\n${v.professionDisplayName} • Tier ${v.careerLevel}${dirtySuffix}\nX ${Math.floor(v.position.x)}  Y ${Math.floor(v.position.y)}  Z ${Math.floor(v.position.z)}`;

  const viewportRect = viewport.getBoundingClientRect();
  const x = Math.min(viewportRect.width - 280, Math.max(8, event.clientX - viewportRect.left + 14));
  const y = Math.min(viewportRect.height - 88, Math.max(8, event.clientY - viewportRect.top + 14));
  tooltip.style.left = `${x}px`;
  tooltip.style.top = `${y}px`;
  tooltip.classList.remove("hidden");
}

function selectVillagerFromWorldMap(villager) {
  selectedVillagerId = villager.sessionVillagerId;
  renderVillagersList();
  renderVillagerDetail(villager);
  updateWorldMapSelectedLabel();
  drawWorldMap();

  const selectedListItem = document.querySelector(
    `.villager-item[data-villager-id="${CSS.escape(villager.sessionVillagerId)}"]`
  );
  selectedListItem?.scrollIntoView({ block: "nearest" });
}

function centerWorldMapOnSelected() {
  const selected = getSelectedVillager();
  if (!selected) {
    showToast("Select a villager first.", "info");
    return;
  }

  const dimensionId = mapDimensionIdFromVillager(selected);
  if (dimensionId === null) {
    showToast("This villager is in an unsupported/custom dimension.", "warning");
    return;
  }

  worldMapState.dimensionId = dimensionId;
  document.getElementById("worldMapDimension").value = String(dimensionId);
  worldMapState.centerX = selected.position.x;
  worldMapState.centerZ = selected.position.z;
  if (worldMapState.zoom < 0.75) worldMapState.zoom = WORLD_MAP_DEFAULT_ZOOM;
  setWorldMapMessage("");
  drawWorldMap();
}

function fitWorldMapVillagers() {
  const villagers = getWorldMapVillagers();
  if (villagers.length === 0) {
    setWorldMapMessage("No loaded villagers are in this dimension.");
    drawWorldMap();
    return;
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const villager of villagers) {
    minX = Math.min(minX, villager.position.x);
    maxX = Math.max(maxX, villager.position.x);
    minZ = Math.min(minZ, villager.position.z);
    maxZ = Math.max(maxZ, villager.position.z);
  }

  worldMapState.centerX = (minX + maxX) / 2;
  worldMapState.centerZ = (minZ + maxZ) / 2;

  const paddedWidth = Math.max(96, maxX - minX + 96);
  const paddedHeight = Math.max(96, maxZ - minZ + 96);
  const width = Math.max(320, worldMapState.cssWidth || 1);
  const height = Math.max(260, worldMapState.cssHeight || 1);
  const zoomX = width / paddedWidth;
  const zoomZ = height / paddedHeight;
  worldMapState.zoom = Math.max(
    WORLD_MAP_MIN_ZOOM,
    Math.min(WORLD_MAP_MAX_ZOOM, Math.min(zoomX, zoomZ, 5))
  );
  setWorldMapMessage("");
  drawWorldMap();
}

function zoomWorldMapAt(screenX, screenY, factor) {
  const before = worldMapScreenToWorld(screenX, screenY);
  const nextZoom = Math.max(
    WORLD_MAP_MIN_ZOOM,
    Math.min(WORLD_MAP_MAX_ZOOM, worldMapState.zoom * factor)
  );
  if (Math.abs(nextZoom - worldMapState.zoom) < 0.00001) return;

  worldMapState.zoom = nextZoom;
  const after = worldMapScreenToWorld(screenX, screenY);
  worldMapState.centerX += before.x - after.x;
  worldMapState.centerZ += before.z - after.z;
  setWorldMapMessage("");
  drawWorldMap();
}

function openWorldMap() {
  if (!activeWorldSummary || activeVillagers.length === 0) {
    showToast("Open a world with villagers before using the map.", "info");
    return;
  }

  const modal = getWorldMapModal();
  if (!modal) return;

  const selected = getSelectedVillager();
  const selectedDimensionId = mapDimensionIdFromVillager(selected);
  if (selected && selectedDimensionId !== null) {
    worldMapState.dimensionId = selectedDimensionId;
    worldMapState.centerX = selected.position.x;
    worldMapState.centerZ = selected.position.z;
  } else {
    worldMapState.dimensionId = 0;
  }
  worldMapState.zoom = WORLD_MAP_DEFAULT_ZOOM;
  document.getElementById("worldMapDimension").value = String(worldMapState.dimensionId);
  setWorldMapMessage("");
  modal.showModal();

  requestAnimationFrame(() => {
    resizeWorldMapCanvas();
    if (!selected || selectedDimensionId === null) {
      fitWorldMapVillagers();
    } else {
      drawWorldMap();
    }
  });
}

function closeWorldMap() {
  const modal = getWorldMapModal();
  clearQueuedWorldMapTiles();
  document.getElementById("worldMapTooltip")?.classList.add("hidden");
  if (modal?.open) modal.close();
}

function handleWorldMapPointerDown(event) {
  if (event.button !== 0) return;
  const canvas = document.getElementById("worldMapCanvas");
  if (!canvas) return;

  worldMapState.dragging = true;
  worldMapState.dragMoved = false;
  worldMapState.dragStartClientX = event.clientX;
  worldMapState.dragStartClientY = event.clientY;
  worldMapState.dragStartCenterX = worldMapState.centerX;
  worldMapState.dragStartCenterZ = worldMapState.centerZ;
  canvas.classList.add("is-dragging");
  canvas.setPointerCapture?.(event.pointerId);
  document.getElementById("worldMapTooltip")?.classList.add("hidden");
}

function handleWorldMapPointerMove(event) {
  worldMapState.lastPointerClientX = event.clientX;
  worldMapState.lastPointerClientY = event.clientY;
  updateWorldMapPointerReadout(event);

  if (!worldMapState.dragging) {
    updateWorldMapTooltip(event);
    return;
  }

  const dx = event.clientX - worldMapState.dragStartClientX;
  const dy = event.clientY - worldMapState.dragStartClientY;
  if (Math.abs(dx) > 3 || Math.abs(dy) > 3) worldMapState.dragMoved = true;

  worldMapState.centerX = worldMapState.dragStartCenterX - dx / worldMapState.zoom;
  worldMapState.centerZ = worldMapState.dragStartCenterZ - dy / worldMapState.zoom;
  drawWorldMap();
}

function handleWorldMapPointerUp(event) {
  const canvas = document.getElementById("worldMapCanvas");
  if (!canvas || !worldMapState.dragging) return;

  canvas.releasePointerCapture?.(event.pointerId);
  canvas.classList.remove("is-dragging");
  worldMapState.dragging = false;

  const pointer = updateWorldMapPointerReadout(event);
  if (!worldMapState.dragMoved && pointer) {
    const marker = findWorldMapMarkerAt(pointer.screenX, pointer.screenY);
    if (marker) selectVillagerFromWorldMap(marker.villager);
  }

  updateWorldMapTooltip(event);
  ensureVisibleWorldMapTiles();
}

function handleWorldMapDoubleClick(event) {
  const pointer = updateWorldMapPointerReadout(event);
  if (!pointer) return;
  const marker = findWorldMapMarkerAt(pointer.screenX, pointer.screenY);
  if (!marker) return;
  selectVillagerFromWorldMap(marker.villager);
  closeWorldMap();
}

async function handleExportJson() {
  if (isAnyOperationBusy()) return;
  setUiBusy(true, "Exporting villagers...");
  try {
    const res = await api.exportVillagersJson();
    if (res?.canceled) return;
    if (!res?.success) {
      showToast(res?.error || "Failed to export villagers to JSON.", "error");
      return;
    }
    showToast(`Exported villagers to: ${res.filePath}`, "success");
  } catch (err) {
    console.error("Export JSON failed:", err);
    showToast(errorMessage(err, "Failed to export villagers."), "error");
  } finally {
    setUiBusy(false);
  }
}

async function handleImportJson() {
  if (isAnyOperationBusy()) return;
  setUiBusy(true, "Importing villagers...");
  try {
    const res = await api.importVillagersJson();
    if (res?.canceled) return;
    if (!res?.success) {
      showToast(res?.error || "Failed to import villagers from JSON.", "error");
      return;
    }
    showToast(`Successfully imported edits for ${res.modifiedCount} villager(s)!`, "success");
    await refreshLoadedWorldFromMain();
  } catch (err) {
    console.error("Import JSON failed:", err);
    showToast(errorMessage(err, "Failed to import villagers."), "error");
  } finally {
    setUiBusy(false);
  }
}

function setupEventListeners() {
  // Global text-field undo/redo guard
  window.addEventListener("keydown", async (e) => {
    const isInput =
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLTextAreaElement ||
      e.target instanceof HTMLSelectElement;

    if (e.ctrlKey || e.metaKey) {
      if (e.key === "z" && !e.shiftKey) {
        if (isInput) return;
        e.preventDefault();
        await handleUndo();
      } else if (e.key === "y" || (e.key === "z" && e.shiftKey)) {
        if (isInput) return;
        e.preventDefault();
        await handleRedo();
      }
    }
  });

  document.getElementById("btnRefreshWorlds").addEventListener("click", loadWorldPicker);
  document.getElementById("btnBrowseFolder").addEventListener("click", handleBrowseFolder);
  document.getElementById("btnSwitchWorld").addEventListener("click", handleSwitchWorld);

  // Read-only world-map controls
  document.getElementById("btnOpenWorldMap").addEventListener("click", openWorldMap);
  document.getElementById("btnExportJson").addEventListener("click", handleExportJson);
  document.getElementById("btnImportJson").addEventListener("click", handleImportJson);
  document.getElementById("btnCloseWorldMap").addEventListener("click", closeWorldMap);
  document.getElementById("btnWorldMapCenterSelected").addEventListener("click", centerWorldMapOnSelected);
  document.getElementById("btnWorldMapFitVillagers").addEventListener("click", fitWorldMapVillagers);
  document.getElementById("btnWorldMapEditSelected").addEventListener("click", () => {
    const selected = getSelectedVillager();
    if (!selected) {
      showToast("Select a villager marker first.", "info");
      return;
    }
    renderVillagerDetail(selected);
    renderVillagersList();
    closeWorldMap();
  });

  document.getElementById("worldMapDimension").addEventListener("change", (event) => {
    const dimensionId = Number(event.target.value);
    if (dimensionId !== 0 && dimensionId !== 1 && dimensionId !== 2) return;
    worldMapState.dimensionId = dimensionId;
    worldMapState.zoom = WORLD_MAP_DEFAULT_ZOOM;
    clearQueuedWorldMapTiles();
    setWorldMapMessage("");
    requestAnimationFrame(() => {
      resizeWorldMapCanvas();
      fitWorldMapVillagers();
    });
  });

  document.getElementById("btnWorldMapZoomIn").addEventListener("click", () => {
    zoomWorldMapAt(worldMapState.cssWidth / 2, worldMapState.cssHeight / 2, 1.5);
  });
  document.getElementById("btnWorldMapZoomOut").addEventListener("click", () => {
    zoomWorldMapAt(worldMapState.cssWidth / 2, worldMapState.cssHeight / 2, 1 / 1.5);
  });

  const worldMapCanvas = document.getElementById("worldMapCanvas");
  worldMapCanvas.addEventListener("pointerdown", handleWorldMapPointerDown);
  worldMapCanvas.addEventListener("pointermove", handleWorldMapPointerMove);
  worldMapCanvas.addEventListener("pointerup", handleWorldMapPointerUp);
  worldMapCanvas.addEventListener("pointercancel", handleWorldMapPointerUp);
  worldMapCanvas.addEventListener("dblclick", handleWorldMapDoubleClick);
  worldMapCanvas.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      const rect = worldMapCanvas.getBoundingClientRect();
      const screenX = event.clientX - rect.left;
      const screenY = event.clientY - rect.top;
      zoomWorldMapAt(screenX, screenY, event.deltaY < 0 ? 1.25 : 0.8);
    },
    { passive: false }
  );
  worldMapCanvas.addEventListener("keydown", (event) => {
    const panPixels = 80;
    const panWorld = panPixels / worldMapState.zoom;
    let handled = false;

    if (event.key === "ArrowLeft") {
      worldMapState.centerX -= panWorld;
      handled = true;
    } else if (event.key === "ArrowRight") {
      worldMapState.centerX += panWorld;
      handled = true;
    } else if (event.key === "ArrowUp") {
      worldMapState.centerZ -= panWorld;
      handled = true;
    } else if (event.key === "ArrowDown") {
      worldMapState.centerZ += panWorld;
      handled = true;
    } else if (event.key === "+" || event.key === "=") {
      zoomWorldMapAt(worldMapState.cssWidth / 2, worldMapState.cssHeight / 2, 1.25);
      handled = true;
    } else if (event.key === "-" || event.key === "_") {
      zoomWorldMapAt(worldMapState.cssWidth / 2, worldMapState.cssHeight / 2, 0.8);
      handled = true;
    }

    if (handled) {
      event.preventDefault();
      drawWorldMap();
    }
  });

  const worldMapModal = getWorldMapModal();
  worldMapModal.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeWorldMap();
  });
  worldMapModal.addEventListener("close", () => {
    worldMapState.dragging = false;
    worldMapCanvas.classList.remove("is-dragging");
    document.getElementById("worldMapTooltip")?.classList.add("hidden");
  });

  window.addEventListener("resize", () => {
    if (isWorldMapOpen()) {
      requestAnimationFrame(drawWorldMap);
    }
  });

  document.getElementById("worldSearchInput").addEventListener("input", (e) => {
    worldSearchQuery = e.target.value;
    renderWorldPickerCards();
  });

  document.getElementById("villagerSearchInput").addEventListener("input", (e) => {
    villagerSearchQuery = e.target.value;
    renderVillagersList();
  });

  document.getElementById("professionFilter").addEventListener("change", (e) => {
    selectedProfessionFilter = e.target.value;
    renderVillagersList();
  });

  document.getElementById("tierFilter").addEventListener("change", (e) => {
    selectedTierFilter = e.target.value;
    renderVillagersList();
  });

  btnUndo.addEventListener("click", handleUndo);
  btnRedo.addEventListener("click", handleRedo);

  // Tabs Navigation
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".tab-pane").forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      const pane = document.getElementById(btn.dataset.tab);
      if (pane) pane.classList.add("active");
    });
  });

  // Villager Info Edits
  document.getElementById("editVillagerName").addEventListener("change", async (e) => {
    if (!selectedVillagerId) return;
    await executeSessionCommand({
      kind: "PATCH_VILLAGER",
      description: `Rename villager to "${e.target.value}"`,
      villagerId: selectedVillagerId,
      patch: { customName: e.target.value.trim() || null }
    });
  });

  document.getElementById("selectProfession").addEventListener("change", async (e) => {
    if (!selectedVillagerId) return;
    await executeSessionCommand({
      kind: "PATCH_VILLAGER",
      description: `Change profession to ${e.target.value}`,
      villagerId: selectedVillagerId,
      patch: { profession: e.target.value }
    });
  });

  document.getElementById("selectCareerLevel").addEventListener("change", async (e) => {
    if (!selectedVillagerId) return;
    await executeSessionCommand({
      kind: "PATCH_VILLAGER",
      description: `Set career tier to ${e.target.value}`,
      villagerId: selectedVillagerId,
      patch: { careerLevel: parseInt(e.target.value, 10) }
    });
  });

  document.getElementById("btnSetTierMaster").addEventListener("click", async () => {
    if (!selectedVillagerId) return;
    await executeSessionCommand({
      kind: "PATCH_VILLAGER",
      description: "Set career tier to 5 (Master)",
      villagerId: selectedVillagerId,
      patch: { careerLevel: 5 }
    });
  });

  document.getElementById("inputExperience").addEventListener("change", async (e) => {
    if (!selectedVillagerId) return;
    const parsed = parseIntegerField(e.target.value, {
      label: "Villager experience",
      min: 0,
      max: 1000000
    });
    if (!parsed.ok) {
      await rejectNumericEdit(parsed.error);
      return;
    }
    await executeSessionCommand({
      kind: "PATCH_VILLAGER",
      description: `Set trade XP to ${parsed.value}`,
      villagerId: selectedVillagerId,
      patch: { experience: parsed.value }
    });
  });

  // Position Edits
  document.getElementById("btnApplyPosition").addEventListener("click", async () => {
    if (!selectedVillagerId) return;
    const x = parseFloat(document.getElementById("inputPositionX").value);
    const y = parseFloat(document.getElementById("inputPositionY").value);
    const z = parseFloat(document.getElementById("inputPositionZ").value);

    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      showToast("Coordinates must be valid numbers.", "error");
      return;
    }

    await executeSessionCommand({
      kind: "PATCH_VILLAGER",
      description: `Set villager position to (${x}, ${y}, ${z})`,
      villagerId: selectedVillagerId,
      patch: { position: { x, y, z } }
    });
  });

  document.getElementById("btnCopyCoordinates").addEventListener("click", copyCurrentCoordinates);

  // Quick Action Buttons
  document
    .getElementById(
      "btnVillagerSetCostsOne"
    )
    .addEventListener(
      "click",
      async () => {
        if (
          !selectedVillagerId
        ) {
          return;
        }

        await executeSessionCommand({
          kind:
            "BULK_SET_COST_QUANTITY_ONE",
          description:
            "Set costs to 1 for this villager",
          villagerIds: [
            selectedVillagerId
          ]
        });
      }
    );

  document
    .getElementById(
      "btnVillagerRestock"
    )
    .addEventListener(
      "click",
      async () => {
        if (
          !selectedVillagerId
        ) {
          return;
        }

        await executeSessionCommand({
          kind:
            "BULK_RESTOCK",
          description:
            "Restock this villager",
          villagerIds: [
            selectedVillagerId
          ]
        });
      }
    );

  document
    .getElementById(
      "btnVillagerHighStock"
    )
    .addEventListener(
      "click",
      async () => {
        if (
          !selectedVillagerId
        ) {
          return;
        }

        await executeSessionCommand({
          kind:
            "BULK_SET_MAX_USES",
          description:
            "Set max stock to 9999 for this villager",
          villagerIds: [
            selectedVillagerId
          ],
          maxUses:
            9999
        });
      }
    );

  document.getElementById("btnAddTrade").addEventListener("click", async () => {
    if (!selectedVillagerId) return;
    await executeSessionCommand({
      kind: "TRADE_ADD",
      description: "Add new trade offer",
      villagerId: selectedVillagerId
    });
  });

  // Copy Raw NBT
  document.getElementById("btnCopyRawNbt").addEventListener("click", copyRawNbtJson);

  // Modals & Triggers
  btnSaveToWorld.addEventListener("click", openSaveReview);
  document.getElementById("btnCloseSaveReview").addEventListener("click", closeSaveReview);
  document.getElementById("btnCancelSaveReview").addEventListener("click", closeSaveReview);
  document.getElementById("btnConfirmSaveToWorld").addEventListener("click", executeSaveToWorld);

  btnBulkActionsMenu.addEventListener("click", () => {
    document.getElementById("bulkActionsModal").showModal();
  });
  document.getElementById("btnCloseBulkActions").addEventListener("click", () => {
    document.getElementById("bulkActionsModal").close();
  });

  btnBackupsMenu.addEventListener("click", openBackupsModal);
  document.getElementById("btnCloseBackups").addEventListener("click", () => {
    document.getElementById("backupsModal").close();
  });
  document.getElementById("btnCreateManualBackup").addEventListener("click", createManualBackup);
  document.getElementById("btnRevealBackupFolder").addEventListener("click", revealBackupFolderChecked);

  // Bulk Operations
  document.getElementById("btnBulkSetCostsOne").addEventListener("click", async () => {
    const ok = await confirmBulkAction(
      "Set All Costs to 1",
      "Every trade cost quantity across all villagers will be set to 1. Max stock and uses remain unchanged."
    );
    if (!ok) return;
    document.getElementById("bulkActionsModal").close();
    const ids = activeVillagers.map((v) => v.sessionVillagerId);
    if (ids.length === 0) {
      showToast("No villagers are loaded; there is nothing to change.", "info");
      return;
    }
    await executeSessionCommand({
      kind: "BULK_SET_COST_QUANTITY_ONE",
      description: "Set all trade cost quantities to 1",
      villagerIds: ids
    });
  });

  document.getElementById("btnBulkRestock").addEventListener("click", async () => {
    const ok = await confirmBulkAction(
      "Restock All Trades",
      "All trades across all loaded villagers will have their uses reset to 0, immediately unlocking them."
    );
    if (!ok) return;
    document.getElementById("bulkActionsModal").close();
    const ids = activeVillagers.map((v) => v.sessionVillagerId);
    if (ids.length === 0) {
      showToast("No villagers are loaded; there is nothing to change.", "info");
      return;
    }
    await executeSessionCommand({
      kind: "BULK_RESTOCK",
      description: "Restock all trades (reset uses to 0)",
      villagerIds: ids
    });
  });

  document.getElementById("btnBulkMaxUses").addEventListener("click", async () => {
    const ok = await confirmBulkAction(
      "Set Max Stock to 9999",
      "Maximum uses for all trades across all villagers will be set to 9999."
    );
    if (!ok) return;
    document.getElementById("bulkActionsModal").close();
    const ids = activeVillagers.map((v) => v.sessionVillagerId);
    if (ids.length === 0) {
      showToast("No villagers are loaded; there is nothing to change.", "info");
      return;
    }
    await executeSessionCommand({
      kind: "BULK_SET_MAX_USES",
      description: "Set max stock (9999 uses) on all trades",
      villagerIds: ids,
      maxUses: 9999
    });
  });

  // Item Picker Triggers
  document.getElementById("btnCloseItemPicker").addEventListener("click", () => {
    document.getElementById("itemPickerModal").close();
  });
  document.getElementById("itemPickerSearch").addEventListener("input", (e) => {
    renderItemPickerGrid(e.target.value);
  });
  document.getElementById("btnApplyCustomItemId").addEventListener("click", () => {
    const customInput = document.getElementById("customItemIdInput").value;
    const normalized = normalizeItemIdInput(customInput);
    if (!normalized) {
      showToast("Invalid Bedrock item identifier. Example: minecraft:iron_sword", "error");
      return;
    }
    selectItemFromPicker(normalized);
  });

  // Enchant Picker Triggers
  document.getElementById("btnCloseEnchantPicker").addEventListener("click", () => {
    document.getElementById("enchantPickerModal").close();
  });
  document.getElementById("enchantPickerSearch").addEventListener("input", (e) => {
    renderEnchantPickerList(e.target.value);
  });
}

// -------------------------------------------------------------
// World Picker & Navigation
// -------------------------------------------------------------

async function loadWorldPicker() {
  try {
    const worlds = await api.listWorlds();
    detectedWorlds = worlds || [];
    renderWorldPickerCards();
  } catch (err) {
    console.error("Failed to load worlds:", err);
    showToast(errorMessage(err, "Failed to load worlds."), "error");
  }
}

function renderWorldPickerCards() {
  const grid = document.getElementById("worldsGrid");
  grid.innerHTML = "";

  const query = worldSearchQuery.trim().toLowerCase();
  const filtered = !query
    ? detectedWorlds
    : detectedWorlds.filter(
        (w) =>
          w.name.toLowerCase().includes(query) ||
          w.folderName.toLowerCase().includes(query)
      );

  if (filtered.length === 0) {
    const p = document.createElement("p");
    p.className = "empty-placeholder";
    p.textContent = "No Bedrock worlds found.";
    grid.appendChild(p);
    return;
  }

  for (const w of filtered) {
    const card = document.createElement("div");
    card.className = "world-card";
    card.setAttribute("role", "button");
    card.tabIndex = 0;

    const img = document.createElement("img");
    img.className = "world-icon";
    img.src = w.iconDataUrl || `${ASSET_ITEMS_DIR}book_normal.png`;
    img.alt = w.name;

    const info = document.createElement("div");
    info.className = "world-card-info";

    const title = document.createElement("h3");
    title.textContent = w.name;

    const folder = document.createElement("span");
    folder.className = "world-folder";
    folder.textContent = w.folderName;

    const played = document.createElement("span");
    played.className = "world-played";
    played.textContent = w.lastPlayed ? `Last played: ${new Date(w.lastPlayed).toLocaleDateString()}` : "";

    info.appendChild(title);
    info.appendChild(folder);
    info.appendChild(played);

    card.appendChild(img);
    card.appendChild(info);

    const openWorldCard = () => handleOpenWorld(w.handle);
    card.addEventListener("click", openWorldCard);
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openWorldCard();
      }
    });

    grid.appendChild(card);
  }
}

async function discardChangesChecked() {
  if (isAnyOperationBusy()) {
    return false;
  }

  setUiBusy(true, "Discarding changes...");
  try {
    const result = await api.discardChanges();

    if (result?.restartRequired) {
      enterRestartRequiredState(result?.error);
      return false;
    }

    if (!result?.success) {
      showToast(
        result?.error || "Could not discard session changes safely.",
        "error"
      );
      return false;
    }

    try {
      await refreshLoadedWorldFromMain();
    } catch (refreshError) {
      console.error(
        "Changes were discarded in main process, but renderer refresh failed:",
        refreshError
      );
      showToast(
        "Changes were discarded, but the editor UI could not refresh. Reopen the world before continuing.",
        "warning"
      );
      return false;
    }

    return true;
  } catch (error) {
    console.error("Discard changes failed:", error);
    showToast("Could not discard session changes safely.", "error");
    return false;
  } finally {
    setUiBusy(false);
  }
}

async function closeWorldChecked() {
  if (isAnyOperationBusy()) {
    return false;
  }

  setUiBusy(true, "Closing world...");
  try {
    const result = await api.closeWorld();

    if (result?.restartRequired) {
      showToast(
        result.error ||
          "Restart the editor before performing another world operation.",
        "error"
      );

      enterRestartRequiredState(result.error);
      return false;
    }

    if (!result?.success) {
      showToast(
        result?.error || "Could not close the active world.",
        "error"
      );
      try {
        await refreshLoadedWorldFromMain();
      } catch (refreshErr) {
        console.error("Failed refreshing world after close failure:", refreshErr);
      }
      return false;
    }
    return true;
  } catch (error) {
    console.error(error);
    showToast("Could not close the active world safely.", "error");
    try {
      await refreshLoadedWorldFromMain();
    } catch (refreshErr) {
      console.error("Failed refreshing world after close error:", refreshErr);
    }
    return false;
  } finally {
    setUiBusy(false);
  }
}

async function handleOpenWorld(handle) {
  if (isAnyOperationBusy()) return;

  if (dirtyCount > 0) {
    const ok = await confirmAction({
      title: "Unsaved Changes",
      message: "You have unsaved changes in the current session. Discard them and open this world?",
      danger: true
    });
    if (!ok) return;
    const discarded = await discardChangesChecked();
    if (!discarded) return;
  }

  setUiBusy(true, "Opening world...");
  try {
    const res = await api.openWorld(handle);
    if (!res || res.canceled) return;
    if (res.restartRequired) {
      showToast(res.error || "Restart the editor before continuing.", "error");
      enterRestartRequiredState(res.error);
      return;
    }
    if (!res.success) {
      if (res.error === "UNSAVED_CHANGES") return;
      showToast(res.error || "Failed to open world.", "error");
      return;
    }
    await setupLoadedWorld(res.snapshot);
  } finally {
    setUiBusy(false);
  }
}

async function handleBrowseFolder() {
  if (isAnyOperationBusy()) return;

  if (dirtyCount > 0) {
    const ok = await confirmAction({
      title: "Unsaved Changes",
      message: "You have unsaved changes in the current session. Discard them and browse for a new world?",
      danger: true
    });
    if (!ok) return;
    const discarded = await discardChangesChecked();
    if (!discarded) return;
  }

  setUiBusy(true, "Opening folder...");
  try {
    const res = await api.chooseFolder();
    if (!res || res.canceled) return;
    if (res.restartRequired) {
      showToast(res.error || "Restart the editor before continuing.", "error");
      enterRestartRequiredState(res.error);
      return;
    }
    if (!res.success) {
      if (res.error === "UNSAVED_CHANGES") return;
      showToast(res.error || "Failed to open folder.", "error");
      return;
    }
    await setupLoadedWorld(res.snapshot);
  } finally {
    setUiBusy(false);
  }
}

function resetLoadedWorldUi() {
  closeWorldMap();
  clearWorldMapCache();
  activeWorldSummary = null;
  worldPickerView.classList.remove("hidden");
  villagerEditorView.classList.add("hidden");
  worldBreadcrumb.classList.add("hidden");
  sessionControls.classList.add("hidden");
  btnBulkActionsMenu.classList.add("hidden");
  btnBackupsMenu.classList.add("hidden");
  btnSaveToWorld.classList.add("hidden");
  unknownProfessionBanner.classList.add("hidden");

  activeVillagers = [];
  selectedVillagerId = null;
  dirtyCount = 0;
}

async function handleSwitchWorld() {
  if (isAnyOperationBusy()) return;

  if (dirtyCount > 0) {
    const ok = await confirmAction({
      title: "Unsaved Changes",
      message: "You have unsaved changes in the current session. Discard them and return to world picker?",
      danger: true
    });
    if (!ok) return;
    const discarded = await discardChangesChecked();
    if (!discarded) return;
  }

  const closed = await closeWorldChecked();
  if (!closed) return;

  resetLoadedWorldUi();
  await updateSessionState();
  renderWorldPickerCards();
}

async function setupLoadedWorld(snapshot) {
  clearWorldMapCache();
  activeWorldSummary = snapshot;
  activeVillagers = snapshot.villagers || [];
  selectedVillagerId = activeVillagers.length > 0 ? activeVillagers[0].sessionVillagerId : null;

  worldPickerView.classList.add("hidden");
  villagerEditorView.classList.remove("hidden");
  worldBreadcrumb.classList.remove("hidden");
  sessionControls.classList.remove("hidden");
  btnBulkActionsMenu.classList.remove("hidden");
  btnBackupsMenu.classList.remove("hidden");
  btnSaveToWorld.classList.remove("hidden");

  currentWorldName.textContent = snapshot.worldName;

  await checkProfessionDiagnostics();
  populateProfessionFilter();
  collectWorldItemCatalog();
  renderVillagersList();
  renderStats();

  if (selectedVillagerId) {
    const v = activeVillagers.find((x) => x.sessionVillagerId === selectedVillagerId);
    if (v) renderVillagerDetail(v);
  }

  await updateSessionState();
}

async function checkProfessionDiagnostics() {
  try {
    const diag = await api.getProfessionDiagnostics();
    currentProfessionDiagnostics = diag;
    if (diag && diag.unknownCount > 0) {
      unknownProfessionBannerText.textContent = `Warning: ${diag.unknownCount} entity/villager record(s) have non-standard/unknown professions. Editing other fields preserves original profession tags safely.`;
      unknownProfessionBanner.classList.remove("hidden");
    } else {
      unknownProfessionBanner.classList.add("hidden");
    }
  } catch {}
}

function villagerMatchesProfessionFilter(
  villager,
  filterValue
) {
  if (
    !filterValue ||
    filterValue === "all"
  ) {
    return true;
  }

  if (
    filterValue === "unknown"
  ) {
    return !villager.professionKnown;
  }

  return (
    villager.professionKnown &&
    villager.profession ===
      filterValue
  );
}

function populateProfessionFilter() {
  const filter = document.getElementById("professionFilter");
  const previous = selectedProfessionFilter || "all";

  filter.replaceChildren();

  const allOption = document.createElement("option");
  allOption.value = "all";
  allOption.textContent = "All Professions";
  filter.appendChild(allOption);

  const profList = Object.values(metadata.professions || {});
  for (const p of profList) {
    const option = document.createElement("option");
    option.value = p.id;
    option.textContent = p.displayName;
    filter.appendChild(option);
  }

  if (currentProfessionDiagnostics?.unknownCount > 0) {
    const unknown = document.createElement("option");
    unknown.value = "unknown";
    unknown.textContent = "Unknown (preserved)";
    filter.appendChild(unknown);
  }

  const availableValues = new Set(
    Array.from(filter.options).map((option) => option.value)
  );

  const effectiveValue = availableValues.has(previous) ? previous : "all";

  filter.value = effectiveValue;
  selectedProfessionFilter = effectiveValue;
}

function populateProfessionEditorSelect(villager) {
  const select = document.getElementById("selectProfession");
  select.replaceChildren();

  if (!villager.professionKnown) {
    const unknown = document.createElement("option");
    unknown.value = "__unknown_preserved__";
    unknown.textContent = "Unknown (preserved)";
    unknown.disabled = true;
    unknown.selected = true;
    select.appendChild(unknown);
  }

  for (const p of Object.values(metadata.professions || {})) {
    const option = document.createElement("option");
    option.value = p.id;
    option.textContent = p.displayName;
    if (villager.professionKnown && villager.profession === p.id) {
      option.selected = true;
    }
    select.appendChild(option);
  }
}

function collectWorldItemCatalog() {
  const set = new Set();
  Object.keys(ITEM_FILE_MAP).forEach((k) => set.add(k));

  for (const v of activeVillagers) {
    for (const t of v.trades) {
      if (t.buyA && t.buyA.id) set.add(t.buyA.id);
      if (t.buyB && t.buyB.id) set.add(t.buyB.id);
      if (t.sell && t.sell.id) set.add(t.sell.id);
    }
  }

  customItemCatalog = Array.from(set).sort();
}

// -------------------------------------------------------------
// Villager List & Filtering
// -------------------------------------------------------------

function renderVillagersList() {
  const container = document.getElementById("villagersList");
  container.innerHTML = "";

  const query = villagerSearchQuery.trim().toLowerCase();

  const filtered = activeVillagers.filter((v) => {
    if (query) {
      const rawName = v.customName || "";
      const cleanName = stripMinecraftFormatting(rawName).toLowerCase();
      const prof = v.professionDisplayName.toLowerCase();
      const id = v.sessionVillagerId.toLowerCase();
      if (!cleanName.includes(query) && !rawName.toLowerCase().includes(query) && !prof.includes(query) && !id.includes(query)) return false;
    }

    if (!villagerMatchesProfessionFilter(v, selectedProfessionFilter)) {
      return false;
    }

    if (selectedTierFilter !== "all" && v.careerLevel !== parseInt(selectedTierFilter, 10)) {
      return false;
    }

    return true;
  });

  if (filtered.length === 0) {
    const p = document.createElement("p");
    p.className = "empty-placeholder";
    p.textContent = "No matching villagers found.";
    container.appendChild(p);
    return;
  }

  for (const v of filtered) {
    const item = document.createElement("div");
    item.className = `villager-item ${v.sessionVillagerId === selectedVillagerId ? "active" : ""}`;
    item.dataset.villagerId = v.sessionVillagerId;
    item.setAttribute("role", "button");
    item.tabIndex = 0;

    const icon = createProfessionIconElement(v.professionKnown ? v.profession : "unknown");

    const info = document.createElement("div");
    info.className = "villager-item-info";

    const titleRow = document.createElement("div");
    titleRow.className = "villager-item-title-row";

    const name = document.createElement("strong");
    renderMinecraftFormattedText(v.customName || v.professionDisplayName, name);
    name.title = stripMinecraftFormatting(v.customName || v.professionDisplayName);

    titleRow.appendChild(name);

    if (v.isDirty) {
      const dirtyDot = document.createElement("span");
      dirtyDot.className = "dirty-dot";
      dirtyDot.title = "Modified in session";
      titleRow.appendChild(dirtyDot);
    }

    const meta = document.createElement("span");
    meta.className = "villager-item-meta";
    meta.textContent = `${v.careerLevelName} • ${v.trades.length} trade(s)`;

    info.appendChild(titleRow);
    info.appendChild(meta);

    item.appendChild(icon);
    item.appendChild(info);

    const selectVillager = () => {
      selectedVillagerId = v.sessionVillagerId;
      renderVillagersList();
      renderVillagerDetail(v);
    };

    item.addEventListener("click", selectVillager);
    item.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectVillager();
      }
    });

    container.appendChild(item);
  }
}

function renderStats() {
  const container = document.getElementById("statsSummary");
  container.innerHTML = "";

  const total = activeVillagers.length;
  const chipTotal = document.createElement("span");
  chipTotal.className = "badge badge-dim";
  chipTotal.textContent = `Total: ${total}`;
  container.appendChild(chipTotal);

  const profCounts = {};
  for (const v of activeVillagers) {
    const p = v.professionKnown ? v.profession : "unknown";
    profCounts[p] = (profCounts[p] || 0) + 1;
  }

  for (const [prof, count] of Object.entries(profCounts)) {
    const name = metadata.professions[prof]?.displayName || (prof === "unknown" ? "Unknown" : prof);
    const chip = document.createElement("span");
    chip.className = "badge badge-meta";
    chip.textContent = `${name}: ${count}`;
    container.appendChild(chip);
  }
}

// -------------------------------------------------------------
// Villager Detail Inspector
function renderVillagerDetail(v) {
  const placeholder = document.getElementById("emptyDetailPlaceholder");
  const content = document.getElementById("activeVillagerContent");
  placeholder.classList.add("hidden");
  content.classList.remove("hidden");

  // Top Bar
  const iconWrapper = document.getElementById("detailProfIconWrapper");
  iconWrapper.innerHTML = "";
  iconWrapper.appendChild(createProfessionIconElement(v.professionKnown ? v.profession : "unknown"));

  document.getElementById("editVillagerName").value = v.customName || "";
  document.getElementById("villagerIdBadge").textContent = v.sessionVillagerId;

  document.getElementById("badgeDimension").textContent = v.dimension.toUpperCase();
  document.getElementById("badgeCoordinates").textContent = `X: ${v.position.x} Y: ${v.position.y} Z: ${v.position.z}`;

  const statusBadge = document.getElementById("badgeStatus");
  if (v.isZombie) {
    statusBadge.textContent = "Zombie Villager";
    statusBadge.classList.remove("hidden");
  } else if (v.isCured) {
    statusBadge.textContent = "Cured";
    statusBadge.classList.remove("hidden");
  } else {
    statusBadge.classList.add("hidden");
  }

  // Tab 1: Trades
  document.getElementById("tradeCountLabel").textContent = String(v.trades.length);
  renderTradesTab(v);

  // Tab 2: Profession & Level (Rebuild only detail select, never sidebar filter)
  populateProfessionEditorSelect(v);

  document.getElementById("selectCareerLevel").value = String(v.careerLevel);
  document.getElementById("inputExperience").value = String(v.experience);

  // Villager Position inputs
  document.getElementById("inputPositionX").value = String(v.position.x);
  document.getElementById("inputPositionY").value = String(v.position.y);
  document.getElementById("inputPositionZ").value = String(v.position.z);

  // Tab 3: Links & POI
  renderLinksTab(v);

  // Tab 4: Advanced NBT (Read-Only Inspection)
  void renderAdvancedTab(v);
}

function renderTradesTab(v) {
  const container = document.getElementById("tradesContainer");
  container.innerHTML = "";

  if (v.trades.length === 0) {
    const p = document.createElement("p");
    p.className = "empty-placeholder";
    p.textContent = "No trade offers defined for this villager.";
    container.appendChild(p);
    return;
  }

  v.trades.forEach((trade, index) => {
    const card = document.createElement("div");
    card.className = "trade-card";

    // Header
    const head = document.createElement("div");
    head.className = "trade-card-header";

    const title = document.createElement("span");
    title.className = "trade-title";
    title.textContent = `Offer #${index + 1} (Tier ${trade.tier})`;

    const actions = document.createElement("div");
    actions.className = "trade-actions";

    const btnRestock = document.createElement("button");
    btnRestock.type = "button";
    btnRestock.className = "btn btn-xs btn-outline";
    btnRestock.textContent = "Restock (0 Uses)";
    btnRestock.addEventListener("click", async () => {
      await executeSessionCommand({
        kind: "TRADE_RESTOCK",
        description: `Restock trade #${index + 1}`,
        villagerId: v.sessionVillagerId,
        tradeId: trade.id
      });
    });

    const btnDelete = document.createElement("button");
    btnDelete.type = "button";
    btnDelete.className = "btn btn-xs btn-danger";
    btnDelete.textContent = "Delete";
    btnDelete.addEventListener("click", async () => {
      const ok = await confirmAction({
        title: "Delete Trade",
        message: `Delete trade offer #${index + 1}?`,
        danger: true
      });
      if (!ok) return;
      await executeSessionCommand({
        kind: "TRADE_DELETE",
        description: `Delete trade offer #${index + 1}`,
        villagerId: v.sessionVillagerId,
        tradeId: trade.id
      });
    });

    actions.appendChild(btnRestock);
    actions.appendChild(btnDelete);
    head.appendChild(title);
    head.appendChild(actions);
    card.appendChild(head);

    // Trade Slot Row (BuyA + BuyB -> Sell)
    const slotRow = document.createElement("div");
    slotRow.className = "trade-slot-row";

    slotRow.appendChild(createItemSlotElement(v.sessionVillagerId, trade.id, "buyA", trade.buyA, "Buy (Slot 1)"));
    slotRow.appendChild(createItemSlotElement(v.sessionVillagerId, trade.id, "buyB", trade.buyB, "Buy (Slot 2, Optional)"));

    const arrow = document.createElement("div");
    arrow.className = "trade-arrow";
    arrow.textContent = "➔";
    slotRow.appendChild(arrow);

    slotRow.appendChild(createItemSlotElement(v.sessionVillagerId, trade.id, "sell", trade.sell, "Sell / Reward"));
    card.appendChild(slotRow);

    // Advanced Trade Settings Grid
    const advGrid = document.createElement("div");
    advGrid.className = "trade-settings-grid";

    // 1. Tier
    const tierGroup = document.createElement("div");
    tierGroup.className = "setting-group";
    const tierLabel = document.createElement("label");
    tierLabel.textContent = "Tier:";
    tierGroup.appendChild(tierLabel);

    const tierSelect = document.createElement("select");
    tierSelect.className = "input-field-sm";
    for (let t = 1; t <= 5; t++) {
      const opt = document.createElement("option");
      opt.value = String(t);
      opt.textContent = `Tier ${t}`;
      if (trade.tier === t) opt.selected = true;
      tierSelect.appendChild(opt);
    }
    tierSelect.addEventListener("change", async (e) => {
      await executeSessionCommand({
        kind: "TRADE_SET_SETTINGS",
        description: `Set trade #${index + 1} tier to ${e.target.value}`,
        villagerId: v.sessionVillagerId,
        tradeId: trade.id,
        patch: { tier: parseInt(e.target.value, 10) }
      });
    });
    tierGroup.appendChild(tierSelect);

    // 2. Max Uses
    const maxUsesGroup = document.createElement("div");
    maxUsesGroup.className = "setting-group";
    const maxUsesLabel = document.createElement("label");
    maxUsesLabel.textContent = "Max Uses:";
    maxUsesGroup.appendChild(maxUsesLabel);

    const maxUsesInput = document.createElement("input");
    maxUsesInput.type = "number";
    maxUsesInput.min = "1";
    maxUsesInput.max = "99999";
    maxUsesInput.className = "input-field-sm";
    maxUsesInput.value = String(trade.maxUses);
    maxUsesInput.addEventListener("change", async (e) => {
      const parsed = parseIntegerField(e.target.value, {
        label: "Max uses",
        min: 1,
        max: 99999
      });
      if (!parsed.ok) {
        await rejectNumericEdit(parsed.error);
        return;
      }
      await executeSessionCommand({
        kind: "TRADE_SET_SETTINGS",
        description: `Set max uses to ${parsed.value}`,
        villagerId: v.sessionVillagerId,
        tradeId: trade.id,
        patch: { maxUses: parsed.value }
      });
    });
    maxUsesGroup.appendChild(maxUsesInput);

    // 3. Uses
    const usesGroup = document.createElement("div");
    usesGroup.className = "setting-group";
    const usesLabel = document.createElement("label");
    usesLabel.textContent = "Uses (Traded):";
    usesGroup.appendChild(usesLabel);

    const usesInput = document.createElement("input");
    usesInput.type = "number";
    usesInput.min = "0";
    usesInput.max = "99999";
    usesInput.className = "input-field-sm";
    usesInput.value = String(trade.uses);
    usesInput.addEventListener("change", async (e) => {
      const parsed = parseIntegerField(e.target.value, {
        label: "Uses",
        min: 0,
        max: 99999
      });
      if (!parsed.ok) {
        await rejectNumericEdit(parsed.error);
        return;
      }
      await executeSessionCommand({
        kind: "TRADE_SET_SETTINGS",
        description: `Set traded uses to ${parsed.value}`,
        villagerId: v.sessionVillagerId,
        tradeId: trade.id,
        patch: { uses: parsed.value }
      });
    });
    usesGroup.appendChild(usesInput);

    // 4. Trader Exp
    const expGroup = document.createElement("div");
    expGroup.className = "setting-group";
    const expLabel = document.createElement("label");
    expLabel.textContent = "Trader XP:";
    expGroup.appendChild(expLabel);

    const expInput = document.createElement("input");
    expInput.type = "number";
    expInput.min = "0";
    expInput.max = "1000";
    expInput.className = "input-field-sm";
    expInput.value = String(trade.traderExp);
    expInput.addEventListener("change", async (e) => {
      const parsed = parseIntegerField(e.target.value, {
        label: "Trader XP",
        min: 0,
        max: 1000
      });
      if (!parsed.ok) {
        await rejectNumericEdit(parsed.error);
        return;
      }
      await executeSessionCommand({
        kind: "TRADE_SET_SETTINGS",
        description: `Set trader XP to ${parsed.value}`,
        villagerId: v.sessionVillagerId,
        tradeId: trade.id,
        patch: { traderExp: parsed.value }
      });
    });
    expGroup.appendChild(expInput);

    // 5. Reward XP Checkbox
    const rewardExpGroup = document.createElement("div");
    rewardExpGroup.className = "setting-group";
    const rewardExpLabel = document.createElement("label");
    rewardExpLabel.textContent = "Reward XP:";
    rewardExpGroup.appendChild(rewardExpLabel);

    const rewardExpCheck = document.createElement("input");
    rewardExpCheck.type = "checkbox";
    rewardExpCheck.checked = trade.rewardExp;
    rewardExpCheck.addEventListener("change", async (e) => {
      await executeSessionCommand({
        kind: "TRADE_SET_SETTINGS",
        description: `Set reward XP to ${e.target.checked}`,
        villagerId: v.sessionVillagerId,
        tradeId: trade.id,
        patch: { rewardExp: e.target.checked }
      });
    });
    rewardExpGroup.appendChild(rewardExpCheck);

    // 6. Demand
    const demandGroup = document.createElement("div");
    demandGroup.className = "setting-group";
    const demandLabel = document.createElement("label");
    demandLabel.textContent = "Demand:";
    demandGroup.appendChild(demandLabel);

    const demandInput = document.createElement("input");
    demandInput.type = "number";
    demandInput.min = "-1000";
    demandInput.max = "1000";
    demandInput.className = "input-field-sm";
    demandInput.value = trade.demand === undefined || trade.demand === null ? "" : String(trade.demand);
    demandInput.addEventListener("change", async (e) => {
      const parsed = parseIntegerField(e.target.value, {
        label: "Demand",
        min: -1000,
        max: 1000,
        nullable: true
      });
      if (!parsed.ok) {
        await rejectNumericEdit(parsed.error);
        return;
      }
      await executeSessionCommand({
        kind: "TRADE_SET_SETTINGS",
        description: `Set demand to ${parsed.value === null ? "null" : parsed.value}`,
        villagerId: v.sessionVillagerId,
        tradeId: trade.id,
        patch: { demand: parsed.value }
      });
    });
    demandGroup.appendChild(demandInput);

    // 7. Price Multiplier A (Exact 0 allowed)
    const multAGroup = document.createElement("div");
    multAGroup.className = "setting-group";
    const multALabel = document.createElement("label");
    multALabel.textContent = "Price Multiplier A:";
    multAGroup.appendChild(multALabel);

    const multAInput = document.createElement("input");
    multAInput.type = "number";
    multAInput.step = "0.01";
    multAInput.min = "0";
    multAInput.max = "100";
    multAInput.className = "input-field-sm";
    multAInput.value = formatDecimalDisplay(trade.priceMultiplierA);
    multAInput.addEventListener("change", async () => {
      const text = String(multAInput.value ?? "").trim();
      const value = Number(text);
      if (text === "" || !Number.isFinite(value) || value < 0 || value > 100) {
        await rejectNumericEdit("Price Multiplier A must be a number from 0 to 100.");
        return;
      }

      await executeSessionCommand({
        kind: "TRADE_SET_SETTINGS",
        description: `Set multiplier A to ${value}`,
        villagerId: v.sessionVillagerId,
        tradeId: trade.id,
        patch: { priceMultiplierA: value }
      });
    });
    multAGroup.appendChild(multAInput);

    // 8. Price Multiplier B
    const multBGroup = document.createElement("div");
    multBGroup.className = "setting-group";
    const multBLabel = document.createElement("label");
    multBLabel.textContent = "Price Multiplier B:";
    multBGroup.appendChild(multBLabel);

    const multBInput = document.createElement("input");
    multBInput.type = "number";
    multBInput.step = "0.01";
    multBInput.min = "0";
    multBInput.max = "100";
    multBInput.className = "input-field-sm";
    multBInput.value = formatDecimalDisplay(trade.priceMultiplierB);
    multBInput.addEventListener("change", async (e) => {
      const text = String(e.target.value ?? "").trim();
      let value = null;
      if (text !== "") {
        const num = Number(text);
        if (!Number.isFinite(num) || num < 0 || num > 100) {
          await rejectNumericEdit("Price Multiplier B must be blank or a number from 0 to 100.");
          return;
        }
        value = num;
      }

      await executeSessionCommand({
        kind: "TRADE_SET_SETTINGS",
        description: `Set multiplier B to ${value === null ? "null" : value}`,
        villagerId: v.sessionVillagerId,
        tradeId: trade.id,
        patch: { priceMultiplierB: value }
      });
    });
    multBGroup.appendChild(multBInput);

    advGrid.appendChild(tierGroup);
    advGrid.appendChild(maxUsesGroup);
    advGrid.appendChild(usesGroup);
    advGrid.appendChild(expGroup);
    advGrid.appendChild(rewardExpGroup);
    advGrid.appendChild(demandGroup);
    advGrid.appendChild(multAGroup);
    advGrid.appendChild(multBGroup);

    card.appendChild(advGrid);
    container.appendChild(card);
  });
}

function createItemSlotElement(villagerId, tradeId, slot, item, labelText) {
  const slotEl = document.createElement("div");
  slotEl.className = "trade-item-slot";

  const lbl = document.createElement("span");
  lbl.className = "slot-label";
  lbl.textContent = labelText;
  slotEl.appendChild(lbl);

  if (!item) {
    const emptyBtn = document.createElement("button");
    emptyBtn.type = "button";
    emptyBtn.className = "btn btn-xs btn-outline btn-slot-empty";
    emptyBtn.textContent = slot === "buyB" ? "+ Add Buy B Item" : "+ Set Item";
    emptyBtn.addEventListener("click", () => openItemPicker(villagerId, tradeId, slot));
    slotEl.appendChild(emptyBtn);
    return slotEl;
  }

  const itemDisplay = document.createElement("div");
  itemDisplay.className = "slot-item-display";

  const icon = createItemIconElement(item.id);
  icon.addEventListener("click", () => openItemPicker(villagerId, tradeId, slot));

  const infoCol = document.createElement("div");
  infoCol.className = "slot-info-col";

  const topRow = document.createElement("div");
  topRow.className = "slot-item-top-row";

  const countInput = document.createElement("input");
  countInput.type = "number";
  countInput.min = "1";
  countInput.max = "64";
  countInput.className = "input-item-count";
  countInput.value = String(item.count);
  countInput.title = "Item count";
  countInput.addEventListener("change", async (e) => {
    const parsed = parseIntegerField(e.target.value, {
      label: "Item count",
      min: 1,
      max: 64
    });
    if (!parsed.ok) {
      await rejectNumericEdit(parsed.error);
      return;
    }
    await executeSessionCommand({
      kind: "TRADE_SET_ITEM_COUNT",
      description: `Set ${slot} count to ${parsed.value}`,
      villagerId,
      tradeId,
      slot,
      count: parsed.value
    });
  });

  const nameLabel = document.createElement("span");
  nameLabel.className = "slot-item-name";
  nameLabel.textContent = item.id.replace("minecraft:", "");
  nameLabel.title = `Click to change item (${item.id})`;
  nameLabel.addEventListener("click", () => openItemPicker(villagerId, tradeId, slot));

  topRow.appendChild(countInput);
  topRow.appendChild(nameLabel);

  const changeBtn = document.createElement("button");
  changeBtn.type = "button";
  changeBtn.className = "btn btn-xs btn-outline trade-change-item";
  changeBtn.textContent = "Change Item";
  changeBtn.addEventListener("click", () => openItemPicker(villagerId, tradeId, slot));

  infoCol.appendChild(topRow);
  infoCol.appendChild(changeBtn);

  itemDisplay.appendChild(icon);
  itemDisplay.appendChild(infoCol);

  if (slot === "buyB") {
    const btnRemove = document.createElement("button");
    btnRemove.type = "button";
    btnRemove.className = "btn-slot-remove";
    btnRemove.textContent = "×";
    btnRemove.title = "Clear optional cost";
    btnRemove.addEventListener("click", async () => {
      await executeSessionCommand({
        kind: "TRADE_SET_ITEM",
        description: "Clear optional cost slot B",
        villagerId,
        tradeId,
        slot: "buyB",
        item: null
      });
    });
    itemDisplay.appendChild(btnRemove);
  }

  slotEl.appendChild(itemDisplay);

  // Enchantment Section for Sell Slot
  if (slot === "sell") {
    const enchContainer = document.createElement("div");
    enchContainer.className = "slot-enchantments";

    if (item.enchantments && item.enchantments.length > 0) {
      item.enchantments.forEach((ench, enchIdx) => {
        const chip = document.createElement("div");
        chip.className = "enchant-chip";

        const nameSpan = document.createElement("span");
        nameSpan.className = "enchant-name";

        const definition = getEnchantmentDefinition(ench.id ?? ench.name);
        const displayName = definition
          ? definition.displayName
          : (typeof ench.id === "number"
              ? `Unknown enchantment ID ${ench.id} (preserved)`
              : `Unknown enchantment "${ench.name}" (preserved)`);

        nameSpan.textContent = displayName;

        const lvlInput = document.createElement("input");
        lvlInput.type = "number";
        lvlInput.className = "enchant-lvl-input enchant-level-input";
        lvlInput.value = String(ench.level);

        if (!definition) {
          lvlInput.disabled = true;
          lvlInput.title = "Unknown enchantments are preserved read-only. You may remove them explicitly.";
        } else {
          lvlInput.min = "1";
          lvlInput.max = String(definition.maxLevel);
          lvlInput.step = "1";

          lvlInput.addEventListener("change", async () => {
            const newLevel = Number(lvlInput.value);
            if (!Number.isInteger(newLevel) || newLevel < 1 || newLevel > definition.maxLevel) {
              showToast(`${definition.displayName} supports levels 1-${definition.maxLevel}.`, "error");
              lvlInput.value = String(ench.level);
              return;
            }

            await executeSessionCommand({
              kind: "TRADE_SET_ENCHANTMENT_LEVEL",
              description: `Set ${definition.displayName} level to ${newLevel}`,
              villagerId,
              tradeId,
              slot: "sell",
              enchantmentIndex: enchIdx,
              level: newLevel
            });
          });
        }

        const btnRemoveEnch = document.createElement("button");
        btnRemoveEnch.type = "button";
        btnRemoveEnch.className = "btn-ench-remove btn-enchant-remove";
        btnRemoveEnch.textContent = "×";
        btnRemoveEnch.addEventListener("click", async () => {
          await executeSessionCommand({
            kind: "TRADE_REMOVE_ENCHANTMENT",
            description: `Remove enchantment ${displayName}`,
            villagerId,
            tradeId,
            slot: "sell",
            enchantmentIndex: enchIdx
          });
        });

        chip.appendChild(nameSpan);
        chip.appendChild(lvlInput);
        chip.appendChild(btnRemoveEnch);
        enchContainer.appendChild(chip);
      });
    }

    const btnAddEnch = document.createElement("button");
    btnAddEnch.type = "button";
    btnAddEnch.className = "btn btn-xs btn-outline btn-add-ench";
    btnAddEnch.textContent = "+ Enchantment";
    btnAddEnch.addEventListener("click", () => openEnchantPicker(villagerId, tradeId));
    enchContainer.appendChild(btnAddEnch);

    slotEl.appendChild(enchContainer);
  }

  return slotEl;
}

function appendLabeledValue(parent, label, value) {
  const div = document.createElement("div");
  const strong = document.createElement("strong");
  strong.textContent = `${label}: `;
  const span = document.createElement("span");
  span.textContent = value;
  div.appendChild(strong);
  div.appendChild(span);
  parent.appendChild(div);
}

function renderLinksTab(v) {
  const wsText = document.getElementById("linkedWsText");
  const bedText = document.getElementById("linkedBedText");

  wsText.innerHTML = "";
  if (v.linkedWorkstation) {
    const pos = v.linkedWorkstation.position;
    appendLabeledValue(wsText, "Workstation Block", v.linkedWorkstation.type);
    appendLabeledValue(wsText, "Dimension", v.linkedWorkstation.dimension);
    appendLabeledValue(wsText, "Coordinates", `(${pos.x}, ${pos.y}, ${pos.z})`);
  } else {
    wsText.textContent = "No linked job-site coordinate.";
  }

  bedText.innerHTML = "";
  if (v.linkedBed) {
    const pos = v.linkedBed.position;
    appendLabeledValue(bedText, "Dimension", v.linkedBed.dimension);
    appendLabeledValue(bedText, "Coordinates", `(${pos.x}, ${pos.y}, ${pos.z})`);
  } else {
    bedText.textContent = "No linked bed coordinate.";
  }
}

async function renderAdvancedTab(v) {
  const targetId = v.sessionVillagerId;

  const entity = document.getElementById("advEntityId");
  const source = document.getElementById("advProfSource");
  const encoding = document.getElementById("advEncodingFormat");
  const hash = document.getElementById("advOriginalHash");
  const raw = document.getElementById("advRawNbtText");

  entity.textContent = "";
  source.textContent = "";
  encoding.textContent = "";
  hash.textContent = "";
  raw.value = "";

  try {
    const debug = await api.getVillagerDebugInfo(targetId);

    if (selectedVillagerId !== targetId) {
      return;
    }

    if (!debug) {
      return;
    }

    entity.textContent = debug.identifier;
    source.textContent = debug.professionSource || "None (unresolved/inferred)";
    encoding.textContent = `${debug.nbtEncoding.format}${
      debug.nbtEncoding.prefixHex ? ` (Prefix: 0x${debug.nbtEncoding.prefixHex})` : ""
    }`;
    hash.textContent = debug.originalDbValueHash;
    raw.value = debug.rawNbtJson || "";
  } catch (error) {
    if (selectedVillagerId === targetId) {
      raw.value = "Unable to load debug data.";
    }
  }
}

// -------------------------------------------------------------
// Full Canonical Refresh & Command Execution
// -------------------------------------------------------------

function showEmptyVillagerDetail() {
  const placeholder = document.getElementById("emptyDetailPlaceholder");
  const content = document.getElementById("activeVillagerContent");
  placeholder.classList.remove("hidden");
  content.classList.add("hidden");
}

async function refreshLoadedWorldFromMain() {
  const villagers = await api.listVillagers();
  activeVillagers = Array.isArray(villagers) ? villagers : [];

  const selectedStillExists = Boolean(
    selectedVillagerId &&
      activeVillagers.some(
        (villager) => villager.sessionVillagerId === selectedVillagerId
      )
  );

  if (!selectedStillExists) {
    selectedVillagerId = activeVillagers[0]?.sessionVillagerId || null;
  }

  await updateSessionState();
  await checkProfessionDiagnostics();

  populateProfessionFilter();
  collectWorldItemCatalog();
  renderStats();
  renderVillagersList();

  if (isWorldMapOpen()) {
    drawWorldMap();
  }

  if (!selectedVillagerId) {
    showEmptyVillagerDetail();
    return;
  }

  const selected = activeVillagers.find(
    (villager) => villager.sessionVillagerId === selectedVillagerId
  );

  if (!selected) {
    showEmptyVillagerDetail();
    return;
  }

  renderVillagerDetail(selected);
}

async function executeSessionCommand(command) {
  if (isAnyOperationBusy()) {
    showToast(
      lastSessionState?.busyOperation
        ? `Cannot edit while ${lastSessionState.busyOperation} is in progress.`
        : "Please wait for the current operation to finish.",
      "warning"
    );
    return;
  }

  setUiBusy(true, "Applying edit...");

  try {
    let result;

    try {
      result = await api.executeCommand(command);
    } catch (error) {
      console.error("Session command IPC failed:", error);
      showToast("The edit could not be applied.", "error");
      try {
        await refreshLoadedWorldFromMain();
      } catch (refreshError) {
        console.error(
          "Failed refreshing after command IPC error:",
          refreshError
        );
      }
      return;
    }

    if (!result?.success) {
      showToast(
        `Action Failed: ${result?.error || "Unknown error"}`,
        "error"
      );
      try {
        await refreshLoadedWorldFromMain();
      } catch (refreshError) {
        console.error(
          "Failed refreshing after rejected command:",
          refreshError
        );
      }
      return;
    }

    await refreshLoadedWorldFromMain();
  } finally {
    setUiBusy(false);
  }
}

async function handleUndo() {
  if (isAnyOperationBusy()) {
    showToast(
      lastSessionState?.busyOperation
        ? `Cannot undo while ${lastSessionState.busyOperation} is in progress.`
        : "Please wait for the current operation to finish.",
      "warning"
    );
    return;
  }

  setUiBusy(true, "Undoing...");
  try {
    let res;
    try {
      res = await api.undo();
    } catch (error) {
      console.error("Undo IPC failed:", error);
      showToast("Undo failed.", "error");
      try {
        await refreshLoadedWorldFromMain();
      } catch {}
      return;
    }

    if (!res?.success) {
      showToast(res?.error || "Could not undo.", "error");
    }

    await refreshLoadedWorldFromMain();
  } finally {
    setUiBusy(false);
  }
}

async function handleRedo() {
  if (isAnyOperationBusy()) {
    showToast(
      lastSessionState?.busyOperation
        ? `Cannot redo while ${lastSessionState.busyOperation} is in progress.`
        : "Please wait for the current operation to finish.",
      "warning"
    );
    return;
  }

  setUiBusy(true, "Redoing...");
  try {
    let res;
    try {
      res = await api.redo();
    } catch (error) {
      console.error("Redo IPC failed:", error);
      showToast("Redo failed.", "error");
      try {
        await refreshLoadedWorldFromMain();
      } catch {}
      return;
    }

    if (!res?.success) {
      showToast(res?.error || "Could not redo.", "error");
    }

    await refreshLoadedWorldFromMain();
  } finally {
    setUiBusy(false);
  }
}

async function updateSessionState() {
  const state = await api.getSessionState();

  lastSessionState = state || {
    dirtyCount: 0,
    canUndo: false,
    canRedo: false,
    worldName: null,
    busyOperation: null,
    restartRequired: false
  };

  if (state?.restartRequired) {
    enterRestartRequiredState(state.restartMessage);
  }

  dirtyCount = lastSessionState.dirtyCount || 0;

  if (dirtyCount > 0) {
    dirtyIndicator.classList.remove("hidden");
    dirtyIndicator.textContent = `${dirtyCount} unsaved change(s)`;
  } else {
    dirtyIndicator.classList.add("hidden");
    dirtyIndicator.textContent = "";
  }

  applyControlState();
}

// -------------------------------------------------------------
// Modals & Pickers
// -------------------------------------------------------------

function openItemPicker(villagerId, tradeId, slot) {
  activeItemPickerContext = { villagerId, tradeId, slot };
  document.getElementById("itemPickerSearch").value = "";
  document.getElementById("customItemIdInput").value = "";
  renderItemPickerGrid("");
  document.getElementById("itemPickerModal").showModal();
}

function renderItemPickerGrid(query) {
  const grid = document.getElementById("itemPickerGrid");
  grid.innerHTML = "";

  const clean = query.trim().toLowerCase();
  const filtered = customItemCatalog.filter((id) => !clean || id.toLowerCase().includes(clean));

  for (const id of filtered) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "item-picker-card";

    const icon = createItemIconElement(id);
    const label = document.createElement("span");
    label.textContent = id.replace("minecraft:", "");
    label.title = id;

    card.appendChild(icon);
    card.appendChild(label);

    card.addEventListener("click", () => selectItemFromPicker(id));
    grid.appendChild(card);
  }
}

async function selectItemFromPicker(itemId) {
  if (!activeItemPickerContext) return;
  const { villagerId, tradeId, slot } = activeItemPickerContext;
  document.getElementById("itemPickerModal").close();

  const v = activeVillagers.find((x) => x.sessionVillagerId === villagerId);
  const trade = v?.trades.find((t) => t.id === tradeId);
  const currentCount = (trade && trade[slot]?.count) || 1;

  await executeSessionCommand({
    kind: "TRADE_SET_ITEM",
    description: `Set ${slot} item to ${itemId}`,
    villagerId,
    tradeId,
    slot,
    item: { id: itemId, count: currentCount }
  });
}

function openEnchantPicker(villagerId, tradeId) {
  activeItemPickerContext = { villagerId, tradeId, slot: "sell" };
  document.getElementById("enchantPickerSearch").value = "";
  renderEnchantPickerList("");
  document.getElementById("enchantPickerModal").showModal();
}

function renderEnchantPickerList(query) {
  const container = document.getElementById("enchantPickerList");
  container.replaceChildren();

  const clean = String(query || "").trim().toLowerCase();
  const allEnchants = Object.values(metadata?.enchantments || {});

  const filtered = allEnchants.filter((enchantment) => {
    if (!clean) return true;
    return (
      String(enchantment.id).includes(clean) ||
      enchantment.name.toLowerCase().includes(clean) ||
      enchantment.displayName.toLowerCase().includes(clean)
    );
  });

  filtered.sort((a, b) => a.displayName.localeCompare(b.displayName));

  for (const enchantment of filtered) {
    const row = document.createElement("div");
    row.className = "enchant-picker-row";

    const title = document.createElement("span");
    title.textContent = `${enchantment.displayName} (ID ${enchantment.id}, Max ${enchantment.maxLevel})`;

    const levelInput = document.createElement("input");
    levelInput.type = "number";
    levelInput.className = "input-field-sm";
    levelInput.min = "1";
    levelInput.max = String(enchantment.maxLevel);
    levelInput.step = "1";
    levelInput.value = "1";

    const selectButton = document.createElement("button");
    selectButton.type = "button";
    selectButton.className = "btn btn-xs btn-primary";
    selectButton.textContent = "Select";
    selectButton.addEventListener("click", async () => {
      const level = Number(levelInput.value);
      if (!Number.isInteger(level) || level < 1 || level > enchantment.maxLevel) {
        showToast(`${enchantment.displayName} supports levels 1-${enchantment.maxLevel}.`, "error");
        return;
      }
      await selectEnchantmentFromPicker(enchantment.id, level);
    });

    row.append(title, levelInput, selectButton);
    container.appendChild(row);
  }
}

async function selectEnchantmentFromPicker(enchantmentId, level) {
  if (!activeItemPickerContext) return;
  const { villagerId, tradeId } = activeItemPickerContext;
  document.getElementById("enchantPickerModal").close();

  await executeSessionCommand({
    kind: "TRADE_ADD_ENCHANTMENT",
    description: `Add enchantment (ID ${enchantmentId}) level ${level}`,
    villagerId,
    tradeId,
    slot: "sell",
    enchantmentId,
    level
  });
}

// -------------------------------------------------------------
// -------------------------------------------------------------
// Save Review & Confirmation
// -------------------------------------------------------------

async function openSaveReview() {
  if (
    isAnyOperationBusy()
  ) {
    return;
  }

  setUiBusy(
    true,
    "Preparing Save Review..."
  );

  try {
    let preview;

    try {
      preview =
        await api
          .getSavePreview();
    } catch (error) {
      console.error(
        "Save Review failed:",
        error
      );

      showToast(
        (
          "Could not prepare Save Review safely. " +
          "Reopen the world and try again."
        ),
        "error"
      );

      return;
    }

    if (
      preview
        ?.restartRequired
    ) {
      document
        .getElementById(
          "saveReviewModal"
        )
        ?.close();

      enterRestartRequiredState(
        preview
          .conflictCheckError
      );

      return;
    }

    const container = document.getElementById("saveReviewDiffContainer");
    const saveBtn = document.getElementById("btnConfirmSaveToWorld");
    container.innerHTML = "";

    saveBtn.disabled =
      preview.hasConflicts ||
      preview.modifiedVillagersCount === 0 ||
      Boolean(preview.conflictCheckError);

    if (preview.conflictCheckError) {
      const alertBox = document.createElement("div");
      alertBox.className = "alert-box alert-danger";
      alertBox.textContent = preview.conflictCheckError;
      container.appendChild(alertBox);
    } else if (preview.hasConflicts) {
      const alertBox = document.createElement("div");
      alertBox.className = "alert-box alert-danger";
      alertBox.textContent =
        "WARNING: Conflict detected. LevelDB data on disk was modified by an external process. Save is disabled to prevent overwriting changes.";
      container.appendChild(alertBox);
    }

    if (preview.modifiedVillagersCount === 0) {
      const p = document.createElement("p");
      p.className = "empty-placeholder";
      p.textContent = "No changes to save.";
      container.appendChild(p);
    } else {
      for (const diff of preview.diffs) {
        const card = document.createElement("div");
        card.className = "diff-villager-card";

        const heading = document.createElement("h4");
        const nameSpan = document.createElement("span");
        renderMinecraftFormattedText(diff.villagerName, nameSpan);
        heading.appendChild(nameSpan);
        heading.appendChild(document.createTextNode(` (${diff.profession})`));
        card.appendChild(heading);

        const ul = document.createElement("ul");
        ul.className = "diff-changes-list";
        for (const change of diff.changes) {
          const li = document.createElement("li");
          li.textContent = change;
          ul.appendChild(li);
        }
        card.appendChild(ul);
        container.appendChild(card);
      }
    }

    document.getElementById("saveReviewModal").showModal();
  } finally {
    setUiBusy(
      false
    );
  }
}

function closeSaveReview() {
  document.getElementById("saveReviewModal").close();
}

async function executeSaveToWorld() {
  if (isAnyOperationBusy()) {
    return;
  }

  closeSaveReview();
  setUiBusy(true, "Saving world...");

  let result;

  try {
    result = await api.saveToWorld();
  } catch (error) {
    showToast(
      `Save Error: ${
        error instanceof Error ? error.message : String(error)
      }`,
      "error"
    );
    setUiBusy(false);
    return;
  }

  if (result?.restartRequired) {
    showToast(
      result.error ||
        result.warning ||
        "Restart the editor before continuing.",
      "error"
    );
    setUiBusy(false);
    enterRestartRequiredState(result.error || result.warning);
    return;
  }

  if (!result?.success) {
    showToast(
      `Save Failed: ${result?.error || "Unknown error"}`,
      "error"
    );
    setUiBusy(false);
    return;
  }

  if (result.reloadRequired) {
    showToast(
      result.warning ||
        "The save was committed, but the editor must reopen the world before further edits.",
      "warning"
    );
    resetLoadedWorldUi();
    setUiBusy(false);

    if (result.restartRequired) {
      return;
    }

    await loadWorldPicker();
    return;
  }

  if (result.warning) {
    showToast(result.warning, "warning");
  } else {
    showToast(
      `Save successful. Modified ${result.modifiedCount} villager(s) and verified ${result.verifiedCount} actor record(s).`,
      "success"
    );
  }

  try {
    await refreshLoadedWorldFromMain();
  } catch (refreshError) {
    console.error("Save committed, but renderer refresh failed:", refreshError);
    showToast(
      "The save was committed and verified, but the editor UI could not refresh. Reopen the world before making more edits.",
      "warning"
    );
    resetLoadedWorldUi();
    await loadWorldPicker();
  } finally {
    setUiBusy(false);
  }
}

// -------------------------------------------------------------
// Backups Management
// -------------------------------------------------------------

async function openBackupsModal() {
  try {
    await renderBackups();
    document.getElementById("backupsModal").showModal();
  } catch (err) {
    console.error("Failed to open backups modal:", err);
    showToast(errorMessage(err, "Failed to open backups."), "error");
  }
}

async function renderBackups() {
  const container = document.getElementById("backupsListContainer");
  container.innerHTML = "";

  let backups = [];
  try {
    backups = (await api.listBackups()) || [];
  } catch (err) {
    console.error("Failed to list backups:", err);
    showToast(errorMessage(err, "Failed to list backups."), "error");
    return;
  }

  if (backups.length === 0) {
    const p = document.createElement("p");
    p.className = "empty-placeholder";
    p.textContent = "No backups found for this world.";
    container.appendChild(p);
    return;
  }

  for (const b of backups) {
    const item = document.createElement("div");
    item.className = "backup-item";

    const info = document.createElement("div");
    const dateStr = new Date(b.createdAt).toLocaleString();
    const sizeMb = (b.sizeBytes / (1024 * 1024)).toFixed(2);

    const nameEl = document.createElement("strong");
    nameEl.textContent = b.fileName;
    const metaEl = document.createElement("div");
    metaEl.className = "backup-meta";
    metaEl.textContent = `${dateStr} • ${sizeMb} MB`;

    info.appendChild(nameEl);
    info.appendChild(metaEl);

    const actions = document.createElement("div");
    actions.className = "backup-actions";

    const btnRestore = document.createElement("button");
    btnRestore.type = "button";
    btnRestore.className = "btn btn-xs btn-danger";
    btnRestore.textContent = "Restore";
    btnRestore.addEventListener("click", async () => {
      if (isAnyOperationBusy()) return;

      const ok = await confirmAction({
        title: "Restore Backup",
        message: `Restore world from backup "${b.fileName}"? Current state will be replaced.`,
        danger: true
      });
      if (!ok) return;

      if (dirtyCount > 0) {
        const discardOk = await confirmAction({
          title: "Discard Unsaved Changes",
          message: "Restoring a backup will discard your unsaved editor changes. Continue?",
          danger: true
        });
        if (!discardOk) return;
        const discarded = await discardChangesChecked();
        if (!discarded) return;
      }

      setUiBusy(true, "Restoring backup...");
      try {
        const res = await api.restoreBackup(b.id);
        if (res?.restartRequired) {
          showToast(
            res.error ||
              res.warning ||
              "Restart the editor before continuing.",
            "error"
          );
          document.getElementById("backupsModal").close();
          setUiBusy(false);
          enterRestartRequiredState(res.error || res.warning);
          return;
        }

        if (res?.success) {
          if (res.reloadRequired) {
            showToast(res.warning || "Restore succeeded, but world reload required.", "warning");
            document.getElementById("backupsModal").close();
            resetLoadedWorldUi();
            await loadWorldPicker();
            return;
          }

          showToast("World restored successfully.", "success");
          if (res.warning) {
            showToast(res.warning, "warning");
          }
          document.getElementById("backupsModal").close();
          await refreshLoadedWorldFromMain();
        } else {
          showToast(`Restore Failed: ${res?.error || "Unknown error"}`, "error");
        }
      } catch (err) {
        showToast(`Restore Error: ${err instanceof Error ? err.message : String(err)}`, "error");
      } finally {
        setUiBusy(false);
      }
    });

    const btnDelete = document.createElement("button");
    btnDelete.type = "button";
    btnDelete.className = "btn btn-xs btn-outline";
    btnDelete.textContent = "Delete";
    btnDelete.addEventListener("click", async () => {
      if (isAnyOperationBusy()) return;

      const ok = await confirmAction({
        title: "Delete Backup",
        message: `Delete backup "${b.fileName}"?`,
        danger: true
      });
      if (!ok) return;

      setUiBusy(true, "Deleting backup...");
      try {
        const res = await api.deleteBackup(b.id);
        if (res && res.error) {
          showToast(`Delete Failed: ${res.error}`, "error");
        }
        await renderBackups();
      } catch (err) {
        showToast(`Delete Error: ${errorMessage(err, "Failed to delete backup.")}`, "error");
      } finally {
        setUiBusy(false);
      }
    });

    actions.appendChild(btnRestore);
    actions.appendChild(btnDelete);

    item.appendChild(info);
    item.appendChild(actions);
    container.appendChild(item);
  }
}

async function createManualBackup() {
  if (isAnyOperationBusy()) return;

  setUiBusy(true, "Creating backup...");
  try {
    const res = await api.createBackup();
    if (res?.restartRequired) {
      document.getElementById("backupsModal")?.close();
      setUiBusy(false);
      enterRestartRequiredState(res.error);
      return;
    }

    if (res.success) {
      showToast("Backup created successfully!", "success");
      await renderBackups();
    } else {
      showToast(res?.error || "Could not create the world backup.", "error");
    }
  } catch (err) {
    showToast(`Backup Error: ${errorMessage(err, "Could not create backup.")}`, "error");
  } finally {
    setUiBusy(false);
  }
}

async function revealBackupFolderChecked() {
  try {
    const result = await api.revealBackupFolder();
    if (!result?.success) {
      showToast(
        result?.error || "Could not open the backup folder.",
        "error"
      );
    }
  } catch (error) {
    console.error("Reveal backup folder IPC failed:", error);
    showToast("Could not open the backup folder.", "error");
  }
}

// -------------------------------------------------------------
// General Confirmation Dialog (Promise-Safe, Escape-Safe)
// -------------------------------------------------------------

function confirmAction({ title, message, danger = false }) {
  return new Promise((resolve) => {
    const dialog = document.getElementById("confirmDialog");
    const titleEl = document.getElementById("confirmDialogTitle");
    const messageEl = document.getElementById("confirmDialogMessage");
    const cancelButton = document.getElementById("confirmDialogCancel");
    const acceptButton = document.getElementById("confirmDialogAccept");

    titleEl.textContent = title || "Confirm Action";
    messageEl.textContent = message || "Are you sure?";
    acceptButton.className = danger ? "btn btn-danger" : "btn btn-primary";

    let settled = false;

    const finish = (value) => {
      if (settled) return;
      settled = true;

      cancelButton.removeEventListener("click", onCancel);
      acceptButton.removeEventListener("click", onAccept);
      dialog.removeEventListener("cancel", onNativeCancel);
      dialog.removeEventListener("close", onClose);

      if (dialog.open) {
        dialog.close();
      }
      resolve(value);
    };

    const onCancel = () => finish(false);
    const onAccept = () => finish(true);
    const onNativeCancel = (event) => {
      event.preventDefault();
      finish(false);
    };
    const onClose = () => finish(false);

    cancelButton.addEventListener("click", onCancel);
    acceptButton.addEventListener("click", onAccept);
    dialog.addEventListener("cancel", onNativeCancel);
    dialog.addEventListener("close", onClose);

    dialog.showModal();
  });
}

async function confirmBulkAction(title, operation) {
  return confirmAction({
    title,
    message: `${operation} This will affect ${activeVillagers.length} loaded villager(s). Continue?`,
    danger: true
  });
}
