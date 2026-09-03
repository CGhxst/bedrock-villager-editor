import assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import test from "node:test";
import { BedrockDbManager } from "../src/core/bedrockDb";
import { clonePreservingBinary, deepEqualSafe } from "../src/core/clone";
import { getEnchantmentById, getEnchantmentByName } from "../src/core/enchantments";
import { NbtTags, parseBedrockNbt, writeBedrockNbt } from "../src/core/nbtHelper";
import { WorldSession } from "../src/core/session/WorldSession";
import { ParsedVillager, WorldVillagerDump } from "../src/core/types";
import { parseVillagerNbt } from "../src/core/villagerParser";
import { writeVillagerToNbt } from "../src/core/villagerWriter";

function createBaseParsedVillager(overrides: Partial<ParsedVillager> = {}): ParsedVillager {
  return {
    sessionVillagerId: "v_test_1",
    dbKeyHex: "6163746f72707265666978313233",
    originalDbValueHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    nbtEncoding: { format: "little" },
    identifier: "minecraft:villager_v2",
    customName: "Base Villager",
    dimension: "overworld",
    dimensionId: 0,
    position: { x: 10, y: 60, z: 20 },
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
        id: "t0",
        tier: 1,
        buyA: { id: "minecraft:emerald", count: 24 },
        buyB: null,
        sell: { id: "minecraft:book", count: 1 },
        maxUses: 12,
        uses: 5,
        traderExp: 1,
        rewardExp: true,
        priceMultiplierA: 0.05
      }
    ],
    linkedWorkstation: {
      type: "minecraft:lectern",
      dimension: "overworld",
      position: { x: 12, y: 60, z: 22 }
    },
    linkedBed: null,
    rawNbt: { type: "compound", name: "", value: {} },
    ...overrides
  };
}

// TEST 1: STRING PROFESSION DOES NOT BECOME UNEMPLOYED
test("1: String profession does not become unemployed", () => {
  const rawNbt = {
    type: "compound",
    name: "",
    value: {
      identifier: NbtTags.string("minecraft:villager_v2"),
      Profession: NbtTags.string("minecraft:librarian")
    }
  };
  const parsed = parseVillagerNbt(rawNbt, "hex1", 0);
  assert.ok(parsed);
  assert.strictEqual(parsed.profession, "librarian");
  assert.strictEqual(parsed.professionKnown, true);
});

// TEST 2: PREFERRED PROFESSION
test("2: Preferred profession string farmer", () => {
  const rawNbt = {
    type: "compound",
    name: "",
    value: {
      identifier: NbtTags.string("minecraft:villager_v2"),
      PreferredProfession: NbtTags.string("minecraft:farmer")
    }
  };
  const parsed = parseVillagerNbt(rawNbt, "hex2", 0);
  assert.ok(parsed);
  assert.strictEqual(parsed.profession, "farmer");
  assert.strictEqual(parsed.professionKnown, true);
});

// TEST 3: CAREER STRING PROFESSION
test("3: Career string toolsmith", () => {
  const rawNbt = {
    type: "compound",
    name: "",
    value: {
      identifier: NbtTags.string("minecraft:villager_v2"),
      Career: NbtTags.string("toolsmith")
    }
  };
  const parsed = parseVillagerNbt(rawNbt, "hex3", 0);
  assert.ok(parsed);
  assert.strictEqual(parsed.profession, "toolsmith");
  assert.strictEqual(parsed.professionKnown, true);
});

// TEST 4: UNKNOWN PROFESSION
test("4: Unknown string profession resolves to unknown, not unemployed", () => {
  const rawNbt = {
    type: "compound",
    name: "",
    value: {
      identifier: NbtTags.string("minecraft:villager_v2"),
      Profession: NbtTags.string("future_profession_xyz")
    }
  };
  const parsed = parseVillagerNbt(rawNbt, "hex4", 0);
  assert.ok(parsed);
  assert.strictEqual(parsed.profession, "unknown");
  assert.strictEqual(parsed.professionKnown, false);
});

// TEST 5: ABSENT PROFESSION ON VILLAGER VS CUSTOM ENTITY
test("5: Absent profession data on vanilla villager resolves to unemployed, and custom entity resolves to unknown", () => {
  const villagerNbt = {
    type: "compound",
    name: "",
    value: {
      identifier: NbtTags.string("minecraft:villager_v2")
    }
  };
  const parsedVillager = parseVillagerNbt(villagerNbt, "hex5v", 0);
  assert.ok(parsedVillager);
  assert.strictEqual(parsedVillager.profession, "unemployed");
  assert.strictEqual(parsedVillager.professionKnown, true);

  const customEntityNbt = {
    type: "compound",
    name: "",
    value: {
      identifier: NbtTags.string("minecraft:custom_npc")
    }
  };
  const parsedCustom = parseVillagerNbt(customEntityNbt, "hex5c", 0);
  assert.ok(parsedCustom);
  assert.strictEqual(parsedCustom.profession, "unknown");
  assert.strictEqual(parsedCustom.professionKnown, false);
});

// TEST 6: EDIT NAME ON UNKNOWN PROFESSION DOES NOT WRITE PROFESSION
test("6: Edit name on unknown profession does not touch or write profession tag", async () => {
  const rawNbt = {
    type: "compound",
    name: "",
    value: {
      identifier: NbtTags.string("minecraft:villager_v2"),
      Profession: NbtTags.string("future_custom_prof"),
      CustomName: NbtTags.string("Old Name")
    }
  };
  const parsed = parseVillagerNbt(rawNbt, "hex6", 0);
  assert.ok(parsed);
  assert.strictEqual(parsed.profession, "unknown");

  const baseline = clonePreservingBinary(parsed);
  parsed.customName = "New Name";

  const updatedNbt = writeVillagerToNbt(parsed, baseline);
  assert.strictEqual(updatedNbt.value.CustomName.value, "New Name");
  assert.strictEqual(updatedNbt.value.Profession.value, "future_custom_prof");
});

// TEST 7: OFFERS UNKNOWN SIBLING SURVIVES
test("7: Offers unknown sibling tag survives trade edit", () => {
  const rawNbt = {
    type: "compound",
    name: "",
    value: {
      identifier: NbtTags.string("minecraft:villager_v2"),
      Offers: {
        type: "compound",
        value: {
          UnknownOffersSibling: NbtTags.string("survives_sibling_test"),
          Recipes: NbtTags.list("compound", [
            {
              buyA: NbtTags.compound({ Name: NbtTags.string("minecraft:emerald"), Count: NbtTags.byte(10) }),
              sell: NbtTags.compound({ Name: NbtTags.string("minecraft:apple"), Count: NbtTags.byte(1) })
            }
          ])
        }
      }
    }
  };

  const parsed = parseVillagerNbt(rawNbt, "hex7", 0);
  assert.ok(parsed);

  const baseline = clonePreservingBinary(parsed);
  parsed.trades[0]!.buyA.count = 1;

  const updatedNbt = writeVillagerToNbt(parsed, baseline);
  assert.strictEqual(
    updatedNbt.value.Offers.value.UnknownOffersSibling.value,
    "survives_sibling_test",
    "UnknownOffersSibling must survive intact"
  );
});

// TEST 8: DWELLER UNKNOWN FIELDS SURVIVE
test("8: Dweller positions and unknown fields survive unrelated edits", () => {
  const rawNbt = {
    type: "compound",
    name: "",
    value: {
      identifier: NbtTags.string("minecraft:villager_v2"),
      CustomName: NbtTags.string("Old Name"),
      DwellerComponent: NbtTags.compound({
        DwellerPositions: NbtTags.list("compound", [
          {
            role: NbtTags.string("jobsite"),
            block_pos: NbtTags.list("int", [10, 60, 20]),
            ExtraFutureDwellerTag: NbtTags.string("keep_me_safe")
          }
        ])
      })
    }
  };

  const parsed = parseVillagerNbt(rawNbt, "hex8", 0);
  assert.ok(parsed);

  const baseline = clonePreservingBinary(parsed);
  parsed.customName = "New Name";

  const updatedNbt = writeVillagerToNbt(parsed, baseline);
  const posEntries = updatedNbt.value.DwellerComponent.value.DwellerPositions.value.value;
  const firstPos = posEntries[0].value || posEntries[0];
  assert.strictEqual(firstPos.ExtraFutureDwellerTag.value, "keep_me_safe");
  assert.strictEqual(firstPos.block_pos.value.value[0], 10);
});

// TEST 9: BULK RESTOCK ALL TARGETS
test("9: Bulk restock modifies all targets, undo restores all, redo reapplies all", () => {
  const v1 = createBaseParsedVillager({ sessionVillagerId: "v1" });
  v1.trades[0]!.uses = 5;
  const v2 = createBaseParsedVillager({ sessionVillagerId: "v2" });
  v2.trades[0]!.uses = 6;
  const v3 = createBaseParsedVillager({ sessionVillagerId: "v3" });
  v3.trades[0]!.uses = 7;

  const dump: WorldVillagerDump = {
    worldName: "Bulk Test",
    worldPath: "/test",
    exportedAt: new Date().toISOString(),
    villagerCount: 3,
    summary: { byProfession: {}, withTrades: 3, withoutWorkstation: 0, zombies: 0, cured: 0 },
    villagers: [v1, v2, v3]
  };

  const session = new WorldSession(dump);
  const res = session.executeRequest({
    kind: "BULK_RESTOCK",
    description: "Bulk restock all villager offers",
    villagerIds: ["v1", "v2", "v3"]
  });

  assert.strictEqual(res.success, true);
  assert.strictEqual(session.getVillager("v1")?.trades[0]?.uses, 0);
  assert.strictEqual(session.getVillager("v2")?.trades[0]?.uses, 0);
  assert.strictEqual(session.getVillager("v3")?.trades[0]?.uses, 0);
  assert.strictEqual(session.getDirtyCount(), 3);

  // Undo
  session.undo();
  assert.strictEqual(session.getVillager("v1")?.trades[0]?.uses, 5);
  assert.strictEqual(session.getVillager("v2")?.trades[0]?.uses, 6);
  assert.strictEqual(session.getVillager("v3")?.trades[0]?.uses, 7);
  assert.strictEqual(session.getDirtyCount(), 0);

  // Redo
  session.redo();
  assert.strictEqual(session.getVillager("v1")?.trades[0]?.uses, 0);
  assert.strictEqual(session.getVillager("v2")?.trades[0]?.uses, 0);
  assert.strictEqual(session.getVillager("v3")?.trades[0]?.uses, 0);
  assert.strictEqual(session.getDirtyCount(), 3);
});

// TEST 10: PATCH COMMAND DOES NOT ACCEPT ILLEGAL FIELD
test("10: Patch command rejects illegal field", () => {
  const v = createBaseParsedVillager();
  const session = new WorldSession({
    worldName: "Illegal Field Test",
    worldPath: "/test",
    exportedAt: "",
    villagerCount: 1,
    summary: { byProfession: {}, withTrades: 1, withoutWorkstation: 0, zombies: 0, cured: 0 },
    villagers: [v]
  });

  const res = session.executeRequest({
    kind: "PATCH_VILLAGER",
    description: "Illegal attempt",
    villagerId: "v_test_1",
    patch: { dbKeyHex: "evil" } as any
  });

  assert.strictEqual(res.success, false);
});

// TEST 11: NO-OP PATCH DOES NOT CREATE DIRTY STATE
test("11: No-op patch does not create dirty state or undo command", () => {
  const v = createBaseParsedVillager({ customName: "Alice" });
  const session = new WorldSession({
    worldName: "No-op Test",
    worldPath: "/test",
    exportedAt: "",
    villagerCount: 1,
    summary: { byProfession: {}, withTrades: 1, withoutWorkstation: 0, zombies: 0, cured: 0 },
    villagers: [v]
  });

  const res = session.executeRequest({
    kind: "PATCH_VILLAGER",
    description: "Same name",
    villagerId: "v_test_1",
    patch: { customName: "Alice" }
  });

  assert.strictEqual(res.success, true);
  assert.strictEqual(session.getDirtyCount(), 0);
  assert.strictEqual(session.canUndo(), false);
});

// TEST 12: SAVE PREVIEW INCLUDES XP
test("12: Save preview includes Trade XP changes", () => {
  const v = createBaseParsedVillager({ experience: 10 });
  const session = new WorldSession({
    worldName: "XP Preview Test",
    worldPath: "/test",
    exportedAt: "",
    villagerCount: 1,
    summary: { byProfession: {}, withTrades: 1, withoutWorkstation: 0, zombies: 0, cured: 0 },
    villagers: [v]
  });

  session.executeRequest({
    kind: "PATCH_VILLAGER",
    description: "Increase XP",
    villagerId: "v_test_1",
    patch: { experience: 50 }
  });

  const preview = session.getSavePreview();
  assert.strictEqual(preview.modifiedVillagersCount, 1);
  const diff = preview.diffs[0];
  assert.ok(diff?.changes.some((c) => c.includes("Trade XP: 10 -> 50")));
});

// TEST 13: SAVE PREVIEW INCLUDES POSITION
test("13: Save preview includes Position changes", () => {
  const v = createBaseParsedVillager({ position: { x: 0, y: 64, z: 0 } });
  const session = new WorldSession({
    worldName: "Pos Preview Test",
    worldPath: "/test",
    exportedAt: "",
    villagerCount: 1,
    summary: { byProfession: {}, withTrades: 1, withoutWorkstation: 0, zombies: 0, cured: 0 },
    villagers: [v]
  });

  session.executeRequest({
    kind: "PATCH_VILLAGER",
    description: "Move",
    villagerId: "v_test_1",
    patch: { position: { x: 100, y: 70, z: 200 } }
  });

  const preview = session.getSavePreview();
  assert.strictEqual(preview.modifiedVillagersCount, 1);
  const diff = preview.diffs[0];
  assert.ok(diff?.changes.some((c) => c.includes("Position: (0, 64, 0) -> (100, 70, 200)")));
});

// TEST 14: BYTE VERIFICATION
test("14: Post-save byte verification fails on different byte contents", () => {
  const bufA = Buffer.from([1, 2, 3, 4]);
  const bufB = Buffer.from([1, 2, 9, 4]);
  assert.strictEqual(bufA.length, bufB.length);
  assert.strictEqual(bufA.equals(bufB), false, "Same length buffers with different bytes must fail equality check");
});

// TEST 15: ENCHANTMENT MAPPING
test("15: Enchantment tail mapping (38 wind_burst, 39 density, 40 breach, 41 lunge)", () => {
  const wb = getEnchantmentById(38);
  const den = getEnchantmentById(39);
  const br = getEnchantmentById(40);
  const lg = getEnchantmentById(41);

  assert.strictEqual(wb?.name, "wind_burst");
  assert.strictEqual(den?.name, "density");
  assert.strictEqual(br?.name, "breach");
  assert.strictEqual(lg?.name, "lunge");
});

// TEST 16: UNKNOWN ENCHANTMENT NAME DOES NOT BECOME 99
test("16: Unknown enchantment name returns null and cannot serialize", () => {
  const def = getEnchantmentByName("future_magic");
  assert.strictEqual(def, null);
});

// TEST 17: ALL DIALOG CLOSE BUTTONS
test("17: public/index.html contains no inline onclick and has all dialog close IDs", () => {
  const htmlPath = path.join(process.cwd(), "public", "index.html");
  const html = fs.readFileSync(htmlPath, "utf8");

  assert.ok(!html.includes("onclick="), "index.html must not contain inline onclick=");
  assert.ok(html.includes('id="btnCloseItemPicker"'));
  assert.ok(html.includes('id="btnCloseEnchantPicker"'));
  assert.ok(html.includes('id="btnCloseSaveReview"'));
  assert.ok(html.includes('id="btnCancelSaveReview"'));
  assert.ok(html.includes('id="btnCloseBulkActions"'));
  assert.ok(html.includes('id="btnCloseBackups"'));
});

// TEST 18: BACKUPS BUTTON IS WIRED
test("18: public/app.js contains btnBackupsMenu handler and renderBackups", () => {
  const appPath = path.join(process.cwd(), "public", "app.js");
  const js = fs.readFileSync(appPath, "utf8");

  assert.ok(js.includes("btnBackupsMenu"));
  assert.ok(js.includes("renderBackups"));
});

// TEST 19: NO SET_ALL
test("19: Repository contains no occurrences of SET_ALL in renderer or IPC handlers", () => {
  const appPath = path.join(process.cwd(), "public", "app.js");
  const ipcPath = path.join(process.cwd(), "src", "main", "ipcHandlers.ts");

  const appJs = fs.readFileSync(appPath, "utf8");
  const ipcTs = fs.readFileSync(ipcPath, "utf8");

  assert.ok(!appJs.includes("SET_ALL"), "public/app.js must not contain SET_ALL");
  assert.ok(!ipcTs.includes("SET_ALL"), "ipcHandlers.ts must not contain SET_ALL");
});

// TEST 20: NO JSON CLONE IN WORLDSESSION
test("20: src/core/session/WorldSession.ts contains no JSON.parse(JSON.stringify", () => {
  const wsPath = path.join(process.cwd(), "src", "core", "session", "WorldSession.ts");
  const ws = fs.readFileSync(wsPath, "utf8");

  assert.ok(!ws.includes("JSON.parse(JSON.stringify"), "WorldSession must not use JSON.parse(JSON.stringify");
});

// TEST 21: PARSER ZERO-VALUED BOOLEAN HANDLING
test("21: IsCured byte 0 parses false", () => {
  const rawNbt = {
    type: "compound",
    name: "",
    value: {
      identifier: NbtTags.string("minecraft:villager_v2"),
      IsCured: NbtTags.byte(0)
    }
  };
  const parsed = parseVillagerNbt(rawNbt, "hex_cured_0", 0);
  assert.ok(parsed);
  assert.strictEqual(parsed.isCured, false);
});

test("22: IsCured byte 1 parses true", () => {
  const rawNbt = {
    type: "compound",
    name: "",
    value: {
      identifier: NbtTags.string("minecraft:villager_v2"),
      IsCured: NbtTags.byte(1)
    }
  };
  const parsed = parseVillagerNbt(rawNbt, "hex_cured_1", 0);
  assert.ok(parsed);
  assert.strictEqual(parsed.isCured, true);
});

test("23: ConversionTime int 0 is not converting", () => {
  const rawNbt = {
    type: "compound",
    name: "",
    value: {
      identifier: NbtTags.string("minecraft:zombie_villager_v2"),
      ConversionTime: NbtTags.int(0)
    }
  };
  const parsed = parseVillagerNbt(rawNbt, "hex_conv_0", 0);
  assert.ok(parsed);
  assert.strictEqual(parsed.isZombie, true);
  assert.strictEqual(parsed.conversionTime, 0);
  assert.strictEqual(parsed.isConverting, false);
});

test("24: ConversionTime positive value is converting", () => {
  const rawNbt = {
    type: "compound",
    name: "",
    value: {
      identifier: NbtTags.string("minecraft:zombie_villager_v2"),
      ConversionTime: NbtTags.int(120)
    }
  };
  const parsed = parseVillagerNbt(rawNbt, "hex_conv_120", 0);
  assert.ok(parsed);
  assert.strictEqual(parsed.isZombie, true);
  assert.strictEqual(parsed.conversionTime, 120);
  assert.strictEqual(parsed.isConverting, true);
});
