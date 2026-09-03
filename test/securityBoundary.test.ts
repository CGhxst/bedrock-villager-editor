import assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import test from "node:test";
import { deepEqualSafe, stringifyDebugValue } from "../src/core/clone";
import { WorldSession } from "../src/core/session/WorldSession";
import { ParsedVillager, WorldVillagerDump } from "../src/core/types";
import { sessionCommandSchema } from "../src/core/validation";
import { toVillagerViewModel } from "../src/core/viewModel";
import {
  isRestartRequiredStorageError,
  RestartRequiredStorageError
} from "../src/core/storageFatalError";

function createMockParsedVillager(id = "v_sec_1", name = "SecVillager"): ParsedVillager {
  return {
    sessionVillagerId: id,
    dbKeyHex: "6163746f72707265666978313233",
    originalDbValueHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    nbtEncoding: { format: "little" },
    identifier: "minecraft:villager_v2",
    customName: name,
    dimension: "overworld",
    dimensionId: 0,
    position: { x: 10, y: 64, z: 20 },
    profession: "librarian",
    professionDisplayName: "Librarian",
    professionKnown: true,
    careerLevel: 1,
    careerLevelName: "Novice",
    experience: 0,
    isCured: false,
    isZombie: false,
    trades: [
      {
        id: "t1",
        tier: 1,
        buyA: { id: "minecraft:emerald", count: 24, rawTag: { type: "compound", value: {} } },
        buyB: null,
        sell: { id: "minecraft:book", count: 1 },
        maxUses: 16,
        uses: 5,
        traderExp: 2,
        rewardExp: true,
        priceMultiplierA: 0.05,
        demand: 3,
        rawRecipe: { type: "compound", value: {} }
      }
    ],
    linkedWorkstation: null,
    linkedBed: null,
    rawNbt: {
      type: "compound",
      name: "",
      value: {
        UniqueID: { type: "long", value: 1234567890123456789n }
      }
    }
  };
}

// RENDERER BOUNDARY 1
test("RENDERER BOUNDARY 1: toVillagerViewModel strips internal/privileged fields", () => {
  const parsed = createMockParsedVillager();
  const viewModel = toVillagerViewModel(parsed, false);

  assert.strictEqual((viewModel as any).dbKeyHex, undefined);
  assert.strictEqual((viewModel as any).rawNbt, undefined);
  assert.strictEqual((viewModel as any).originalDbValueHash, undefined);
  assert.strictEqual((viewModel as any).nbtEncoding, undefined);
  assert.strictEqual((viewModel as any).customNameSources, undefined);

  // Trade items in view model must not contain rawRecipe / rawTag
  assert.strictEqual((viewModel.trades[0] as any).rawRecipe, undefined);
  assert.strictEqual((viewModel.trades[0]!.buyA as any).rawTag, undefined);
});

// COMMAND BOUNDARY 1: Strict Zod validation
test("COMMAND BOUNDARY 1: Zod schema strictly rejects unknown/illegal fields", () => {
  // Reject PATCH_VILLAGER containing trades
  const patchWithTrades = {
    kind: "PATCH_VILLAGER",
    description: "Illegal trades patch",
    villagerId: "v_1",
    patch: { trades: [] }
  };
  assert.strictEqual(sessionCommandSchema.safeParse(patchWithTrades).success, false);

  // Reject PATCH_VILLAGER containing dbKeyHex
  const patchWithDbKey = {
    kind: "PATCH_VILLAGER",
    description: "Illegal dbKeyHex patch",
    villagerId: "v_1",
    patch: { dbKeyHex: "evil" }
  };
  assert.strictEqual(sessionCommandSchema.safeParse(patchWithDbKey).success, false);

  // Reject SET_JOB_SITE containing extra dimension or type
  const jobSiteWithExtras = {
    kind: "SET_JOB_SITE",
    description: "Set job site",
    villagerId: "v_1",
    position: { x: 10, y: 64, z: 20, dimension: "nether", type: "minecraft:barrel" }
  };
  assert.strictEqual(sessionCommandSchema.safeParse(jobSiteWithExtras).success, false);

  // Reject TRADE_SET_SETTINGS with unknown setting
  const tradeSettingsWithExtras = {
    kind: "TRADE_SET_SETTINGS",
    description: "Invalid settings",
    villagerId: "v_1",
    tradeId: "t1",
    patch: { unknownProperty: 42 }
  };
  assert.strictEqual(sessionCommandSchema.safeParse(tradeSettingsWithExtras).success, false);

  // Reject description > 200 chars
  const longDesc = {
    kind: "TRADE_ADD",
    description: "a".repeat(201),
    villagerId: "v_1"
  };
  assert.strictEqual(sessionCommandSchema.safeParse(longDesc).success, false);
});

// TRANSACTION 1: Single command failure does not mutate live state
test("TRANSACTION 1: Single command error rolls back working state without modifying live villager", () => {
  const v = createMockParsedVillager("v_1", "Bob");
  const dump: WorldVillagerDump = {
    worldName: "Tx World",
    worldPath: "/test",
    exportedAt: "",
    villagerCount: 1,
    summary: { byProfession: {}, withTrades: 1, withoutWorkstation: 1, zombies: 0, cured: 0 },
    villagers: [v]
  };

  const session = new WorldSession(dump);
  const res = session.executeRequest({
    kind: "PATCH_VILLAGER",
    description: "Invalid patch attempt",
    villagerId: "v_1",
    patch: {
      customName: "Alice",
      profession: "definitely_invalid_profession"
    }
  });

  assert.strictEqual(res.success, false);
  const live = session.getVillager("v_1");
  assert.strictEqual(live?.customName, "Bob", "Live name must remain Bob");
  assert.strictEqual(session.getDirtyCount(), 0, "Dirty count must be 0");
  assert.strictEqual(session.canUndo(), false, "Cannot undo failed command");
});

// TRANSACTION 2: Bulk command all-or-nothing
test("TRANSACTION 2: Bulk command fails completely if any target is missing, leaving all targets untouched", () => {
  const v1 = createMockParsedVillager("v_1", "Villager1");
  const v2 = createMockParsedVillager("v_2", "Villager2");
  const dump: WorldVillagerDump = {
    worldName: "Bulk Tx World",
    worldPath: "/test",
    exportedAt: "",
    villagerCount: 2,
    summary: { byProfession: {}, withTrades: 2, withoutWorkstation: 2, zombies: 0, cured: 0 },
    villagers: [v1, v2]
  };

  const session = new WorldSession(dump);
  const res = session.executeRequest({
    kind: "BULK_SET_COST_QUANTITY_ONE",
    description: "Bulk set costs",
    villagerIds: ["v_1", "missing_villager_id", "v_2"]
  });

  assert.strictEqual(res.success, false);
  assert.strictEqual(session.getVillager("v_1")?.trades[0]?.buyA.count, 24, "v_1 cost must remain 24");
  assert.strictEqual(session.getVillager("v_2")?.trades[0]?.buyA.count, 24, "v_2 cost must remain 24");
  assert.strictEqual(session.getDirtyCount(), 0);
  assert.strictEqual(session.canUndo(), false);
});

// BIGINT SAFETY 1: Debug serializer and equality comparison
test("BIGINT SAFETY 1: BigInt in raw NBT does not crash debug serialization or equality", () => {
  const v = createMockParsedVillager();
  const dump: WorldVillagerDump = {
    worldName: "BigInt World",
    worldPath: "/test",
    exportedAt: "",
    villagerCount: 1,
    summary: { byProfession: {}, withTrades: 1, withoutWorkstation: 1, zombies: 0, cured: 0 },
    villagers: [v]
  };

  const session = new WorldSession(dump);
  const debug = session.getVillagerDebugInfo("v_sec_1");
  assert.ok(debug);
  assert.ok(debug.rawNbtJson.includes("1234567890123456789"));

  assert.strictEqual(deepEqualSafe({ val: 100n }, { val: 100n }), true);
  assert.strictEqual(deepEqualSafe({ val: 100n }, { val: 200n }), false);
});

// FORGED LINK COMMANDS: Schema and Session fail closed
test("FORGED LINK COMMANDS: sessionCommandSchema and WorldSession reject all removed link mutation commands", () => {
  const v = createMockParsedVillager("v_1", "Librarian");
  v.linkedWorkstation = {
    type: "minecraft:lectern",
    dimension: "overworld",
    position: { x: 10, y: 64, z: 20 }
  };
  v.linkedBed = {
    type: "minecraft:bed",
    dimension: "overworld",
    position: { x: 12, y: 64, z: 22 }
  };

  const dump: WorldVillagerDump = {
    worldName: "Links World",
    worldPath: "/test",
    exportedAt: "",
    villagerCount: 1,
    summary: { byProfession: {}, withTrades: 1, withoutWorkstation: 0, zombies: 0, cured: 0 },
    villagers: [v]
  };

  const session = new WorldSession(dump);
  const { sessionCommandSchema } = require("../src/core/validation");

  const removedCommands = [
    { kind: "SET_JOB_SITE", description: "Forged set ws", villagerId: "v_1", position: { x: 1, y: 2, z: 3 } },
    { kind: "UNLINK_JOB_SITE", description: "Forged unlink ws", villagerId: "v_1" },
    { kind: "SET_BED", description: "Forged set bed", villagerId: "v_1", position: { x: 1, y: 2, z: 3 } },
    { kind: "UNLINK_BED", description: "Forged unlink bed", villagerId: "v_1" }
  ];

  for (const cmd of removedCommands) {
    // 1. Zod schema rejects
    const parseRes = sessionCommandSchema.safeParse(cmd);
    assert.strictEqual(parseRes.success, false, `sessionCommandSchema must reject ${cmd.kind}`);

    // 2. WorldSession rejects
    const execRes = session.executeRequest(cmd);
    assert.strictEqual(execRes.success, false, `WorldSession must reject ${cmd.kind}`);
  }

  // Verify link state remains untouched and zero dirty state created
  assert.strictEqual(session.getDirtyCount(), 0);
  assert.deepStrictEqual(session.getVillager("v_1")?.linkedWorkstation?.position, { x: 10, y: 64, z: 20 });
  assert.deepStrictEqual(session.getVillager("v_1")?.linkedBed?.position, { x: 12, y: 64, z: 22 });
});

// IPC SENDER SECURITY
test("IPC SECURITY 1: assertTrustedSender rejects untrusted senders and frames", () => {
  const { assertTrustedSender } = require("../src/main/ipcHandlers");

  const mockMainWin: any = {
    isDestroyed: () => false,
    webContents: {
      mainFrame: {}
    }
  };

  // 1. Valid event
  const validEvent: any = {
    sender: {
      isDestroyed: () => false,
      getURL: () => "file:///C:/app/public/index.html"
    },
    senderFrame: mockMainWin.webContents.mainFrame
  };
  validEvent.sender = mockMainWin.webContents;
  validEvent.sender.isDestroyed = () => false;
  validEvent.sender.getURL = () => "file:///C:/app/public/index.html";

  assert.doesNotThrow(() => {
    assertTrustedSender(validEvent, mockMainWin);
  });

  // 2. Destroyed window
  const destroyedWin: any = {
    isDestroyed: () => true,
    webContents: mockMainWin.webContents
  };
  assert.throws(() => {
    assertTrustedSender(validEvent, destroyedWin);
  }, /Rejected IPC from a destroyed window/);

  // 3. Sender mismatch
  const foreignSenderEvent: any = {
    sender: {
      isDestroyed: () => false,
      getURL: () => "file:///C:/app/public/index.html"
    },
    senderFrame: mockMainWin.webContents.mainFrame
  };
  assert.throws(() => {
    assertTrustedSender(foreignSenderEvent, mockMainWin);
  }, /Rejected IPC from an unexpected webContents/);

  // 4. Child/foreign frame
  const foreignFrameEvent: any = {
    sender: mockMainWin.webContents,
    senderFrame: {} // Different frame
  };
  assert.throws(() => {
    assertTrustedSender(foreignFrameEvent, mockMainWin);
  }, /Rejected IPC from a non-main renderer frame/);

  // 5. Remote / non-file origin
  const remoteUrlEvent: any = {
    sender: {
      ...mockMainWin.webContents,
      getURL: () => "http://evil.com/index.html"
    },
    senderFrame: mockMainWin.webContents.mainFrame
  };
  remoteUrlEvent.sender = mockMainWin.webContents;
  remoteUrlEvent.sender.getURL = () => "http://evil.com/index.html";
  assert.throws(() => {
    assertTrustedSender(remoteUrlEvent, mockMainWin);
  }, /Rejected IPC from a non-local renderer/);
});

// BACKUP ID VALIDATION
test("BACKUP ID SECURITY 1: backupIdSchema accepts 16-hex strings and rejects malicious paths", () => {
  const { backupIdSchema } = require("../src/core/validation");

  assert.strictEqual(backupIdSchema.safeParse("a1b2c3d4e5f60718").success, true);
  assert.strictEqual(backupIdSchema.safeParse("0123456789abcdef").success, true);

  // Rejections
  assert.strictEqual(backupIdSchema.safeParse("../../../etc/passwd").success, false);
  assert.strictEqual(backupIdSchema.safeParse("backup_2026.zip").success, false);
  assert.strictEqual(backupIdSchema.safeParse("").success, false);
  assert.strictEqual(backupIdSchema.safeParse("a1b2c3d4e5f6071").success, false); // 15 chars
  assert.strictEqual(backupIdSchema.safeParse("a1b2c3d4e5f607189").success, false); // 17 chars
  assert.strictEqual(backupIdSchema.safeParse("a1b2c3d4e5f6071g").success, false); // 'g' non-hex
});

test("PUBLIC STORAGE ERROR SANITIZATION: publicStorageError sanitizes raw system errors and preserves safe messages", () => {
  const { publicStorageError } = require("../src/main/ipcHandlers");

  // Safe domain errors preserved
  const conflictErr = new Error("Save conflict: actor record v1 changed after the session was loaded.");
  assert.strictEqual(publicStorageError(conflictErr, "Fallback"), conflictErr.message);

  // RestartRequiredStorageError returns clean publicMessage
  const fatalRollbackErr = new RestartRequiredStorageError(
    "SAVE_ROLLBACK_FAILED",
    "SAVE FAILED AND AUTOMATIC ROLLBACK COULD NOT FULLY RESTORE THE EDITOR-WRITTEN ACTORS. Do not continue editing this world. Restore the pre-save backup and restart the editor.",
    { technicalPath: "C:\\secret\\world\\db\\LOCK" }
  );
  const publicRollback = publicStorageError(fatalRollbackErr, "Fallback");
  assert.ok(publicRollback.startsWith("SAVE FAILED AND AUTOMATIC ROLLBACK"));
  assert.ok(!publicRollback.includes("C:\\secret"));
  assert.ok(!publicRollback.includes("LOCK"));

  // Raw file system paths sanitized
  const rawNodeErr = new Error("EBUSY: resource locked or busy C:\\Users\\User\\AppData\\Local\\Packages\\db\\000005.ldb");
  assert.strictEqual(publicStorageError(rawNodeErr, "Fallback message"), "Fallback message");

  const unkErr = new Error("ENOENT: no such file or directory, open 'C:\\secret\\file.txt'");
  assert.strictEqual(publicStorageError(unkErr, "Generic failure"), "Generic failure");
});

test("QUARANTINE 1: quarantineAfterReloadFailure handles success and failure branches accurately", async () => {
  const { quarantineAfterReloadFailure } = require("../src/main/ipcHandlers");

  // CASE 1: manager.close succeeds
  let sessionCleared1 = false;
  let managerCleared1 = false;
  const mockManagerSuccess: any = {
    close: async () => {}
  };

  const res1 = await quarantineAfterReloadFailure(mockManagerSuccess, {
    clearSession: () => { sessionCleared1 = true; },
    clearManager: () => { managerCleared1 = true; }
  });

  assert.strictEqual(res1.managerClosed, true);
  assert.strictEqual(sessionCleared1, true);
  assert.strictEqual(managerCleared1, true);

  // CASE 2: manager.close throws
  let sessionCleared2 = false;
  let retainedManager2: any = null;
  const mockManagerFail: any = {
    close: async () => {
      throw new Error("Disk busy on close");
    }
  };

  const res2 = await quarantineAfterReloadFailure(mockManagerFail, {
    clearSession: () => { sessionCleared2 = true; },
    retainManager: (m: any) => { retainedManager2 = m; }
  });

  assert.strictEqual(res2.managerClosed, false);
  assert.strictEqual(sessionCleared2, true);
  assert.strictEqual(retainedManager2, mockManagerFail, "Failed manager must remain retained for retry/quarantine");
});

test("VIEW MODEL PRIVACY: toVillagerViewModel removes definitions property", () => {
  const parsed = createMockParsedVillager();
  (parsed as any).definitions = ["+minecraft:has_trade_offers"];

  const viewModel = toVillagerViewModel(parsed, false);
  assert.strictEqual((viewModel as any).definitions, undefined);
});

test("STORAGE FATAL ERROR: RestartRequiredStorageError constructs with code, publicMessage, and debugDetail", () => {
  const err = new RestartRequiredStorageError(
    "RESTORE_ROLLBACK_FAILED",
    "BACKUP RESTORE AND AUTOMATIC ROLLBACK FAILED. Do not continue editing this world. Restart the editor and recover from the pre-restore safety backup.",
    { restoreError: "Disk full", rollbackError: "Lock failure" }
  );

  assert.strictEqual(isRestartRequiredStorageError(err), true);
  assert.strictEqual(err.code, "RESTORE_ROLLBACK_FAILED");
  assert.ok(err.publicMessage.includes("BACKUP RESTORE AND AUTOMATIC ROLLBACK FAILED"));
  assert.strictEqual(err.debugDetail !== undefined, true);
});

test("JSON IMPORT INTERNAL COMMAND IS NOT RENDERER-REACHABLE", () => {
  const forged = {
    kind: "IMPORT_VILLAGERS_DATA",
    description: "forged",
    villagerUpdates: [
      {
        villagerId: "v_sec_1",
        trades: []
      }
    ]
  };

  assert.strictEqual(sessionCommandSchema.safeParse(forged).success, false);

  const parsed = createMockParsedVillager("v_sec_1");
  const dump: WorldVillagerDump = {
    worldName: "SecWorld",
    worldPath: "/mock/sec",
    exportedAt: new Date().toISOString(),
    villagerCount: 1,
    summary: {
      byProfession: { librarian: 1 },
      withTrades: 1,
      withoutWorkstation: 0,
      zombies: 0,
      cured: 0
    },
    villagers: [parsed]
  };

  const session = new WorldSession(dump);
  const result = session.executeRequest(forged);

  assert.strictEqual(result.success, false);
  const live = session.getVillager("v_sec_1")!;
  assert.strictEqual(live.trades.length, 1);
  assert.strictEqual(session.getDirtyCount(), 0);
  assert.strictEqual(session.canUndo(), false);
});

test("COMMAND BOUNDARY: TRADE_SET_ITEM damage validates signed short bound and rejects 32768", () => {
  const validCmd = {
    kind: "TRADE_SET_ITEM",
    description: "Set item with max valid damage",
    villagerId: "v_1",
    tradeId: "t_1",
    slot: "sell",
    item: {
      id: "minecraft:bow",
      count: 1,
      damage: 32767
    }
  };
  assert.strictEqual(sessionCommandSchema.safeParse(validCmd).success, true);

  const overflowCmd = {
    kind: "TRADE_SET_ITEM",
    description: "Set item with overflow damage",
    villagerId: "v_1",
    tradeId: "t_1",
    slot: "sell",
    item: {
      id: "minecraft:bow",
      count: 1,
      damage: 32768
    }
  };
  assert.strictEqual(sessionCommandSchema.safeParse(overflowCmd).success, false);

  const validationTs = fs.readFileSync(
    path.join(process.cwd(), "src", "core", "validation.ts"),
    "utf8"
  );
  assert.strictEqual(
    validationTs.includes(".max(65535)"),
    false,
    "validation.ts must not contain .max(65535)"
  );
});
