import assert from "node:assert";
import test from "node:test";
import { WorldSession } from "../src/core/session/WorldSession";
import { ParsedVillager, WorldVillagerDump } from "../src/core/types";

function createMockVillager(id = "v_1", name = "Test Villager"): ParsedVillager {
  return {
    sessionVillagerId: id,
    dbKeyHex: "6163746f72707265666978313233",
    originalDbValueHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    nbtEncoding: { format: "little" },
    identifier: "minecraft:villager_v2",
    customName: name,
    dimension: "overworld",
    dimensionId: 0,
    position: { x: 100, y: 64, z: 200 },
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
        buyA: { id: "minecraft:paper", count: 24 },
        buyB: null,
        sell: { id: "minecraft:emerald", count: 1 },
        maxUses: 16,
        uses: 0,
        traderExp: 2,
        rewardExp: true,
        priceMultiplierA: 0.05
      }
    ],
    linkedWorkstation: {
      type: "minecraft:lectern",
      dimension: "overworld",
      position: { x: 102, y: 64, z: 200 }
    },
    linkedBed: {
      type: "minecraft:bed",
      dimension: "overworld",
      position: { x: 104, y: 64, z: 202 }
    },
    workstationLinkSource: "actor",
    bedLinkSource: "actor",
    rawNbt: { type: "compound", name: "", value: {} }
  };
}

test("WorldSession tracks dirty state and generates save preview", () => {
  const mockDump: WorldVillagerDump = {
    worldName: "Session Test World",
    worldPath: "/test/path",
    exportedAt: new Date().toISOString(),
    villagerCount: 2,
    summary: { byProfession: {}, withTrades: 1, withoutWorkstation: 0, zombies: 0, cured: 0 },
    villagers: [
      createMockVillager("v_1", "Alice"),
      createMockVillager("v_2", "Bob")
    ]
  };

  const session = new WorldSession(mockDump);
  assert.strictEqual(session.getDirtyCount(), 0);
  assert.strictEqual(session.canUndo(), false);
  assert.strictEqual(session.canRedo(), false);

  // 1. Execute command on v_1
  const res = session.executeRequest({
    kind: "PATCH_VILLAGER",
    description: "Rename Alice to Alice Expert and promote to level 4",
    villagerId: "v_1",
    patch: { customName: "Alice Expert", careerLevel: 4 }
  });

  assert.strictEqual(res.success, true);
  assert.strictEqual(session.getDirtyCount(), 1, "Only v_1 should be dirty");
  assert.strictEqual(session.canUndo(), true);

  const preview = session.getSavePreview();
  assert.strictEqual(preview.modifiedVillagersCount, 1);
  assert.strictEqual(preview.diffs[0]?.villagerName, "Alice Expert");
  assert.ok((preview.diffs[0]?.changes.length ?? 0) >= 2);

  // 2. Undo command
  session.undo();
  assert.strictEqual(session.getVillager("v_1")?.customName, "Alice");
  assert.strictEqual(session.getDirtyCount(), 0, "Dirty count should be 0 after undo");
  assert.strictEqual(session.canRedo(), true);

  // 3. Redo command
  session.redo();
  assert.strictEqual(session.getVillager("v_1")?.customName, "Alice Expert");
  assert.strictEqual(session.getDirtyCount(), 1);
});

test("WorldSession preserves read-only link state across allowed operations", () => {
  const v = createMockVillager("v_1", "Librarian");
  const mockDump: WorldVillagerDump = {
    worldName: "Session Links World",
    worldPath: "/test/path",
    exportedAt: new Date().toISOString(),
    villagerCount: 1,
    summary: { byProfession: {}, withTrades: 1, withoutWorkstation: 0, zombies: 0, cured: 0 },
    villagers: [v]
  };

  const session = new WorldSession(mockDump);

  // Perform patch, restock, trade add
  session.executeRequest({
    kind: "PATCH_VILLAGER",
    description: "Promote and rename",
    villagerId: "v_1",
    patch: { customName: "Master Librarian", careerLevel: 5, profession: "farmer" }
  });

  session.executeRequest({
    kind: "BULK_RESTOCK",
    description: "Restock",
    villagerIds: ["v_1"]
  });

  session.executeRequest({
    kind: "TRADE_ADD",
    description: "Add trade",
    villagerId: "v_1"
  });

  const updated = session.getVillager("v_1");
  assert.ok(updated);
  assert.deepStrictEqual(updated.linkedWorkstation?.position, { x: 102, y: 64, z: 200 });
  assert.deepStrictEqual(updated.linkedBed?.position, { x: 104, y: 64, z: 202 });
});

test("WorldSession TRADE_SET_ITEM_COUNT preserves damage, enchantments, and raw tags", () => {
  const v = createMockVillager("v_1", "Librarian");
  v.trades[0]!.sell = {
    id: "minecraft:diamond_sword",
    count: 1,
    damage: 15,
    enchantments: [{ name: "sharpness", level: 5 }],
    rawTag: { type: "compound", value: { CustomTag: { type: "string", value: "preserve" } } }
  };

  const mockDump: WorldVillagerDump = {
    worldName: "Trade Count World",
    worldPath: "/test/path",
    exportedAt: new Date().toISOString(),
    villagerCount: 1,
    summary: { byProfession: {}, withTrades: 1, withoutWorkstation: 0, zombies: 0, cured: 0 },
    villagers: [v]
  };

  const session = new WorldSession(mockDump);
  const res = session.executeRequest({
    kind: "TRADE_SET_ITEM_COUNT",
    description: "Set sell count to 3",
    villagerId: "v_1",
    tradeId: "t1",
    slot: "sell",
    count: 3
  });

  assert.strictEqual(res.success, true);
  const updatedSell = session.getVillager("v_1")?.trades[0]?.sell;
  assert.strictEqual(updatedSell?.count, 3);
  assert.strictEqual(updatedSell?.damage, 15);
  assert.deepStrictEqual(updatedSell?.enchantments, [{ name: "sharpness", level: 5 }]);
  assert.strictEqual(updatedSell?.rawTag?.value?.CustomTag?.value, "preserve");
});
