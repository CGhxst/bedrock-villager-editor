import * as path from "node:path";
import * as fs from "node:fs";
import * as crypto from "node:crypto";
import { app } from "electron";

export interface InstallationDataOptions {
  isPackaged: boolean;
  execPath: string;
  defaultAppData: string;
  defaultUserData: string;
}

/**
 * Computes the isolated per-installation data directory.
 *
 * Requirements:
 * 1. Data must NEVER persist across separate installations.
 * 2. No magic marker files (e.g., portable.txt) should be needed.
 * 3. Packaged standalone/portable installations store all user data (Chromium localStorage,
 *    cookies, cache, world backups) directly in `<install_dir>/data`.
 * 4. If `<install_dir>/data` cannot be written to (e.g. read-only filesystem or restricted
 *    system folder), fallback to a deterministically hashed per-installation directory under
 *    AppData so that separate installations still never share data or collide.
 * 5. When unpackaged (development mode), the default user data path is preserved.
 */
export function computeInstallationDataDirectory(options: InstallationDataOptions): string {
  const { isPackaged, execPath, defaultAppData, defaultUserData } = options;

  if (!isPackaged) {
    return defaultUserData;
  }

  const installDir = path.dirname(path.resolve(execPath));
  const preferredDataDir = path.join(installDir, "data");

  try {
    if (!fs.existsSync(preferredDataDir)) {
      fs.mkdirSync(preferredDataDir, { recursive: true });
    }

    // Verify write permissions with a temporary probe file
    const probeFile = path.join(
      preferredDataDir,
      `.probe-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    );
    fs.writeFileSync(probeFile, "");
    fs.unlinkSync(probeFile);

    return preferredDataDir;
  } catch {
    // If the installation directory is not writable, fallback to an isolated per-installation folder
    const normalizedInstallDir =
      process.platform === "win32" ? installDir.toLowerCase() : installDir;
    const installHash = crypto
      .createHash("sha256")
      .update(normalizedInstallDir)
      .digest("hex")
      .slice(0, 16);

    const isolatedFallback = path.join(
      defaultAppData,
      "Bedrock Villager Editor",
      "installations",
      `inst_${installHash}`
    );

    try {
      if (!fs.existsSync(isolatedFallback)) {
        fs.mkdirSync(isolatedFallback, { recursive: true });
      }
      return isolatedFallback;
    } catch {
      return defaultUserData;
    }
  }
}

/**
 * Configures Electron's userData path to be strictly localized per installation.
 * Must be called early in the main process before app.whenReady().
 */
export function configureInstallationUserData(electronApp = app): string {
  const isPackaged = electronApp.isPackaged;
  const execPath = process.execPath;
  const defaultAppData = electronApp.getPath("appData");
  const defaultUserData = electronApp.getPath("userData");

  const targetUserData = computeInstallationDataDirectory({
    isPackaged,
    execPath,
    defaultAppData,
    defaultUserData
  });

  if (targetUserData !== defaultUserData) {
    electronApp.setPath("userData", targetUserData);
  }

  return targetUserData;
}
