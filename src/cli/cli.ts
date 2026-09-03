import { Command } from "commander";
import * as fs from "fs";
import * as path from "path";
import { BedrockDbManager, findBedrockWorlds } from "../core/bedrockDb";
import { stringifyDebugValue } from "../core/clone";
import { exportVillagersToJson, importVillagersFromJson } from "../core/jsonExchange";
import { WorldSession } from "../core/session/WorldSession";
import { SessionCommandResult } from "../core/types";

function requireCommandSuccess(result: SessionCommandResult): void {
  if (!result.success) {
    throw new Error(`Command failed: ${result.error || "Unknown session error"}`);
  }
}

export const program = new Command();

program
  .name("villager-editor")
  .description("Minecraft Bedrock Edition Villager & Trade Editor CLI")
  .version("1.0.0");

// Command: list
program
  .command("list")
  .description("List all detected Minecraft Bedrock worlds on this PC")
  .action(() => {
    console.log("Searching for Minecraft Bedrock worlds...\n");
    const worlds = findBedrockWorlds();
    if (worlds.length === 0) {
      console.log("No Minecraft Bedrock worlds found in standard AppData directories.");
      return;
    }

    console.log(`Found ${worlds.length} Bedrock world(s):\n`);
    worlds.forEach((w, i) => {
      const dateStr = w.lastPlayed ? new Date(w.lastPlayed).toLocaleString() : "Unknown";
      console.log(`[${i + 1}] ${w.name}`);
      console.log(`    Folder: ${w.folderName}`);
      console.log(`    Path:   ${w.path}`);
      console.log(`    Last:   ${dateStr}\n`);
    });
  });

// Command: dump (Diagnostic/read-only export)
program
  .command("dump <worldPath>")
  .description("Dump all villager data, trades, and workstations from a Bedrock world into a diagnostic JSON file")
  .option("-o, --output <filePath>", "Output JSON file path", "villagers_dump.json")
  .action(async (worldPath: string, options: any) => {
    try {
      const resolvedWorld = path.resolve(worldPath);
      const resolvedOutput = path.resolve(options.output);

      console.log(`\nOpening Bedrock world at: ${resolvedWorld}`);
      const manager = new BedrockDbManager(resolvedWorld);
      const dump = await manager.dumpVillagers();
      await manager.close();

      fs.writeFileSync(resolvedOutput, stringifyDebugValue(dump), "utf8");
      console.log(`\nSuccessfully dumped ${dump.villagerCount} villager(s) to:`);
      console.log(`  -> ${resolvedOutput}\n`);
    } catch (err: any) {
      console.error(`\n[ERROR] Failed to dump villagers: ${err.message}\n`);
      process.exit(1);
    }
  });

// Command: discount (Authoritative WorldSession session commands only)
program
  .command("discount <worldPath>")
  .description("Batch discount trade costs in a world to 1 item using transactional session commands")
  .option("-m, --max-uses <number>", "Optional maximum stock uses before lockout")
  .option("-r, --reset-uses", "Reset traded uses to 0 (instant restock)", false)
  .action(async (worldPath: string, options: any) => {
    try {
      const resolvedPath = path.resolve(worldPath);
      const resetUses = Boolean(options.resetUses);

      let customMaxUses: number | undefined;
      if (options.maxUses !== undefined) {
        const parsed = Number(options.maxUses);
        if (!Number.isInteger(parsed) || parsed < 1 || parsed > 99999) {
          throw new Error("--max-uses must be an integer from 1 to 99999.");
        }
        customMaxUses = parsed;
      }

      console.log(`\nReading villagers from: ${resolvedPath}`);
      const manager = new BedrockDbManager(resolvedPath);
      const dump = await manager.dumpVillagers();

      const allIds = dump.villagers.map((v) => v.sessionVillagerId);
      if (allIds.length === 0) {
        console.log("No villagers found; nothing to change.\n");
        await manager.close();
        return;
      }

      const session = new WorldSession(dump);

      // 1. Set cost quantity to 1
      requireCommandSuccess(
        session.executeRequest({
          kind: "BULK_SET_COST_QUANTITY_ONE",
          description: "CLI: Bulk set trade cost quantities to 1",
          villagerIds: allIds
        })
      );

      // 2. Reset uses if requested
      if (resetUses) {
        requireCommandSuccess(
          session.executeRequest({
            kind: "BULK_RESTOCK",
            description: "CLI: Bulk restock trade uses",
            villagerIds: allIds
          })
        );
      }

      // 3. Custom max uses if requested
      if (customMaxUses && customMaxUses > 0) {
        requireCommandSuccess(
          session.executeRequest({
            kind: "BULK_SET_MAX_USES",
            description: `CLI: Bulk set max uses to ${customMaxUses}`,
            villagerIds: allIds,
            maxUses: customMaxUses
          })
        );
      }

      const dirtyWrites = session.getDirtyWrites();
      console.log(`Applying transactional updates to ${dirtyWrites.length} villager(s)...`);

      const result = await manager.applyDirtyVillagers(dirtyWrites, {
        createBackup: true
      });
      await manager.close();

      if (result.backupPath) {
        console.log(`Backup created at: ${result.backupPath}`);
      }
      console.log(`\nSuccessfully applied verified changes to ${result.modifiedCount} villager(s)!\n`);
    } catch (err: any) {
      console.error(`\n[ERROR] Discount failed: ${err.message}\n`);
      process.exit(1);
    }
  });

// Command: export (Clean editable JSON export)
program
  .command("export <worldPath>")
  .description("Export all villager data and trades from a Bedrock world into an editable JSON file")
  .option("-o, --output <filePath>", "Output JSON file path", "villagers_export.json")
  .action(async (worldPath: string, options: any) => {
    try {
      const resolvedWorld = path.resolve(worldPath);
      const resolvedOutput = path.resolve(options.output);

      console.log(`\nOpening Bedrock world at: ${resolvedWorld}`);
      const manager = new BedrockDbManager(resolvedWorld);
      const dump = await manager.dumpVillagers();
      const session = new WorldSession(dump);
      await manager.close();

      const json = exportVillagersToJson(session);
      fs.writeFileSync(resolvedOutput, json, "utf8");
      console.log(`\nSuccessfully exported ${dump.villagerCount} villager(s) to:`);
      console.log(`  -> ${resolvedOutput}\n`);
    } catch (err: any) {
      console.error(`\n[ERROR] Failed to export villagers: ${err.message}\n`);
      process.exit(1);
    }
  });

// Command: import (Re-import edited JSON and apply to Bedrock world)
program
  .command("import <worldPath> <jsonPath>")
  .description("Import edited villager JSON data and apply updates to a Bedrock world with automatic backup")
  .action(async (worldPath: string, jsonPath: string) => {
    try {
      const resolvedWorld = path.resolve(worldPath);
      const resolvedJson = path.resolve(jsonPath);

      if (!fs.existsSync(resolvedJson)) {
        throw new Error(`JSON file not found: ${resolvedJson}`);
      }

      console.log(`\nReading edited JSON from: ${resolvedJson}`);
      const jsonContent = fs.readFileSync(resolvedJson, "utf8");

      console.log(`Opening Bedrock world at: ${resolvedWorld}`);
      const manager = new BedrockDbManager(resolvedWorld);
      const dump = await manager.dumpVillagers();
      const session = new WorldSession(dump);

      const importResult = importVillagersFromJson(session, jsonContent);
      if (!importResult.success) {
        throw new Error(importResult.error || "Failed to import JSON data.");
      }

      const dirtyWrites = session.getDirtyWrites();
      if (dirtyWrites.length === 0) {
        console.log("\nNo changes detected between imported JSON and active world.\n");
        await manager.close();
        return;
      }

      console.log(`Applying verified changes to ${dirtyWrites.length} villager(s)...`);
      const result = await manager.applyDirtyVillagers(dirtyWrites, {
        createBackup: true
      });
      await manager.close();

      if (result.backupPath) {
        console.log(`Backup created at: ${result.backupPath}`);
      }
      console.log(`\nSuccessfully applied verified updates to ${result.modifiedCount} villager(s)!\n`);
    } catch (err: any) {
      console.error(`\n[ERROR] Import failed: ${err.message}\n`);
      process.exit(1);
    }
  });

export function runCli(argv = process.argv): void {
  program.parse(argv);
}

if (require.main === module) {
  runCli();
}
