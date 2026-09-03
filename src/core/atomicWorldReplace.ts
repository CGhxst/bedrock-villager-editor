import * as fs from "node:fs";
import * as path from "node:path";
import { RestartRequiredStorageError } from "./storageFatalError";

export interface AtomicFs {
  existsSync: typeof fs.existsSync;
  statSync: typeof fs.statSync;
  readdirSync: typeof fs.readdirSync;
  renameSync: typeof fs.renameSync;
  rmSync: typeof fs.rmSync;
}

export const defaultAtomicFs: AtomicFs = {
  existsSync: fs.existsSync,
  statSync: fs.statSync,
  readdirSync: fs.readdirSync,
  renameSync: fs.renameSync,
  rmSync: fs.rmSync
};

/**
 * Atomically replaces a live world directory with extracted staging contents using directory swaps.
 * If anything fails after moving the original world, it automatically restores the original world.
 */
export function atomicReplaceWorldDirectory(
  livePath: string,
  stagingPath: string,
  previousPath: string,
  fsImpl: AtomicFs = defaultAtomicFs
): void {
  const stagingDb = path.join(stagingPath, "db");
  if (!fsImpl.existsSync(stagingDb) || !fsImpl.statSync(stagingDb).isDirectory()) {
    throw new Error("Backup is invalid: extracted db directory is missing.");
  }

  if (fsImpl.readdirSync(stagingDb).length === 0) {
    throw new Error("Backup is invalid: extracted db directory is empty.");
  }

  let originalMoved = false;
  let replacementMoved = false;

  try {
    // 1. Move current world out of the way
    fsImpl.renameSync(livePath, previousPath);
    originalMoved = true;

    // 2. Same-parent atomic rename from staging to live
    fsImpl.renameSync(stagingPath, livePath);
    replacementMoved = true;

    // 3. Validate installed replacement
    const installedDb = path.join(livePath, "db");
    if (
      !fsImpl.existsSync(installedDb) ||
      !fsImpl.statSync(installedDb).isDirectory() ||
      fsImpl.readdirSync(installedDb).length === 0
    ) {
      throw new Error("Restored world failed validation after directory swap.");
    }

    // SUCCESS. Do not delete previousPath here.
  } catch (error) {
    let rollbackFailure: Error | null = null;

    try {
      if (replacementMoved && fsImpl.existsSync(livePath)) {
        fsImpl.rmSync(livePath, { recursive: true, force: true });
      }

      if (originalMoved && fsImpl.existsSync(previousPath)) {
        fsImpl.renameSync(previousPath, livePath);
      }
    } catch (rollbackError) {
      rollbackFailure =
        rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError));
    }

    if (rollbackFailure) {
      throw new RestartRequiredStorageError(
        "RESTORE_ROLLBACK_FAILED",
        "BACKUP RESTORE AND AUTOMATIC ROLLBACK FAILED. " +
          "Do not continue editing this world. Restart the editor and recover from the pre-restore safety backup.",
        {
          restoreError: error instanceof Error ? error.message : String(error),
          rollbackError: rollbackFailure.message
        }
      );
    }

    throw error;
  }
}
