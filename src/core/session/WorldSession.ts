import { randomUUID } from "node:crypto";
import { clonePreservingBinary, deepEqualSafe, stringifyDebugValue } from "../clone";
import { toEditableVillagerState, toSessionDirtyVillagerState } from "../editableState";
import { allocateUniqueTradeId } from "../tradeIds";
import {
  CAREER_TIER_NAMES,
  getProfessionById,
  getProfessionDisplayName,
  isKnownProfession
} from "../professions";
import { getEnchantmentById } from "../enchantments";
import {
  BedLink,
  Coordinates3D,
  DirtyVillagerWrite,
  ParsedVillager,
  SaveDiffItem,
  SavePreview,
  SessionCommandRequest,
  SessionCommandResult,
  SessionStateSnapshot,
  TradeItem,
  TradeItemInput,
  TradeRecipe,
  TradeSettingsPatch,
  TrustedVillagerImportUpdate,
  VillagerDebugInfo,
  VillagerViewModel,
  WorkstationLink,
  WorldVillagerDump
} from "../types";
import { sessionCommandSchema } from "../validation";
import { toVillagerViewModel } from "../viewModel";

export interface SessionCommand {
  id: string;
  description: string;
  timestamp: number;
  villagerIds: string[];
  undo: () => void;
  redo: () => void;
}

export class WorldSession {
  private readonly worldDump: WorldVillagerDump;
  private readonly baselineVillagers = new Map<string, ParsedVillager>();
  private readonly currentVillagers = new Map<string, ParsedVillager>();
  private readonly dirtyIds = new Set<string>();

  private undoStack: SessionCommand[] = [];
  private redoStack: SessionCommand[] = [];

  constructor(dump: WorldVillagerDump) {
    this.worldDump = dump;
    for (const v of dump.villagers) {
      this.baselineVillagers.set(v.sessionVillagerId, clonePreservingBinary(v));
      this.currentVillagers.set(v.sessionVillagerId, clonePreservingBinary(v));
    }
  }

  public getWorldName(): string {
    return this.worldDump.worldName;
  }

  public getVillagerCount(): number {
    return this.currentVillagers.size;
  }

  public getSummary(): WorldVillagerDump["summary"] {
    return this.worldDump.summary;
  }

  public getVillagers(): VillagerViewModel[] {
    return Array.from(this.currentVillagers.values()).map((v) =>
      toVillagerViewModel(v, this.dirtyIds.has(v.sessionVillagerId))
    );
  }

  public getAllCurrentVillagers(): ParsedVillager[] {
    return Array.from(this.currentVillagers.values()).map((v) =>
      clonePreservingBinary(v)
    );
  }

  public getVillager(villagerId: string): ParsedVillager | null {
    const v = this.currentVillagers.get(villagerId);
    return v ? clonePreservingBinary(v) : null;
  }

  public getVillagerDebugInfo(villagerId: string): VillagerDebugInfo | null {
    const v = this.currentVillagers.get(villagerId);
    if (!v) return null;

    return {
      sessionVillagerId: v.sessionVillagerId,
      actorKeySuffix: v.dbKeyHex.slice(-16),
      identifier: v.identifier,
      professionSource: v.professionSource,
      definitions: v.definitions || [],
      originalDbValueHash: v.originalDbValueHash,
      nbtEncoding: clonePreservingBinary(v.nbtEncoding),
      rawNbtJson: stringifyDebugValue(v.rawNbt)
    };
  }

  public isDirty(villagerId: string): boolean {
    return this.dirtyIds.has(villagerId);
  }

  public getDirtyCount(): number {
    return this.dirtyIds.size;
  }

  public canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  public canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  public getStateSnapshot(): SessionStateSnapshot {
    return {
      dirtyCount: this.getDirtyCount(),
      canUndo: this.canUndo(),
      canRedo: this.canRedo(),
      worldName: this.getWorldName(),
      busyOperation: null,
      restartRequired: false
    };
  }

  public getDirtyWrites(): DirtyVillagerWrite[] {
    const writes: DirtyVillagerWrite[] = [];
    for (const id of this.dirtyIds) {
      const current = this.currentVillagers.get(id);
      const baseline = this.baselineVillagers.get(id);
      if (current && baseline) {
        writes.push({
          current: clonePreservingBinary(current),
          baseline: clonePreservingBinary(baseline)
        });
      }
    }
    return writes;
  }

  public applyTrustedImportUpdates(
    updates: TrustedVillagerImportUpdate[],
    description: string
  ): SessionCommandResult {
    const seen = new Set<string>();

    for (const update of updates) {
      if (seen.has(update.villagerId)) {
        return this.result(
          false,
          `Duplicate trusted import update for villager "${update.villagerId}".`
        );
      }
      seen.add(update.villagerId);

      if (!this.currentVillagers.has(update.villagerId)) {
        return this.result(
          false,
          `Trusted import target not found: ${update.villagerId}.`
        );
      }
    }

    return this.executeImportVillagersData(updates, description);
  }

  public executeRequest(input: unknown): SessionCommandResult {
    const parsed = sessionCommandSchema.safeParse(input);
    if (!parsed.success) {
      return this.result(
        false,
        parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
      );
    }

    const request: SessionCommandRequest = parsed.data;

    switch (request.kind) {
      case "PATCH_VILLAGER":
        return this.executePatch(request.villagerId, request.description, request.patch);

      case "TRADE_ADD":
        return this.executeTradeAdd(request.villagerId, request.description);

      case "TRADE_DELETE":
        return this.executeTradeDelete(request.villagerId, request.description, request.tradeId);

      case "TRADE_RESTOCK":
        return this.executeTradeRestock(request.villagerId, request.description, request.tradeId);

      case "TRADE_SET_ITEM":
        return this.executeTradeSetItem(
          request.villagerId,
          request.description,
          request.tradeId,
          request.slot,
          request.item
        );

      case "TRADE_SET_ITEM_COUNT":
        return this.executeTradeSetItemCount(
          request.villagerId,
          request.description,
          request.tradeId,
          request.slot,
          request.count
        );

      case "TRADE_SET_SETTINGS":
        return this.executeTradeSetSettings(
          request.villagerId,
          request.description,
          request.tradeId,
          request.patch
        );

      case "TRADE_ADD_ENCHANTMENT":
        return this.executeTradeAddEnchantment(
          request.villagerId,
          request.description,
          request.tradeId,
          request.slot,
          request.enchantmentId,
          request.level
        );

      case "TRADE_REMOVE_ENCHANTMENT":
        return this.executeTradeRemoveEnchantment(
          request.villagerId,
          request.description,
          request.tradeId,
          request.slot,
          request.enchantmentIndex
        );

      case "TRADE_SET_ENCHANTMENT_LEVEL":
        return this.executeTradeSetEnchantmentLevel(
          request.villagerId,
          request.description,
          request.tradeId,
          request.slot,
          request.enchantmentIndex,
          request.level
        );

      case "BULK_SET_COST_QUANTITY_ONE":
        return this.executeBulk(request.villagerIds, request.description, (v) => {
          for (const trade of v.trades) {
            trade.buyA.count = 1;
            if (trade.buyCountA !== undefined) trade.buyCountA = 1;
            if (trade.buyB) {
              trade.buyB.count = 1;
              if (trade.buyCountB !== undefined) trade.buyCountB = 1;
            }
          }
        });

      case "BULK_RESTOCK":
        return this.executeBulk(request.villagerIds, request.description, (v) => {
          for (const trade of v.trades) {
            trade.uses = 0;
          }
        });

      case "BULK_SET_MAX_USES":
        return this.executeBulk(request.villagerIds, request.description, (v) => {
          for (const trade of v.trades) {
            trade.maxUses = request.maxUses;
          }
        });

      default:
        return this.result(false, `Unsupported command: ${(request as any).kind}`);
    }
  }

  private mutateVillager(
    villagerId: string,
    description: string,
    mutate: (villager: ParsedVillager) => void
  ): SessionCommandResult {
    const live = this.currentVillagers.get(villagerId);
    if (!live) {
      return this.result(false, "Villager not found.");
    }

    const before = clonePreservingBinary(live);
    const working = clonePreservingBinary(live);

    try {
      mutate(working);
    } catch (error) {
      return this.result(false, error instanceof Error ? error.message : String(error));
    }

    if (
      deepEqualSafe(toSessionDirtyVillagerState(before), toSessionDirtyVillagerState(working))
    ) {
      return this.result(true);
    }

    const after = clonePreservingBinary(working);
    this.currentVillagers.set(villagerId, after);
    this.recomputeDirty(villagerId);

    const command: SessionCommand = {
      id: `cmd_${Date.now()}_${randomUUID()}`,
      description,
      timestamp: Date.now(),
      villagerIds: [villagerId],
      undo: () => {
        this.currentVillagers.set(villagerId, clonePreservingBinary(before));
        this.recomputeDirty(villagerId);
      },
      redo: () => {
        this.currentVillagers.set(villagerId, clonePreservingBinary(after));
        this.recomputeDirty(villagerId);
      }
    };

    this.undoStack.push(command);
    this.redoStack = [];
    return this.result(true);
  }

  private executeBulk(
    villagerIds: string[],
    description: string,
    mutate: (villager: ParsedVillager) => void
  ): SessionCommandResult {
    const uniqueIds = [...new Set(villagerIds)];
    if (uniqueIds.length === 0) {
      return this.result(true);
    }

    const before = new Map<string, ParsedVillager>();
    const after = new Map<string, ParsedVillager>();

    try {
      for (const id of uniqueIds) {
        const live = this.currentVillagers.get(id);
        if (!live) {
          throw new Error(`Bulk target not found: ${id}`);
        }

        const original = clonePreservingBinary(live);
        const working = clonePreservingBinary(live);
        mutate(working);

        before.set(id, original);
        after.set(id, working);
      }
    } catch (error) {
      return this.result(false, error instanceof Error ? error.message : String(error));
    }

    const changedIds = uniqueIds.filter((id) => {
      const a = before.get(id);
      const b = after.get(id);
      return Boolean(a && b && !deepEqualSafe(toSessionDirtyVillagerState(a), toSessionDirtyVillagerState(b)));
    });

    if (changedIds.length === 0) {
      return this.result(true);
    }

    for (const id of changedIds) {
      const snapshot = after.get(id)!;
      this.currentVillagers.set(id, clonePreservingBinary(snapshot));
      this.recomputeDirty(id);
    }

    const command: SessionCommand = {
      id: `cmd_${Date.now()}_${randomUUID()}`,
      description,
      timestamp: Date.now(),
      villagerIds: [...changedIds],
      undo: () => {
        for (const id of changedIds) {
          this.currentVillagers.set(id, clonePreservingBinary(before.get(id)!));
          this.recomputeDirty(id);
        }
      },
      redo: () => {
        for (const id of changedIds) {
          this.currentVillagers.set(id, clonePreservingBinary(after.get(id)!));
          this.recomputeDirty(id);
        }
      }
    };

    this.undoStack.push(command);
    this.redoStack = [];
    return this.result(true);
  }

  private executeImportVillagersData(
    updates: TrustedVillagerImportUpdate[],
    description: string
  ): SessionCommandResult {
    const before = new Map<string, ParsedVillager>();
    const after = new Map<string, ParsedVillager>();

    for (const update of updates) {
      const live = this.currentVillagers.get(update.villagerId);
      if (!live) {
        return this.result(
          false,
          `Trusted import target not found: ${update.villagerId}.`
        );
      }

      const original = before.get(update.villagerId) || clonePreservingBinary(live);
      const working = after.get(update.villagerId) || clonePreservingBinary(live);

      if (update.customName !== undefined) {
        working.customName = update.customName;
      }
      if (update.profession !== undefined) {
        if (!isKnownProfession(update.profession)) {
          return this.result(false, `Unknown villager profession "${update.profession}".`);
        }
        working.profession = update.profession;
        working.professionDisplayName = getProfessionDisplayName(update.profession);
        working.professionKnown = true;
      }
      if (update.careerLevel !== undefined) {
        if (update.careerLevel < 0 || update.careerLevel > 5) {
          return this.result(false, `Career level must be between 0 and 5, got ${update.careerLevel}.`);
        }
        working.careerLevel = Math.floor(update.careerLevel);
        working.careerLevelName =
          CAREER_TIER_NAMES[working.careerLevel] || (working.careerLevel === 0 ? "Unranked" : `Tier ${working.careerLevel}`);
      }
      if (update.experience !== undefined) {
        working.experience = Math.max(0, Math.floor(update.experience));
      }
      if (update.position !== undefined) {
        working.position = clonePreservingBinary(update.position);
      }
      if (update.trades !== undefined) {
        working.trades = clonePreservingBinary(update.trades);
      }

      before.set(update.villagerId, original);
      after.set(update.villagerId, working);
    }

    const changedIds = Array.from(before.keys()).filter((id) => {
      const a = before.get(id);
      const b = after.get(id);
      return Boolean(
        a &&
          b &&
          !deepEqualSafe(toSessionDirtyVillagerState(a), toSessionDirtyVillagerState(b))
      );
    });

    if (changedIds.length === 0) {
      return this.result(true);
    }

    for (const id of changedIds) {
      const snapshot = after.get(id)!;
      this.currentVillagers.set(id, clonePreservingBinary(snapshot));
      this.recomputeDirty(id);
    }

    const command: SessionCommand = {
      id: `cmd_${Date.now()}_${randomUUID()}`,
      description,
      timestamp: Date.now(),
      villagerIds: [...changedIds],
      undo: () => {
        for (const id of changedIds) {
          this.currentVillagers.set(id, clonePreservingBinary(before.get(id)!));
          this.recomputeDirty(id);
        }
      },
      redo: () => {
        for (const id of changedIds) {
          this.currentVillagers.set(id, clonePreservingBinary(after.get(id)!));
          this.recomputeDirty(id);
        }
      }
    };

    this.undoStack.push(command);
    this.redoStack = [];
    return this.result(true);
  }

  private executePatch(
    villagerId: string,
    description: string,
    patch: any
  ): SessionCommandResult {
    return this.mutateVillager(villagerId, description, (working) => {
      if (Object.prototype.hasOwnProperty.call(patch, "customName")) {
        working.customName = patch.customName ?? null;
      }

      if (patch.profession !== undefined) {
        if (!isKnownProfession(patch.profession)) {
          throw new Error("Refusing to set an unknown profession.");
        }
        working.profession = patch.profession;
        working.professionDisplayName = getProfessionDisplayName(patch.profession);
        working.professionKnown = true;
      }

      if (patch.careerLevel !== undefined) {
        working.careerLevel = patch.careerLevel;
        working.careerLevelName = CAREER_TIER_NAMES[patch.careerLevel] || `Tier ${patch.careerLevel}`;
      }

      if (patch.experience !== undefined) {
        working.experience = patch.experience;
      }

      if (patch.position !== undefined) {
        working.position = clonePreservingBinary(patch.position);
      }
    });
  }

  private executeTradeAdd(villagerId: string, description: string): SessionCommandResult {
    return this.mutateVillager(villagerId, description, (v) => {
      const usedIds = new Set<string>(
        v.trades.flatMap((trade) => (trade.id ? [trade.id] : []))
      );
      const newTrade: TradeRecipe = {
        id: allocateUniqueTradeId(usedIds),
        tier: 1,
        buyA: { id: "minecraft:emerald", count: 1 },
        buyB: null,
        sell: { id: "minecraft:bread", count: 1 },
        maxUses: 16,
        uses: 0,
        traderExp: 1,
        rewardExp: true,
        priceMultiplierA: 0.05
      };
      v.trades.push(newTrade);
    });
  }

  private executeTradeDelete(
    villagerId: string,
    description: string,
    tradeId: string
  ): SessionCommandResult {
    return this.mutateVillager(villagerId, description, (v) => {
      const idx = v.trades.findIndex((t) => t.id === tradeId);
      if (idx === -1) throw new Error(`Trade ${tradeId} not found`);
      v.trades.splice(idx, 1);
    });
  }

  private executeTradeRestock(
    villagerId: string,
    description: string,
    tradeId: string
  ): SessionCommandResult {
    return this.mutateVillager(villagerId, description, (v) => {
      const trade = v.trades.find((t) => t.id === tradeId);
      if (!trade) throw new Error(`Trade ${tradeId} not found`);
      trade.uses = 0;
    });
  }

  private executeTradeSetItem(
    villagerId: string,
    description: string,
    tradeId: string,
    slot: "buyA" | "buyB" | "sell",
    item: TradeItemInput | null
  ): SessionCommandResult {
    return this.mutateVillager(villagerId, description, (v) => {
      const trade = v.trades.find((t) => t.id === tradeId);
      if (!trade) throw new Error(`Trade ${tradeId} not found`);

      const assignItem = (
        existing: TradeItem | null,
        input: TradeItemInput
      ): TradeItem => {
        if (existing && existing.id === input.id) {
          return {
            ...existing,
            count: input.count,
            damage: input.damage !== undefined ? input.damage : existing.damage
          };
        }

        return {
          id: input.id,
          count: input.count,
          ...(input.damage !== undefined ? { damage: input.damage } : {})
        };
      };

      if (slot === "buyB") {
        if (!item) {
          trade.buyB = null;
          trade.buyCountB = undefined;
        } else {
          trade.buyB = assignItem(trade.buyB, item);
          if (trade.buyCountB !== undefined) {
            trade.buyCountB = item.count;
          }
        }
      } else {
        if (!item) throw new Error(`Slot ${slot} cannot be set to null`);
        trade[slot] = assignItem(trade[slot], item);
        if (slot === "buyA" && trade.buyCountA !== undefined) {
          trade.buyCountA = item.count;
        }
      }
    });
  }

  private executeTradeSetItemCount(
    villagerId: string,
    description: string,
    tradeId: string,
    slot: "buyA" | "buyB" | "sell",
    count: number
  ): SessionCommandResult {
    return this.mutateVillager(villagerId, description, (villager) => {
      const trade = villager.trades.find((candidate) => candidate.id === tradeId);
      if (!trade) {
        throw new Error(`Trade ${tradeId} not found`);
      }

      const item = trade[slot];
      if (!item) {
        throw new Error(`${slot} does not contain an item.`);
      }

      item.count = count;

      if (slot === "buyA" && trade.buyCountA !== undefined) {
        trade.buyCountA = count;
      }

      if (slot === "buyB" && trade.buyCountB !== undefined) {
        trade.buyCountB = count;
      }
    });
  }

  private executeTradeSetSettings(
    villagerId: string,
    description: string,
    tradeId: string,
    patch: TradeSettingsPatch
  ): SessionCommandResult {
    return this.mutateVillager(villagerId, description, (v) => {
      const trade = v.trades.find((t) => t.id === tradeId);
      if (!trade) throw new Error(`Trade ${tradeId} not found`);

      if (patch.tier !== undefined) trade.tier = patch.tier;
      if (patch.maxUses !== undefined) trade.maxUses = patch.maxUses;
      if (patch.uses !== undefined) trade.uses = patch.uses;
      if (patch.traderExp !== undefined) trade.traderExp = patch.traderExp;
      if (patch.rewardExp !== undefined) trade.rewardExp = patch.rewardExp;
      if (patch.priceMultiplierA !== undefined) trade.priceMultiplierA = patch.priceMultiplierA;
      if (patch.priceMultiplierB !== undefined) trade.priceMultiplierB = patch.priceMultiplierB ?? undefined;
      if (patch.demand !== undefined) trade.demand = patch.demand ?? undefined;
    });
  }

  private executeTradeAddEnchantment(
    villagerId: string,
    description: string,
    tradeId: string,
    slot: "sell",
    enchantmentId: number,
    level: number
  ): SessionCommandResult {
    return this.mutateVillager(villagerId, description, (v) => {
      const definition = getEnchantmentById(enchantmentId);
      if (!definition) {
        throw new Error(`Unknown enchantment ID: ${enchantmentId}`);
      }

      if (!Number.isInteger(level) || level < 1 || level > definition.maxLevel) {
        throw new Error(
          `${definition.displayName} supports levels 1-${definition.maxLevel}.`
        );
      }

      const trade = v.trades.find((candidate) => candidate.id === tradeId);
      if (!trade) {
        throw new Error(`Trade ${tradeId} not found`);
      }

      const item = trade[slot];
      if (!item) {
        throw new Error(`Item in slot ${slot} does not exist`);
      }

      if (!item.enchantments) {
        item.enchantments = [];
      }

      const existing = item.enchantments.find(
        (enchantment) => enchantment.id === enchantmentId
      );

      if (existing) {
        existing.name = definition.name;
        existing.level = level;
      } else {
        item.enchantments.push({
          id: definition.id,
          name: definition.name,
          level
        });
      }
    });
  }

  private executeTradeRemoveEnchantment(
    villagerId: string,
    description: string,
    tradeId: string,
    slot: "sell",
    enchantmentIndex: number
  ): SessionCommandResult {
    return this.mutateVillager(villagerId, description, (v) => {
      const trade = v.trades.find((t) => t.id === tradeId);
      if (!trade) throw new Error(`Trade ${tradeId} not found`);
      const item = trade[slot];
      if (!item?.enchantments || enchantmentIndex < 0 || enchantmentIndex >= item.enchantments.length) {
        throw new Error("Invalid enchantment index");
      }
      item.enchantments.splice(enchantmentIndex, 1);
    });
  }

  private executeTradeSetEnchantmentLevel(
    villagerId: string,
    description: string,
    tradeId: string,
    slot: "sell",
    enchantmentIndex: number,
    level: number
  ): SessionCommandResult {
    return this.mutateVillager(villagerId, description, (v) => {
      const trade = v.trades.find((t) => t.id === tradeId);
      if (!trade) throw new Error(`Trade ${tradeId} not found`);
      const item = trade[slot];
      if (
        !item?.enchantments ||
        enchantmentIndex < 0 ||
        enchantmentIndex >= item.enchantments.length
      ) {
        throw new Error("Invalid enchantment index.");
      }

      const enchantment = item.enchantments[enchantmentIndex]!;
      if (typeof enchantment.id !== "number") {
        throw new Error(
          "Cannot edit the level of an enchantment without a numeric Bedrock ID."
        );
      }

      const definition = getEnchantmentById(enchantment.id);
      if (!definition) {
        throw new Error(
          `Unknown enchantment ID ${enchantment.id} is preserved read-only. Remove it explicitly if you do not want it.`
        );
      }

      if (!Number.isInteger(level) || level < 1 || level > definition.maxLevel) {
        throw new Error(
          `${definition.displayName} supports levels 1-${definition.maxLevel}.`
        );
      }

      enchantment.name = definition.name;
      enchantment.level = level;
    });
  }

  public undo(): SessionCommandResult {
    const cmd = this.undoStack.pop();
    if (!cmd) {
      return this.result(false, "Nothing to undo");
    }
    cmd.undo();
    this.redoStack.push(cmd);
    return this.result(true, `Undid: ${cmd.description}`);
  }

  public redo(): SessionCommandResult {
    const cmd = this.redoStack.pop();
    if (!cmd) {
      return this.result(false, "Nothing to redo");
    }
    cmd.redo();
    this.undoStack.push(cmd);
    return this.result(true, `Redid: ${cmd.description}`);
  }

  public getSavePreview(): SavePreview {
    const diffs: SaveDiffItem[] = [];

    for (const id of this.dirtyIds) {
      const current = this.currentVillagers.get(id);
      const baseline = this.baselineVillagers.get(id);
      if (!current || !baseline) continue;

      const changes: string[] = [];

      if (current.customName !== baseline.customName) {
        changes.push(`Name: "${baseline.customName || "(none)"}" -> "${current.customName || "(none)"}"`);
      }
      if (current.profession !== baseline.profession) {
        changes.push(`Profession: ${baseline.professionDisplayName} -> ${current.professionDisplayName}`);
      }
      if (current.careerLevel !== baseline.careerLevel) {
        changes.push(`Career Level: Tier ${baseline.careerLevel} -> Tier ${current.careerLevel}`);
      }
      if (current.experience !== baseline.experience) {
        changes.push(`Trade XP: ${baseline.experience} -> ${current.experience}`);
      }
      if (!deepEqualSafe(current.position, baseline.position)) {
        changes.push(
          `Position: (${baseline.position.x}, ${baseline.position.y}, ${baseline.position.z}) -> (${current.position.x}, ${current.position.y}, ${current.position.z})`
        );
      }
      if (!deepEqualSafe(current.trades, baseline.trades)) {
        changes.push(`Trades: ${baseline.trades.length} offer(s) -> ${current.trades.length} offer(s) modified`);
      }

      diffs.push({
        villagerId: current.sessionVillagerId,
        villagerName: current.customName || current.sessionVillagerId,
        profession: current.professionDisplayName,
        changes
      });
    }

    return {
      modifiedVillagersCount: this.dirtyIds.size,
      totalVillagersCount: this.currentVillagers.size,
      diffs,
      backupDestinationLabel: "Application backup storage",
      hasConflicts: false
    };
  }

  private recomputeDirty(villagerId: string): void {
    const current = this.currentVillagers.get(villagerId);
    const baseline = this.baselineVillagers.get(villagerId);
    if (!current || !baseline) return;

    const changed = !deepEqualSafe(
      toSessionDirtyVillagerState(current),
      toSessionDirtyVillagerState(baseline)
    );

    if (changed) {
      this.dirtyIds.add(villagerId);
    } else {
      this.dirtyIds.delete(villagerId);
    }
  }

  private result(success: boolean, errorOrDesc?: string): SessionCommandResult {
    return {
      success,
      canUndo: this.canUndo(),
      canRedo: this.canRedo(),
      ...(success ? { description: errorOrDesc } : { error: errorOrDesc })
    };
  }
}
