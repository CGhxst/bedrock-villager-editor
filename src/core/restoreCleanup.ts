import * as fs from "node:fs";

export interface RestoreCleanupFs {
  existsSync: typeof fs.existsSync;
  rmSync: typeof fs.rmSync;
}

export const defaultRestoreCleanupFs: RestoreCleanupFs = {
  existsSync: fs.existsSync,
  rmSync: fs.rmSync
};

export function cleanupPreviousRestoreDirectory(
  previousPath: string,
  fsImpl: RestoreCleanupFs = defaultRestoreCleanupFs
): {
  cleaned: boolean;
  warning?: string;
} {
  if (!fsImpl.existsSync(previousPath)) {
    return {
      cleaned: true
    };
  }

  try {
    fsImpl.rmSync(previousPath, {
      recursive: true,
      force: true
    });

    return {
      cleaned: true
    };
  } catch {
    return {
      cleaned: false,
      warning:
        "Restore succeeded, but an old recovery directory could not be removed automatically."
    };
  }
}
