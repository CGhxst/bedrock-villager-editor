import assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import test from "node:test";

test("UI CONTRACT 1: public/app.js uses p.displayName and never p.name for professions", () => {
  const appJs = fs.readFileSync(path.join(process.cwd(), "public", "app.js"), "utf8");

  assert.ok(!appJs.includes("opt.textContent = p.name"), "app.js must not read p.name for options");
  assert.ok(!appJs.includes("p.name"), "app.js must not contain p.name");
  assert.ok(appJs.includes("p.displayName"), "app.js must use p.displayName");
  assert.ok(
    appJs.includes("metadata.professions[prof]?.displayName"),
    "app.js must use metadata.professions[prof]?.displayName in stats"
  );
});

test("UI CONTRACT 2: public/icons.js uses assets/items/ and assets/blocks/ without ../", () => {
  const iconsJs = fs.readFileSync(path.join(process.cwd(), "public", "icons.js"), "utf8");

  assert.ok(iconsJs.includes('ASSET_ITEMS_DIR = "assets/items/"'), "icons.js must use assets/items/");
  assert.ok(iconsJs.includes('ASSET_BLOCKS_DIR = "assets/blocks/"'), "icons.js must use assets/blocks/");
  assert.ok(!iconsJs.includes("../assets/items"), "icons.js must not contain ../assets/items");
  assert.ok(!iconsJs.includes("../assets/blocks"), "icons.js must not contain ../assets/blocks");
});

test("UI CONTRACT 3: No public files contain inline onclick= or onerror=", () => {
  const publicDir = path.join(process.cwd(), "public");
  const files = ["index.html", "app.js", "icons.js"];

  for (const f of files) {
    const content = fs.readFileSync(path.join(publicDir, f), "utf8");
    assert.ok(!content.includes("onclick="), `${f} must not contain onclick=`);
    assert.ok(!content.includes("onerror="), `${f} must not contain onerror=`);
  }
});

test("UI CONTRACT 4: index.html has no buttons containing only an empty span", () => {
  const html = fs.readFileSync(path.join(process.cwd(), "public", "index.html"), "utf8");

  // Check no button is <button ...><span id="icon..."></span></button>
  const emptySpanRegex = /<button[^>]*>\s*<span[^>]*><\/span>\s*<\/button>/i;
  assert.ok(!emptySpanRegex.test(html), "No button may contain only an empty span");

  // Check Undo / Redo visible text and labels
  assert.ok(html.includes('aria-label="Undo"'));
  assert.ok(html.includes('aria-label="Redo"'));
  assert.ok(html.includes("↶"));
  assert.ok(html.includes("↷"));
});

test("UI CONTRACT 5: Links tab is inspection-only without unlink buttons or mutation commands", () => {
  const html = fs.readFileSync(path.join(process.cwd(), "public", "index.html"), "utf8");
  const appJs = fs.readFileSync(path.join(process.cwd(), "public", "app.js"), "utf8");

  assert.ok(!html.includes("btnUnlinkWorkstation"), "index.html must not contain btnUnlinkWorkstation");
  assert.ok(!html.includes("btnUnlinkBed"), "index.html must not contain btnUnlinkBed");
  assert.ok(html.includes('id="linkedWsText"'), "linkedWsText must exist");
  assert.ok(html.includes('id="linkedBedText"'), "linkedBedText must exist");

  assert.ok(!appJs.includes("UNLINK_JOB_SITE"), "app.js must not contain UNLINK_JOB_SITE");
  assert.ok(!appJs.includes("UNLINK_BED"), "app.js must not contain UNLINK_BED");
  assert.ok(!appJs.includes("SET_JOB_SITE"), "app.js must not contain SET_JOB_SITE");
  assert.ok(!appJs.includes("SET_BED"), "app.js must not contain SET_BED");
});

test("UI CONTRACT 6: Advanced Trade Settings contain all required UI labels and controls", () => {
  const appJs = fs.readFileSync(path.join(process.cwd(), "public", "app.js"), "utf8");

  const requiredLabels = [
    "Tier:",
    "Max Uses:",
    "Uses (Traded):",
    "Trader XP:",
    "Reward XP:",
    "Demand:",
    "Price Multiplier A:",
    "Price Multiplier B:"
  ];

  for (const label of requiredLabels) {
    assert.ok(appJs.includes(label), `app.js must contain label "${label}"`);
  }
});

test("UI CONTRACT 7: Save Review disables save button when modifiedVillagersCount === 0", () => {
  const appJs = fs.readFileSync(path.join(process.cwd(), "public", "app.js"), "utf8");

  assert.ok(
    appJs.includes("preview.modifiedVillagersCount === 0"),
    "Save review must check preview.modifiedVillagersCount === 0"
  );
});

test("UI CONTRACT 8: package.json build script includes verify-public-js.js, copy-public.js, and verify-build.js", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"));
  assert.ok(pkg.scripts.build.includes("node scripts/verify-public-js.js"), "Build script must run verify-public-js.js");
  assert.ok(pkg.scripts.build.includes("node scripts/copy-public.js"), "Build script must run copy-public.js");
  assert.ok(pkg.scripts.build.includes("node scripts/verify-build.js"), "Build script must run verify-build.js");
});

test("UI CONTRACT 9: public/app.js contains zero TypeScript annotations and calls getSessionState()", () => {
  const appJs = fs.readFileSync(path.join(process.cwd(), "public", "app.js"), "utf8");

  assert.ok(!appJs.includes("as any"), "app.js must not contain 'as any'");
  assert.ok(!appJs.includes("new Set<"), "app.js must not contain generic Set constructor");
  assert.ok(appJs.includes("api.getSessionState()"), "updateSessionState must call api.getSessionState()");
});

test("UI CONTRACT 10: index.html has CSP meta tag and required action buttons", () => {
  const html = fs.readFileSync(path.join(process.cwd(), "public", "index.html"), "utf8");

  assert.ok(html.includes("Content-Security-Policy"), "index.html must have CSP meta tag");
  assert.ok(html.includes('id="btnVillagerSetCostsOne"'), "btnVillagerSetCostsOne must exist");
  assert.ok(html.includes('id="btnSetTierMaster"'), "btnSetTierMaster must exist");
  assert.ok(html.includes('id="btnApplyPosition"'), "btnApplyPosition must exist");
  assert.ok(html.includes('id="btnCopyCoordinates"'), "btnCopyCoordinates must exist");
  assert.ok(html.includes('id="btnCopyRawNbt"'), "btnCopyRawNbt must exist");
  assert.ok(html.includes('id="toastContainer"'), "toastContainer must exist");
});

test("UI CONTRACT 11: public/app.js enchantment and profession picker contracts", () => {
  const appJs = fs.readFileSync(path.join(process.cwd(), "public", "app.js"), "utf8");

  assert.ok(!appJs.includes("numericId"), "app.js must not reference nonexistent numericId");
  assert.ok(!appJs.includes(".id.toLowerCase()"), "app.js must not call toLowerCase() on numeric enchantment ID");
  assert.ok(appJs.includes("populateProfessionFilter"), "app.js must define populateProfessionFilter");
  assert.ok(appJs.includes("populateProfessionEditorSelect"), "app.js must define populateProfessionEditorSelect");
  assert.ok(appJs.includes("trade-change-item"), "app.js must include Change Item buttons for keyboard accessibility");
});

test("UI CONTRACT 12: Operation status, local busy state, full refresh, and absence of manual coordinate controls", () => {
  const html = fs.readFileSync(path.join(process.cwd(), "public", "index.html"), "utf8");
  const appJs = fs.readFileSync(path.join(process.cwd(), "public", "app.js"), "utf8");

  // operationStatus element must exist
  assert.ok(html.includes('id="operationStatus"'), "index.html must include operationStatus");

  // Manual coordinate input elements must stay absent
  const forbiddenIds = [
    "manualWsX",
    "manualWsY",
    "manualWsZ",
    "manualBedX",
    "manualBedY",
    "manualBedZ",
    "btnSetJobSite",
    "btnSetBed"
  ];
  for (const id of forbiddenIds) {
    assert.ok(!html.includes(`id="${id}"`), `index.html must NOT contain manual coordinate control #${id}`);
  }

  // app.js must have localUiBusy and refreshLoadedWorldFromMain
  assert.ok(appJs.includes("let localUiBusy"), "app.js must track localUiBusy");
  assert.ok(appJs.includes("refreshLoadedWorldFromMain"), "app.js must define refreshLoadedWorldFromMain");
  assert.ok(appJs.includes("applyControlState"), "app.js must define applyControlState");
  assert.ok(!appJs.includes("uiBusy ="), "app.js must not assign to legacy uiBusy flag directly");
});

test("UI CONTRACT 13: createItemSlotElement uses scoped villagerId and tradeId parameters", () => {
  const appJs = fs.readFileSync(path.join(process.cwd(), "public", "app.js"), "utf8");

  const startIdx = appJs.indexOf("function createItemSlotElement(");
  assert.ok(startIdx !== -1, "createItemSlotElement must exist in app.js");
  const endIdx = appJs.indexOf("function appendLabeledValue(", startIdx);
  assert.ok(endIdx !== -1, "appendLabeledValue must follow createItemSlotElement");

  const itemSlotFunction = appJs.slice(startIdx, endIdx);

  assert.ok(
    !itemSlotFunction.includes("v.sessionVillagerId"),
    "createItemSlotElement must use its villagerId parameter, not v.sessionVillagerId"
  );
  assert.ok(
    !itemSlotFunction.includes("trade.id"),
    "createItemSlotElement must use its tradeId parameter, not trade.id"
  );
  assert.ok(itemSlotFunction.includes("villagerId,"), "createItemSlotElement must reference villagerId");
  assert.ok(itemSlotFunction.includes("tradeId,"), "createItemSlotElement must reference tradeId");
});

test("UI CONTRACT 14: Unknown profession filtering semantics and state synchronization", () => {
  const appJs = fs.readFileSync(path.join(process.cwd(), "public", "app.js"), "utf8");

  assert.ok(
    appJs.includes("villagerMatchesProfessionFilter"),
    "app.js must define and use villagerMatchesProfessionFilter"
  );
  assert.ok(
    !appJs.includes("v.profession !== selectedProfessionFilter"),
    "app.js must not compare raw profession directly to selectedProfessionFilter"
  );
  assert.ok(
    appJs.includes('filterValue === "unknown"'),
    "villagerMatchesProfessionFilter must check filterValue === 'unknown'"
  );
  assert.ok(
    appJs.includes("!villager.professionKnown"),
    "villagerMatchesProfessionFilter must check !villager.professionKnown for unknown filter"
  );
  assert.ok(
    appJs.includes("selectedProfessionFilter = effectiveValue"),
    "populateProfessionFilter must synchronize selectedProfessionFilter with effectiveValue"
  );
});

test("UI CONTRACT 15: Busy inert views and button list enforcement", () => {
  const appJs = fs.readFileSync(path.join(process.cwd(), "public", "app.js"), "utf8");

  assert.ok(appJs.includes("villagerEditorView.inert = busy;"), "app.js must set villagerEditorView.inert");
  assert.ok(appJs.includes("worldPickerView.inert = busy;"), "app.js must set worldPickerView.inert");
  assert.ok(appJs.includes('"btnBackupsMenu"'), "app.js must disable btnBackupsMenu while busy");
  assert.ok(!appJs.includes('"btnBackToWorlds"'), "app.js must not reference nonexistent btnBackToWorlds");
});

test("UI CONTRACT 16: Save preview conflictCheckError handling and error boundary", () => {
  const appJs = fs.readFileSync(path.join(process.cwd(), "public", "app.js"), "utf8");

  assert.ok(
    appJs.includes("preview.conflictCheckError"),
    "openSaveReview must handle preview.conflictCheckError"
  );
  assert.ok(
    appJs.includes("Boolean(preview.conflictCheckError)"),
    "openSaveReview must disable save button when conflictCheckError is present"
  );
});

test("UI CONTRACT 17: discardChangesChecked refreshes UI and is used across all dirty-state flows", () => {
  const appJs = fs.readFileSync(path.join(process.cwd(), "public", "app.js"), "utf8");

  const discardStart = appJs.indexOf("async function discardChangesChecked()");
  assert.ok(discardStart !== -1, "discardChangesChecked must exist");
  const discardEnd = appJs.indexOf("async function closeWorldChecked()", discardStart);
  const discardFn = appJs.slice(discardStart, discardEnd !== -1 ? discardEnd : discardStart + 500);

  assert.ok(
    discardFn.includes("refreshLoadedWorldFromMain()"),
    "discardChangesChecked must call refreshLoadedWorldFromMain on success"
  );

  // Check 4 dirty flows: handleOpenWorld, handleBrowseFolder, handleSwitchWorld, and backup restore
  const openWorldStart = appJs.indexOf("async function handleOpenWorld(");
  const openWorldSlice = appJs.slice(openWorldStart, openWorldStart + 600);
  assert.ok(openWorldSlice.includes("discardChangesChecked()"), "handleOpenWorld must use discardChangesChecked");

  const browseStart = appJs.indexOf("async function handleBrowseFolder()");
  const browseSlice = appJs.slice(browseStart, browseStart + 600);
  assert.ok(browseSlice.includes("discardChangesChecked()"), "handleBrowseFolder must use discardChangesChecked");

  const switchStart = appJs.indexOf("async function handleSwitchWorld()");
  const switchSlice = appJs.slice(switchStart, switchStart + 600);
  assert.ok(switchSlice.includes("discardChangesChecked()"), "handleSwitchWorld must use discardChangesChecked");

  assert.ok(appJs.includes("const discarded = await discardChangesChecked();"), "Backup restore must use discardChangesChecked");
});

test("UI CONTRACT 18: executeSessionCommand error boundary and rejected input recovery", () => {
  const appJs = fs.readFileSync(path.join(process.cwd(), "public", "app.js"), "utf8");

  const cmdStart = appJs.indexOf("async function executeSessionCommand(");
  assert.ok(cmdStart !== -1, "executeSessionCommand must exist");
  const cmdEnd = appJs.indexOf("async function handleUndo()", cmdStart);
  const cmdFn = appJs.slice(cmdStart, cmdEnd !== -1 ? cmdEnd : cmdStart + 800);

  assert.ok(cmdFn.includes("try {"), "executeSessionCommand must wrap command execution in try/catch");
  assert.ok(cmdFn.includes("await refreshLoadedWorldFromMain()"), "executeSessionCommand must call refreshLoadedWorldFromMain");
  assert.ok(
    cmdFn.includes("Failed refreshing after rejected command"),
    "executeSessionCommand must attempt recovery refresh on rejected command"
  );
});

test("UI CONTRACT 19: Backup folder reveal error boundary and absence of direct unawaited call", () => {
  const appJs = fs.readFileSync(path.join(process.cwd(), "public", "app.js"), "utf8");

  assert.ok(
    !appJs.includes("() => api.revealBackupFolder()"),
    "app.js must not contain raw unhandled () => api.revealBackupFolder()"
  );
  assert.ok(
    appJs.includes("revealBackupFolderChecked"),
    "app.js must define and use revealBackupFolderChecked"
  );
});

test("UI CONTRACT 20: Native folder chooser is wrapped in OperationGate", () => {
  const ipcHandlersTs = fs.readFileSync(
    path.join(process.cwd(), "src", "main", "ipcHandlers.ts"),
    "utf8"
  );

  const chooseIdx = ipcHandlersTs.indexOf('"dialog:chooseFolder",\n    mainWindow');
  assert.ok(chooseIdx !== -1, "dialog:chooseFolder handler must exist in ipcHandlers.ts");

  const chooseSlice = ipcHandlersTs.slice(chooseIdx, chooseIdx + 1200);
  const gateIdx = chooseSlice.indexOf('operationGate.run("Choosing world folder"');
  const dialogIdx = chooseSlice.indexOf("dialog.showOpenDialog");

  assert.ok(gateIdx !== -1, "dialog:chooseFolder must invoke operationGate.run");
  assert.ok(dialogIdx !== -1, "dialog:chooseFolder must call dialog.showOpenDialog");
  assert.ok(
    gateIdx < dialogIdx,
    "operationGate.run must wrap dialog.showOpenDialog so main process is gated during dialog"
  );
});

test("UI CONTRACT 21: Numeric input validation contract", () => {
  const appJs = fs.readFileSync(path.join(process.cwd(), "public", "app.js"), "utf8");

  assert.ok(
    !appJs.includes("parseInt(e.target.value, 10) || 0"),
    "app.js must not contain silent parseInt || 0 coercion"
  );
  assert.ok(
    !appJs.includes("parseInt(e.target.value, 10) || 1"),
    "app.js must not contain silent parseInt || 1 coercion"
  );
  assert.ok(
    !appJs.includes("const count = parseInt("),
    "app.js must not use raw parseInt for item count"
  );
  assert.ok(
    !appJs.includes("parseFloat(val)"),
    "app.js must not use raw parseFloat(val) without finite/range check"
  );

  assert.ok(appJs.includes("parseIntegerField"), "app.js must define and use parseIntegerField");
  assert.ok(appJs.includes("rejectNumericEdit"), "app.js must define and use rejectNumericEdit");
});

test("UI CONTRACT 22: Renderer session serialization contract", () => {
  const appJs = fs.readFileSync(path.join(process.cwd(), "public", "app.js"), "utf8");

  const functionsToCheck = [
    "async function executeSessionCommand(",
    "async function handleUndo()",
    "async function handleRedo()",
    "async function discardChangesChecked()",
    "async function closeWorldChecked()"
  ];

  for (const fnSig of functionsToCheck) {
    const fnStart = appJs.indexOf(fnSig);
    assert.ok(fnStart !== -1, `${fnSig} must exist in app.js`);
    const fnBody = appJs.slice(fnStart, fnStart + 2500);
    assert.ok(fnBody.includes("setUiBusy(true"), `${fnSig} must setUiBusy(true)`);
    assert.ok(fnBody.includes("setUiBusy(false)"), `${fnSig} must setUiBusy(false) in finally block`);
  }
});

test("UI CONTRACT 23: Restart required UI contract", () => {
  const html = fs.readFileSync(path.join(process.cwd(), "public", "index.html"), "utf8");
  const appJs = fs.readFileSync(path.join(process.cwd(), "public", "app.js"), "utf8");

  assert.ok(html.includes('id="restartRequiredBanner"'), "index.html must have restartRequiredBanner");
  assert.ok(html.includes('id="restartRequiredBannerText"'), "index.html must have restartRequiredBannerText");

  assert.ok(appJs.includes("localRestartRequired"), "app.js must track localRestartRequired");
  assert.ok(appJs.includes("enterRestartRequiredState"), "app.js must define enterRestartRequiredState");
  assert.ok(appJs.includes("lastSessionState?.restartRequired"), "app.js must inspect lastSessionState?.restartRequired");
});

test("UI CONTRACT 24: rejectNumericEdit local serialization contract", () => {
  const appJs = fs.readFileSync(path.join(process.cwd(), "public", "app.js"), "utf8");

  const fnStart = appJs.indexOf("async function rejectNumericEdit(");
  assert.ok(fnStart !== -1, "rejectNumericEdit must exist");
  const fnBody = appJs.slice(fnStart, fnStart + 1000);

  assert.ok(fnBody.includes("localRestartRequired"), "rejectNumericEdit must check localRestartRequired");
  assert.ok(fnBody.includes("setUiBusy(true"), "rejectNumericEdit must setUiBusy(true)");
  assert.ok(fnBody.includes("refreshLoadedWorldFromMain()"), "rejectNumericEdit must call refreshLoadedWorldFromMain");
  assert.ok(fnBody.includes("finally"), "rejectNumericEdit must have finally block");
  assert.ok(fnBody.includes("setUiBusy(false)"), "rejectNumericEdit must setUiBusy(false) in finally block");
});

test("UI CONTRACT 25: every literal getElementById target in app.js exists in index.html", () => {
  const appJs = fs.readFileSync(path.join(process.cwd(), "public", "app.js"), "utf8");
  const html = fs.readFileSync(path.join(process.cwd(), "public", "index.html"), "utf8");

  const htmlIds = new Set([...html.matchAll(/\bid=["']([^"']+)["']/g)].map((match) => match[1]!));
  const literalRendererIds = new Set(
    [...appJs.matchAll(/getElementById\(\s*["']([^"']+)["']\s*\)/g)].map((match) => match[1]!)
  );

  const missing = [...literalRendererIds].filter((id) => !htmlIds.has(id));
  assert.deepStrictEqual(missing, [], `Renderer references missing DOM IDs: ${missing.join(", ")}`);
});

test("UI CONTRACT 26: every literal renderer command kind is accepted by sessionCommandSchema", () => {
  const appJs = fs.readFileSync(path.join(process.cwd(), "public", "app.js"), "utf8");
  const validationTs = fs.readFileSync(
    path.join(process.cwd(), "src", "core", "validation.ts"),
    "utf8"
  );

  const rendererKinds = new Set(
    [...appJs.matchAll(/\bkind\s*:\s*["']([A-Z][A-Z0-9_]*)["']/g)].map((match) => match[1]!)
  );

  const schemaKinds = new Set(
    [...validationTs.matchAll(/\bkind\s*:\s*z\.literal\(\s*["']([A-Z][A-Z0-9_]*)["']\s*\)/g)].map(
      (match) => match[1]!
    )
  );

  const unsupported = [...rendererKinds].filter((kind) => !schemaKinds.has(kind));
  assert.deepStrictEqual(
    unsupported,
    [],
    `Renderer emits command kinds missing from sessionCommandSchema: ${unsupported.join(", ")}`
  );
});

test("UI CONTRACT 27: single-villager quick actions use existing DOM IDs and supported bulk commands", () => {
  const appJs = fs.readFileSync(path.join(process.cwd(), "public", "app.js"), "utf8");

  assert.ok(appJs.includes('"btnVillagerHighStock"'));
  assert.ok(!appJs.includes('"btnVillagerMaxUses"'));
  assert.ok(!appJs.includes('"SET_TRADE_COSTS_ONE"'));
  assert.ok(!appJs.includes('"RESTOCK_VILLAGER"'));
  assert.ok(!appJs.includes('"SET_VILLAGER_MAX_USES"'));

  const quickStart = appJs.indexOf("// Quick Action Buttons");
  const quickEnd = appJs.indexOf('"btnAddTrade"', quickStart);
  assert.ok(quickStart !== -1 && quickEnd > quickStart);

  const quickSlice = appJs.slice(quickStart, quickEnd);

  for (const kind of ["BULK_SET_COST_QUANTITY_ONE", "BULK_RESTOCK", "BULK_SET_MAX_USES"]) {
    assert.ok(quickSlice.includes(`"${kind}"`), `Missing ${kind} in single-villager quick actions`);
  }

  const oneVillagerArrays = quickSlice.match(/villagerIds\s*:\s*\[\s*selectedVillagerId\s*\]/g) || [];
  assert.strictEqual(
    oneVillagerArrays.length,
    3,
    "All three quick actions must target exactly [selectedVillagerId]"
  );
});

test("UI CONTRACT 28: Save Preview owns main OperationGate and renderer local busy state", () => {
  const ipcTs = fs.readFileSync(
    path.join(process.cwd(), "src", "main", "ipcHandlers.ts"),
    "utf8"
  );
  const appJs = fs.readFileSync(path.join(process.cwd(), "public", "app.js"), "utf8");

  const registerStart = ipcTs.indexOf("export function registerIpcHandlers(");
  assert.ok(registerStart !== -1);

  const handlerStart = ipcTs.indexOf('"world:savePreview"', registerStart);
  assert.ok(handlerStart !== -1);
  const handlerEnd = ipcTs.indexOf('"world:save"', handlerStart + 20);
  const handlerSlice = ipcTs.slice(handlerStart, handlerEnd);

  assert.ok(handlerSlice.includes("operationGate.run("));
  assert.ok(handlerSlice.includes('"Preparing save review"'));
  assert.ok(handlerSlice.includes("hasWriteConflicts"));

  const previewStart = appJs.indexOf("async function openSaveReview()");
  const previewEnd = appJs.indexOf("function closeSaveReview()", previewStart);
  const previewSlice = appJs.slice(previewStart, previewEnd);

  assert.ok(previewSlice.includes("isAnyOperationBusy()"));
  assert.ok(previewSlice.includes("setUiBusy("));
  assert.ok(previewSlice.includes('"Preparing Save Review..."'));
  assert.ok(previewSlice.includes("finally"));
  assert.ok(previewSlice.includes("setUiBusy("));
});

test("UI CONTRACT 29: both world open paths mark storage restart state for typed fatal errors", () => {
  const ipcTs = fs.readFileSync(
    path.join(process.cwd(), "src", "main", "ipcHandlers.ts"),
    "utf8"
  );

  const registerStart = ipcTs.indexOf("export function registerIpcHandlers(");
  assert.ok(registerStart !== -1);

  function handlerSlice(channel: string, nextChannel?: string) {
    const start = ipcTs.indexOf(`"${channel}"`, registerStart);
    assert.ok(start !== -1, `${channel} handler missing`);
    const end = nextChannel
      ? ipcTs.indexOf(`"${nextChannel}"`, start + channel.length + 2)
      : start + 5000;
    return ipcTs.slice(start, end > start ? end : start + 5000);
  }

  const openSlice = handlerSlice("world:open", "world:close");
  const chooseSlice = handlerSlice("dialog:chooseFolder", "metadata:get");

  const entries: [string, string][] = [
    ["world:open", openSlice],
    ["dialog:chooseFolder", chooseSlice]
  ];

  for (const [name, slice] of entries) {
    assert.ok(
      slice.includes("isRestartRequiredStorageError"),
      `${name} must detect typed storage fatal errors`
    );
    assert.ok(
      slice.includes("markStorageRestartRequired"),
      `${name} must mark main StorageHealth restart state`
    );
    assert.ok(
      slice.includes("restartRequired: true") || slice.includes("restartRequired:"),
      `${name} must report restartRequired to renderer`
    );
  }
});

test("UI CONTRACT 30: world:close failure reports restartRequired and renderer enters restart-required state", () => {
  const ipcTs = fs.readFileSync(
    path.join(process.cwd(), "src", "main", "ipcHandlers.ts"),
    "utf8"
  );
  const preloadTs = fs.readFileSync(
    path.join(process.cwd(), "src", "main", "preload.ts"),
    "utf8"
  );
  const appJs = fs.readFileSync(path.join(process.cwd(), "public", "app.js"), "utf8");

  const registerStart = ipcTs.indexOf("export function registerIpcHandlers(");
  assert.ok(registerStart !== -1);

  const closeStart = ipcTs.indexOf('"world:close"', registerStart);
  const closeEnd = ipcTs.indexOf('"session:discardChanges"', closeStart);
  const closeSlice = ipcTs.slice(closeStart, closeEnd);

  assert.ok(closeSlice.includes("storageHealth.quarantine("), "world:close must quarantine manager on error");
  assert.ok(closeSlice.includes("restartRequired: true"), "world:close must return restartRequired: true on close error");

  assert.ok(preloadTs.includes("closeWorld: () => Promise<{ success: boolean; restartRequired?: boolean; error?: string }>;"));

  const closeWorldFnStart = appJs.indexOf("async function closeWorldChecked()");
  const closeWorldFnEnd = appJs.indexOf("async function handleOpenWorld(", closeWorldFnStart);
  const closeWorldFnSlice = appJs.slice(closeWorldFnStart, closeWorldFnEnd);

  assert.ok(closeWorldFnSlice.includes("result?.restartRequired"), "closeWorldChecked must check result?.restartRequired");
  assert.ok(closeWorldFnSlice.includes("enterRestartRequiredState("), "closeWorldChecked must call enterRestartRequiredState");
});

test("UI CONTRACT 31: typed post-save canonical reload error cannot be downgraded by cleanup close", () => {
  const ipcTs = fs.readFileSync(
    path.join(process.cwd(), "src", "main", "ipcHandlers.ts"),
    "utf8"
  );

  const catchStart = ipcTs.indexOf(
    'console.error("Save committed, but canonical reload failed:"'
  );
  assert.ok(catchStart !== -1);

  const catchEnd = ipcTs.indexOf('"world:backup"', catchStart);
  const slice = ipcTs.slice(catchStart, catchEnd);

  const typedIdx = slice.indexOf("isRestartRequiredStorageError");
  const committedHelperIdx = slice.indexOf(
    "handleCommittedRestartRequiredStorageFailure"
  );
  const ordinaryIdx = slice.indexOf("quarantineAfterReloadFailure");

  assert.ok(typedIdx !== -1, "Must check isRestartRequiredStorageError in save reload catch");
  assert.ok(committedHelperIdx !== -1, "Must call handleCommittedRestartRequiredStorageFailure");
  assert.ok(ordinaryIdx !== -1, "Must have fallback quarantineAfterReloadFailure");
  assert.ok(typedIdx < ordinaryIdx, "Typed check must precede ordinary quarantine");
  assert.ok(committedHelperIdx < ordinaryIdx, "Committed helper must precede ordinary quarantine");
});

test("UI CONTRACT 32: typed post-restore canonical reload error cannot be downgraded by cleanup close", () => {
  const ipcTs = fs.readFileSync(
    path.join(process.cwd(), "src", "main", "ipcHandlers.ts"),
    "utf8"
  );

  const catchStart = ipcTs.indexOf(
    'console.error("Restore committed, but canonical reload failed:"'
  );
  assert.ok(catchStart !== -1);

  const catchEnd = ipcTs.indexOf('"backup:delete"', catchStart);
  const slice = ipcTs.slice(catchStart, catchEnd);

  const typedIdx = slice.indexOf("isRestartRequiredStorageError");
  const committedHelperIdx = slice.indexOf(
    "handleCommittedRestartRequiredStorageFailure"
  );
  const ordinaryIdx = slice.indexOf("quarantineAfterReloadFailure");

  assert.ok(typedIdx !== -1, "Must check isRestartRequiredStorageError in restore reload catch");
  assert.ok(committedHelperIdx !== -1, "Must call handleCommittedRestartRequiredStorageFailure");
  assert.ok(ordinaryIdx !== -1, "Must have fallback quarantineAfterReloadFailure");
  assert.ok(typedIdx < ordinaryIdx, "Typed check must precede ordinary quarantine");
  assert.ok(committedHelperIdx < ordinaryIdx, "Committed helper must precede ordinary quarantine");
});

test("UI CONTRACT 33: renderer handles committed save/restore with restartRequired before success/failure branching", () => {
  const appJs = fs.readFileSync(path.join(process.cwd(), "public", "app.js"), "utf8");

  // Save: executeSaveToWorld
  const saveFnStart = appJs.indexOf("async function executeSaveToWorld()");
  assert.ok(saveFnStart !== -1);
  const saveFnEnd = appJs.indexOf("async function createManualBackup()", saveFnStart);
  const saveFnSlice = appJs.slice(saveFnStart, saveFnEnd);

  const saveRestartIdx = saveFnSlice.indexOf("result?.restartRequired");
  const saveSuccessIdx = saveFnSlice.indexOf("if (!result?.success)");
  assert.ok(saveRestartIdx !== -1, "executeSaveToWorld must check restartRequired");
  assert.ok(saveSuccessIdx !== -1, "executeSaveToWorld must check !result?.success");
  assert.ok(saveRestartIdx < saveSuccessIdx, "restartRequired check must precede !result?.success in save");

  // Restore: renderBackups restore handler
  const restoreFnStart = appJs.indexOf("api.restoreBackup(");
  assert.ok(restoreFnStart !== -1);
  const restoreFnSlice = appJs.slice(restoreFnStart, restoreFnStart + 2000);

  const restoreRestartIdx = restoreFnSlice.indexOf("res?.restartRequired");
  const restoreSuccessIdx = restoreFnSlice.indexOf("if (res?.success)");
  assert.ok(restoreRestartIdx !== -1, "Restore handler must check restartRequired");
  assert.ok(restoreSuccessIdx !== -1, "Restore handler must check res?.success");
  assert.ok(restoreRestartIdx < restoreSuccessIdx, "restartRequired check must precede res?.success in restore");
});


test("UI CONTRACT 34: read-only world map exposes terrain canvas and villager-selection controls", () => {
  const html = fs.readFileSync(path.join(process.cwd(), "public", "index.html"), "utf8");
  const appJs = fs.readFileSync(path.join(process.cwd(), "public", "app.js"), "utf8");
  const preloadTs = fs.readFileSync(path.join(process.cwd(), "src", "main", "preload.ts"), "utf8");
  const ipcTs = fs.readFileSync(path.join(process.cwd(), "src", "main", "ipcHandlers.ts"), "utf8");
  const worldMapTs = fs.readFileSync(path.join(process.cwd(), "src", "core", "worldMap.ts"), "utf8");

  for (const id of [
    "btnOpenWorldMap",
    "worldMapModal",
    "worldMapCanvas",
    "worldMapDimension",
    "btnWorldMapCenterSelected",
    "btnWorldMapFitVillagers",
    "btnWorldMapEditSelected"
  ]) {
    assert.ok(html.includes(`id="${id}"`), `Missing world-map DOM id ${id}`);
  }

  assert.ok(appJs.includes("api.getWorldMapTile("));
  assert.ok(appJs.includes("selectVillagerFromWorldMap"));
  assert.ok(preloadTs.includes('ipcRenderer.invoke("world:mapTile"'));
  assert.ok(ipcTs.includes('"world:mapTile"'));
  assert.ok(ipcTs.includes("worldMapTileRequestSchema.safeParse"));
  assert.ok(!/\.(?:put|delete|del|compact)\s*\(/.test(worldMapTs));
});

test("UI CONTRACT 35: world-map reads are tracked with MapReadBarrier and guarded before shared-DB operations", () => {
  const ipcTs = fs.readFileSync(
    path.join(process.cwd(), "src", "main", "ipcHandlers.ts"),
    "utf8"
  );

  assert.ok(ipcTs.includes("import { MapReadBarrier } from \"./mapReadBarrier\";"));
  assert.ok(ipcTs.includes("const mapReadBarrier = new MapReadBarrier();"));
  assert.ok(!ipcTs.includes("const activeMapReads = new Set"));
  assert.ok(!ipcTs.includes("waitForActiveMapReads"));

  function assertWaitBeforeOperation(
    label: string,
    slice: string,
    waitPattern: string,
    opPattern: string
  ) {
    const waitIdx = slice.indexOf(waitPattern);
    const opIdx = slice.indexOf(opPattern);
    assert.ok(waitIdx !== -1, `${label}: missing wait call "${waitPattern}" in slice`);
    assert.ok(opIdx !== -1, `${label}: missing operation "${opPattern}" in slice`);
    assert.ok(
      waitIdx < opIdx,
      `${label}: wait call must precede lifecycle operation (wait at ${waitIdx}, op at ${opIdx})`
    );
  }

  const regStart = ipcTs.indexOf("export function registerIpcHandlers(");
  assert.ok(regStart !== -1, "registerIpcHandlers definition not found");

  // 1. Candidate world commit slice
  const commitStart = ipcTs.indexOf("async function commitCandidateWorld(", regStart);
  const commitEnd = ipcTs.indexOf('handleTrusted<WorldChoice[]>("world:list"', commitStart);
  assert.ok(commitStart !== -1 && commitEnd !== -1, "commitCandidateWorld slice markers not found");
  assertWaitBeforeOperation(
    "commitCandidateWorld",
    ipcTs.slice(commitStart, commitEnd),
    "await mapReadBarrier.drain()",
    "await previousManager.close()"
  );

  // 2. world:close handler
  const closeStart = ipcTs.indexOf('"world:close"', regStart);
  const closeEnd = ipcTs.indexOf('"session:discardChanges"', closeStart);
  assert.ok(closeStart !== -1 && closeEnd !== -1, "world:close slice markers not found");
  assertWaitBeforeOperation(
    "world:close",
    ipcTs.slice(closeStart, closeEnd),
    "await mapReadBarrier.drain()",
    "await manager.close()"
  );

  // 3. session:discardChanges handler
  const discardStart = ipcTs.indexOf('"session:discardChanges"', regStart);
  const discardEnd = ipcTs.indexOf('"villager:list"', discardStart);
  assert.ok(discardStart !== -1 && discardEnd !== -1, "session:discardChanges slice markers not found");
  assertWaitBeforeOperation(
    "session:discardChanges",
    ipcTs.slice(discardStart, discardEnd),
    "await mapReadBarrier.drainAndRequireHealthy(",
    "await activeDbManager.dumpVillagers()"
  );

  // 4. world:savePreview handler
  const previewStart = ipcTs.indexOf('"world:savePreview"', regStart);
  const previewEnd = ipcTs.indexOf('"world:save"', previewStart);
  assert.ok(previewStart !== -1 && previewEnd !== -1, "world:savePreview slice markers not found");
  assertWaitBeforeOperation(
    "world:savePreview",
    ipcTs.slice(previewStart, previewEnd),
    "await mapReadBarrier.drainAndRequireHealthy(",
    "hasWriteConflicts"
  );

  // 5. world:save handler
  const saveStart = ipcTs.indexOf('"world:save"', regStart);
  const saveEnd = ipcTs.indexOf('"world:backup"', saveStart);
  assert.ok(saveStart !== -1 && saveEnd !== -1, "world:save slice markers not found");
  assertWaitBeforeOperation(
    "world:save",
    ipcTs.slice(saveStart, saveEnd),
    "await mapReadBarrier.drainAndRequireHealthy(",
    "applyDirtyVillagers"
  );

  // 6. world:backup handler
  const backupStart = ipcTs.indexOf('"world:backup"', regStart);
  const backupEnd = ipcTs.indexOf('"backup:list"', backupStart);
  assert.ok(backupStart !== -1 && backupEnd !== -1, "world:backup slice markers not found");
  assertWaitBeforeOperation(
    "world:backup",
    ipcTs.slice(backupStart, backupEnd),
    "await mapReadBarrier.drainAndRequireHealthy(",
    "await activeDbManager.createBackup()"
  );

  // 7. backup:restore handler
  const restoreStart = ipcTs.indexOf('"backup:restore"', regStart);
  const restoreEnd = ipcTs.indexOf('"backup:delete"', restoreStart);
  assert.ok(restoreStart !== -1 && restoreEnd !== -1, "backup:restore slice markers not found");
  assertWaitBeforeOperation(
    "backup:restore",
    ipcTs.slice(restoreStart, restoreEnd),
    "await mapReadBarrier.drainAndRequireHealthy(",
    "restoreBackupById"
  );

  // 8. disposeStorage controller
  const disposeStart = ipcTs.indexOf("disposeStorage: async () => {", regStart);
  const disposeEnd = ipcTs.indexOf("};", disposeStart);
  assert.ok(disposeStart !== -1 && disposeEnd !== -1, "disposeStorage slice markers not found");
  assertWaitBeforeOperation(
    "disposeStorage",
    ipcTs.slice(disposeStart, disposeEnd),
    "await mapReadBarrier.drain()",
    "await storageHealth.disposeAll("
  );
});

test("UI CONTRACT 36: restart-required map storage failures enter global restart-required state", () => {
  const ipcTs = fs.readFileSync(path.join(process.cwd(), "src", "main", "ipcHandlers.ts"), "utf8");
  const appJs = fs.readFileSync(path.join(process.cwd(), "public", "app.js"), "utf8");
  const regStart = ipcTs.indexOf("export function registerIpcHandlers(");
  assert.ok(regStart !== -1, "registerIpcHandlers definition not found");

  // IPC contract: world:mapTile catches RestartRequiredStorageError and quarantines inside mapReadBarrier.run
  const mapTileStart = ipcTs.indexOf('"world:mapTile"', regStart);
  const mapTileEnd = ipcTs.indexOf('"villager:debug"', mapTileStart);
  assert.ok(mapTileStart !== -1 && mapTileEnd !== -1, "world:mapTile slice markers not found in ipcHandlers.ts");
  const mapTileSlice = ipcTs.slice(mapTileStart, mapTileEnd);

  assert.ok(mapTileSlice.includes("mapReadBarrier.run("), "world:mapTile must execute inside mapReadBarrier.run");
  assert.ok(mapTileSlice.includes("isRestartRequiredStorageError(error)"), "world:mapTile must check isRestartRequiredStorageError(error)");
  assert.ok(mapTileSlice.includes("storageHealth.quarantine("), "world:mapTile must call storageHealth.quarantine");
  assert.ok(mapTileSlice.includes("restartRequired: true"), "world:mapTile must return restartRequired: true");

  // Renderer contract: loadQueuedWorldMapTile reacts to restartRequired
  const loadTileStart = appJs.indexOf("async function loadQueuedWorldMapTile(item)");
  const loadTileEnd = appJs.indexOf("function drainWorldMapTileQueue()", loadTileStart);
  assert.ok(loadTileStart !== -1 && loadTileEnd !== -1, "loadQueuedWorldMapTile slice markers not found in app.js");
  const loadTileSlice = appJs.slice(loadTileStart, loadTileEnd);

  assert.ok(loadTileSlice.includes("result?.restartRequired"), "loadQueuedWorldMapTile must check result?.restartRequired");
  assert.ok(loadTileSlice.includes("enterRestartRequiredState("), "loadQueuedWorldMapTile must call enterRestartRequiredState");
});

test("UI CONTRACT 37: MapReadBarrier post-drain health check and cleanup slice contracts", () => {
  const ipcTs = fs.readFileSync(path.join(process.cwd(), "src", "main", "ipcHandlers.ts"), "utf8");
  const regStart = ipcTs.indexOf("export function registerIpcHandlers(");
  assert.ok(regStart !== -1, "registerIpcHandlers definition not found");

  // A. world:mapTile uses mapReadBarrier.run and storageHealth.quarantine inside it
  const mapTileStart = ipcTs.indexOf('"world:mapTile"', regStart);
  const mapTileEnd = ipcTs.indexOf('"villager:debug"', mapTileStart);
  const mapTileSlice = ipcTs.slice(mapTileStart, mapTileEnd);
  const runIdx = mapTileSlice.indexOf("mapReadBarrier.run(");
  const quarantineIdx = mapTileSlice.indexOf("storageHealth.quarantine(");
  assert.ok(runIdx !== -1 && quarantineIdx !== -1 && runIdx < quarantineIdx, "quarantine must be inside mapReadBarrier.run");

  // B. session:discardChanges uses drainAndRequireHealthy before dumpVillagers
  const discardStart = ipcTs.indexOf('"session:discardChanges"', regStart);
  const discardEnd = ipcTs.indexOf('"villager:list"', discardStart);
  const discardSlice = ipcTs.slice(discardStart, discardEnd);
  assert.ok(
    discardSlice.indexOf("await mapReadBarrier.drainAndRequireHealthy(") <
      discardSlice.indexOf("await activeDbManager.dumpVillagers()"),
    "discardChanges must drainAndRequireHealthy before dumpVillagers"
  );

  // C. world:savePreview uses drainAndRequireHealthy before hasWriteConflicts
  const previewStart = ipcTs.indexOf('"world:savePreview"', regStart);
  const previewEnd = ipcTs.indexOf('"world:save"', previewStart);
  const previewSlice = ipcTs.slice(previewStart, previewEnd);
  assert.ok(
    previewSlice.indexOf("await mapReadBarrier.drainAndRequireHealthy(") <
      previewSlice.indexOf("hasWriteConflicts"),
    "savePreview must drainAndRequireHealthy before hasWriteConflicts"
  );

  // D. world:save uses drainAndRequireHealthy before applyDirtyVillagers
  const saveStart = ipcTs.indexOf('"world:save"', regStart);
  const saveEnd = ipcTs.indexOf('"world:backup"', saveStart);
  const saveSlice = ipcTs.slice(saveStart, saveEnd);
  assert.ok(
    saveSlice.indexOf("await mapReadBarrier.drainAndRequireHealthy(") <
      saveSlice.indexOf("applyDirtyVillagers"),
    "world:save must drainAndRequireHealthy before applyDirtyVillagers"
  );

  // E. world:backup uses drainAndRequireHealthy before createBackup
  const backupStart = ipcTs.indexOf('"world:backup"', regStart);
  const backupEnd = ipcTs.indexOf('"backup:list"', backupStart);
  const backupSlice = ipcTs.slice(backupStart, backupEnd);
  assert.ok(
    backupSlice.indexOf("await mapReadBarrier.drainAndRequireHealthy(") <
      backupSlice.indexOf("await activeDbManager.createBackup()"),
    "world:backup must drainAndRequireHealthy before createBackup"
  );

  // F. backup:restore uses drainAndRequireHealthy before restoreBackupById
  const restoreStart = ipcTs.indexOf('"backup:restore"', regStart);
  const restoreEnd = ipcTs.indexOf('"backup:delete"', restoreStart);
  const restoreSlice = ipcTs.slice(restoreStart, restoreEnd);
  assert.ok(
    restoreSlice.indexOf("await mapReadBarrier.drainAndRequireHealthy(") <
      restoreSlice.indexOf("restoreBackupById"),
    "backup:restore must drainAndRequireHealthy before restoreBackupById"
  );

  // G. world:open uses drainAndRequireHealthy before openCandidateWorld
  const openStart = ipcTs.indexOf('"world:open"', regStart);
  const openEnd = ipcTs.indexOf('"world:close"', openStart);
  const openSlice = ipcTs.slice(openStart, openEnd);
  assert.ok(
    openSlice.indexOf("await mapReadBarrier.drainAndRequireHealthy(") <
      openSlice.indexOf("await openCandidateWorld(worldPath)"),
    "world:open must drainAndRequireHealthy before openCandidateWorld"
  );

  // H. commitCandidateWorld uses mapReadBarrier.drain() before previousManager.close() and checks storageHealth.isRestartRequired() between them
  const commitStart = ipcTs.indexOf("async function commitCandidateWorld(", regStart);
  const commitEnd = ipcTs.indexOf('handleTrusted<WorldChoice[]>("world:list"', commitStart);
  const commitSlice = ipcTs.slice(commitStart, commitEnd);
  const drainIdx = commitSlice.indexOf("await mapReadBarrier.drain()");
  const checkIdx = commitSlice.indexOf("storageHealth.isRestartRequired()");
  const prevCloseIdx = commitSlice.indexOf("await previousManager.close()");
  assert.ok(drainIdx !== -1 && checkIdx !== -1 && prevCloseIdx !== -1, "commitCandidateWorld markers missing");
  assert.ok(drainIdx < checkIdx && checkIdx < prevCloseIdx, "commitCandidateWorld must drain, check restartRequired, then close previousManager");

  // I. world:close uses mapReadBarrier.drain(), NOT drainAndRequireHealthy(), before manager.close(), and contains post-cleanup restartRequired return
  const closeStart = ipcTs.indexOf('"world:close"', regStart);
  const closeEnd = ipcTs.indexOf('"session:discardChanges"', closeStart);
  const closeSlice = ipcTs.slice(closeStart, closeEnd);
  assert.ok(!closeSlice.includes("drainAndRequireHealthy"), "world:close must not use drainAndRequireHealthy");
  assert.ok(
    closeSlice.indexOf("await mapReadBarrier.drain()") < closeSlice.indexOf("await manager.close()"),
    "world:close must drain before manager.close"
  );
  assert.ok(
    closeSlice.includes("if (storageHealth.isRestartRequired())"),
    "world:close must check storageHealth.isRestartRequired() after cleanup"
  );

  // J. disposeStorage uses mapReadBarrier.drain(), NOT drainAndRequireHealthy(), before storageHealth.disposeAll()
  const disposeStart = ipcTs.indexOf("disposeStorage: async () => {", regStart);
  const disposeEnd = ipcTs.indexOf("};", disposeStart);
  const disposeSlice = ipcTs.slice(disposeStart, disposeEnd);
  assert.ok(!disposeSlice.includes("drainAndRequireHealthy"), "disposeStorage must not use drainAndRequireHealthy");
  assert.ok(
    disposeSlice.indexOf("await mapReadBarrier.drain()") < disposeSlice.indexOf("await storageHealth.disposeAll("),
    "disposeStorage must drain before disposeAll"
  );
});

test("UI CONTRACT 38: JSON export and re-import controls, IPC bindings, and transactional safety", () => {
  const html = fs.readFileSync(path.join(process.cwd(), "public", "index.html"), "utf8");
  const appJs = fs.readFileSync(path.join(process.cwd(), "public", "app.js"), "utf8");
  const preloadTs = fs.readFileSync(path.join(process.cwd(), "src", "main", "preload.ts"), "utf8");
  const ipcTs = fs.readFileSync(path.join(process.cwd(), "src", "main", "ipcHandlers.ts"), "utf8");

  // DOM controls
  assert.ok(html.includes('id="btnExportJson"'), "Missing btnExportJson in index.html");
  assert.ok(html.includes('id="btnImportJson"'), "Missing btnImportJson in index.html");

  // Preload bindings
  assert.ok(preloadTs.includes('ipcRenderer.invoke("villager:exportJson")'));
  assert.ok(preloadTs.includes('ipcRenderer.invoke("villager:importJson")'));

  // IPC Handlers
  assert.ok(ipcTs.includes('"villager:exportJson"'));
  assert.ok(ipcTs.includes('"villager:importJson"'));

  // App JS bindings
  assert.ok(appJs.includes("api.exportVillagersJson()"));
  assert.ok(appJs.includes("api.importVillagersJson()"));

  // Main-process gating ordering assertions for villager:importJson
  const importSliceStart = ipcTs.lastIndexOf('"villager:importJson"');
  assert.ok(importSliceStart !== -1, "Missing villager:importJson handler in ipcHandlers.ts");
  const importSliceEnd = ipcTs.indexOf("getSessionState", importSliceStart);
  const importSlice = ipcTs.slice(importSliceStart, importSliceEnd);

  const preHealthIdx = importSlice.indexOf("storageHealth.isRestartRequired()");
  const preGateIdx = importSlice.indexOf("operationGate.current");
  const dialogIdx = importSlice.indexOf("dialog.showOpenDialog");
  const postHealthIdx = importSlice.indexOf("storageHealth.isRestartRequired()", dialogIdx);
  const postGateIdx = importSlice.indexOf("operationGate.current", dialogIdx);
  const gateRunIdx = importSlice.indexOf('operationGate.run("Importing villager JSON"', dialogIdx);
  const importFuncIdx = importSlice.indexOf("importVillagersFromJson(activeSession, jsonContent)", gateRunIdx);

  assert.ok(preHealthIdx !== -1, "Missing pre-dialog health check");
  assert.ok(preGateIdx !== -1, "Missing pre-dialog operation gate check");
  assert.ok(dialogIdx !== -1, "Missing dialog.showOpenDialog");
  assert.ok(postHealthIdx !== -1, "Missing post-dialog health check");
  assert.ok(postGateIdx !== -1, "Missing post-dialog operation gate check");
  assert.ok(gateRunIdx !== -1, "Missing operationGate.run");
  assert.ok(importFuncIdx !== -1, "Missing importVillagersFromJson call");

  assert.ok(preHealthIdx < dialogIdx, "pre health check must precede showOpenDialog");
  assert.ok(preGateIdx < dialogIdx, "pre busy check must precede showOpenDialog");
  assert.ok(dialogIdx < postHealthIdx, "showOpenDialog must precede post health check");
  assert.ok(dialogIdx < postGateIdx, "showOpenDialog must precede post busy check");
  assert.ok(postHealthIdx < gateRunIdx, "post health check must precede operationGate.run");
  assert.ok(postGateIdx < gateRunIdx, "post busy check must precede operationGate.run");
  assert.ok(gateRunIdx < importFuncIdx, "operationGate.run must enclose importVillagersFromJson");
});

test("UI CONTRACT 39: Raw JSON import command is removed from renderer schemas and bindings", () => {
  const validationTs = fs.readFileSync(path.join(process.cwd(), "src", "core", "validation.ts"), "utf8");
  const appJs = fs.readFileSync(path.join(process.cwd(), "public", "app.js"), "utf8");
  const preloadTs = fs.readFileSync(path.join(process.cwd(), "src", "main", "preload.ts"), "utf8");

  assert.ok(!validationTs.includes('z.literal("IMPORT_VILLAGERS_DATA")'), "validation.ts must not contain IMPORT_VILLAGERS_DATA");
  assert.ok(!appJs.includes('"IMPORT_VILLAGERS_DATA"'), "app.js must not contain IMPORT_VILLAGERS_DATA");
  assert.ok(!preloadTs.includes("TrustedVillagerImportUpdate"), "preload.ts must not expose TrustedVillagerImportUpdate");
  assert.ok(!preloadTs.includes("applyTrustedImportUpdates"), "preload.ts must not expose applyTrustedImportUpdates");
});

test("UI CONTRACT 40: BrowserWindow close shutdown ordering and disposal safety", () => {
  const mainTs = fs.readFileSync(
    path.join(process.cwd(), "src", "electron", "main.ts"),
    "utf8"
  );

  // A. Imports disposeStorageBeforeWindowDestroy
  assert.ok(
    mainTs.includes("disposeStorageBeforeWindowDestroy"),
    "main.ts must import disposeStorageBeforeWindowDestroy"
  );

  // B & C. Close handler slice & ordering
  const closeStart = mainTs.indexOf('mainWindow.on("close"');
  assert.ok(closeStart !== -1, "Missing mainWindow on close handler in main.ts");
  const closeEnd = mainTs.indexOf('mainWindow.on("closed"', closeStart);
  assert.ok(closeEnd !== -1, "Missing mainWindow on closed handler in main.ts");

  const closeSlice = mainTs.slice(closeStart, closeEnd);

  assert.ok(
    closeSlice.includes("event.preventDefault()"),
    "Close handler slice must contain event.preventDefault()"
  );
  assert.ok(
    closeSlice.includes("unregisterIpcHandlers()"),
    "Close handler slice must contain unregisterIpcHandlers()"
  );
  assert.ok(
    closeSlice.includes("disposeStorageBeforeWindowDestroy("),
    "Close handler slice must contain disposeStorageBeforeWindowDestroy("
  );
  assert.ok(
    closeSlice.includes("controller.disposeStorage()"),
    "Close handler slice must contain controller.disposeStorage()"
  );
  assert.ok(
    closeSlice.includes("win.destroy()"),
    "Close handler slice must contain win.destroy()"
  );

  const unregIdx = closeSlice.indexOf("unregisterIpcHandlers()");
  const helperIdx = closeSlice.indexOf("disposeStorageBeforeWindowDestroy(");
  const disposeCallIdx = closeSlice.indexOf("controller.disposeStorage()");
  const destroyIdx = closeSlice.indexOf("win.destroy()");

  assert.ok(
    unregIdx < helperIdx,
    "unregisterIpcHandlers must precede disposeStorageBeforeWindowDestroy"
  );
  assert.ok(
    helperIdx < disposeCallIdx,
    "disposeStorageBeforeWindowDestroy must enclose controller.disposeStorage callback"
  );
  assert.ok(
    disposeCallIdx < destroyIdx,
    "controller.disposeStorage callback must precede win.destroy callback"
  );

  // D. Closed handler slice must NOT contain .disposeStorage(
  const closedStart = closeEnd;
  const closedEnd = mainTs.indexOf("if (squirrelStartup)", closedStart);
  const closedSlice = mainTs.slice(closedStart, closedEnd !== -1 ? closedEnd : undefined);

  assert.ok(
    !closedSlice.includes(".disposeStorage("),
    "closed handler slice must not initiate .disposeStorage("
  );

  // E. window-all-closed remains after BrowserWindow wiring and may call app.quit()
  const allClosedIdx = mainTs.indexOf('app.on("window-all-closed"');
  assert.ok(allClosedIdx !== -1, "Missing app.on window-all-closed");
  assert.ok(allClosedIdx > closedStart, "window-all-closed must remain after BrowserWindow wiring");
  assert.ok(mainTs.includes("app.quit()"), "window-all-closed may call app.quit()");
});

test("UI CONTRACT 41: Release packaging never exposes repository signing secrets", () => {
  const root = process.cwd();
  const forgePath = path.join(root, "forge.config.js");
  const verifySigningPath = path.join(root, "scripts", "verify-release-signing.js");

  const forgeContent = fs.readFileSync(forgePath, "utf8");
  const verifySigningContent = fs.readFileSync(verifySigningPath, "utf8");

  assert.ok(
    forgeContent.includes("resolveExternalSigningCertificate"),
    "forge.config.js must import and use resolveExternalSigningCertificate"
  );
  assert.ok(
    forgeContent.includes("pfx|p12|pem|key"),
    "forge.config.js must ignore certificate and key extensions"
  );
  assert.ok(
    !forgeContent.includes("RELEASE_AUTHOR"),
    "forge.config.js must not reference process.env.RELEASE_AUTHOR"
  );
  assert.ok(
    forgeContent.includes("windowsSign:"),
    "forge.config.js must use modern windowsSign for signed Squirrel releases"
  );
  assert.ok(
    forgeContent.includes("timestampServer:"),
    "forge.config.js must timestamp stable signed releases"
  );

  assert.ok(
    verifySigningContent.includes("requireStablePackageAuthor"),
    "verify-release-signing.js must use requireStablePackageAuthor"
  );
  assert.ok(
    verifySigningContent.includes("resolveExternalSigningCertificate"),
    "verify-release-signing.js must use resolveExternalSigningCertificate"
  );
});


