import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { computeInstallationDataDirectory } from "../src/electron/userDataPath";

describe("Installation Data Isolation", () => {
  it("isolates data directories between separate installations without any magic marker files", () => {
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "bve-install-test-"));
    try {
      const installA = path.join(tmpBase, "InstallationA");
      const installB = path.join(tmpBase, "InstallationB");
      fs.mkdirSync(installA, { recursive: true });
      fs.mkdirSync(installB, { recursive: true });

      const execA = path.join(installA, "Bedrock Villager Editor.exe");
      const execB = path.join(installB, "Bedrock Villager Editor.exe");
      fs.writeFileSync(execA, "");
      fs.writeFileSync(execB, "");

      const dataA = computeInstallationDataDirectory({
        isPackaged: true,
        execPath: execA,
        defaultAppData: path.join(tmpBase, "AppData"),
        defaultUserData: path.join(tmpBase, "AppData", "Bedrock Villager Editor")
      });

      const dataB = computeInstallationDataDirectory({
        isPackaged: true,
        execPath: execB,
        defaultAppData: path.join(tmpBase, "AppData"),
        defaultUserData: path.join(tmpBase, "AppData", "Bedrock Villager Editor")
      });

      // Must be localized within each installation folder
      assert.equal(dataA, path.join(installA, "data"));
      assert.equal(dataB, path.join(installB, "data"));
      assert.notEqual(dataA, dataB);
      assert.ok(fs.existsSync(dataA), "data directory A must be created");
      assert.ok(fs.existsSync(dataB), "data directory B must be created");
    } finally {
      fs.rmSync(tmpBase, { recursive: true, force: true });
    }
  });

  it("preserves defaultUserData when unpackaged in development mode", () => {
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "bve-install-dev-"));
    try {
      const defaultUser = path.join(tmpBase, "AppData", "Bedrock Villager Editor");
      const result = computeInstallationDataDirectory({
        isPackaged: false,
        execPath: process.execPath,
        defaultAppData: path.join(tmpBase, "AppData"),
        defaultUserData: defaultUser
      });

      assert.equal(result, defaultUser);
    } finally {
      fs.rmSync(tmpBase, { recursive: true, force: true });
    }
  });

  it("falls back to isolated per-installation directories under AppData when install dir is read-only", () => {
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "bve-install-ro-"));
    try {
      // Point execPath to a non-existent drive/unwritable root path simulation
      const execA = path.join(tmpBase, "ProtectedInstallA", "sub", "Bedrock Villager Editor.exe");
      const execB = path.join(tmpBase, "ProtectedInstallB", "sub", "Bedrock Villager Editor.exe");

      // Make parent directory read-only or simulate failure by passing a path where mkdir fails
      const appData = path.join(tmpBase, "AppData");

      // Create a file where "data" folder would be, to force mkdirSync to throw
      const installParentA = path.dirname(execA);
      const installParentB = path.dirname(execB);
      fs.mkdirSync(installParentA, { recursive: true });
      fs.mkdirSync(installParentB, { recursive: true });
      fs.writeFileSync(path.join(installParentA, "data"), "blocking-file");
      fs.writeFileSync(path.join(installParentB, "data"), "blocking-file");

      const dataA = computeInstallationDataDirectory({
        isPackaged: true,
        execPath: execA,
        defaultAppData: appData,
        defaultUserData: path.join(appData, "Bedrock Villager Editor")
      });

      const dataB = computeInstallationDataDirectory({
        isPackaged: true,
        execPath: execB,
        defaultAppData: appData,
        defaultUserData: path.join(appData, "Bedrock Villager Editor")
      });

      // Both fall back to AppData, but under unique installation hashes
      assert.ok(dataA.includes("inst_"), "dataA should have installation hash subfolder");
      assert.ok(dataB.includes("inst_"), "dataB should have installation hash subfolder");
      assert.notEqual(dataA, dataB, "Fallback directories must not collide between installations");
    } finally {
      fs.rmSync(tmpBase, { recursive: true, force: true });
    }
  });

  it("is deterministic: repeated calls for the same installation path produce the same directory", () => {
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "bve-install-det-"));
    try {
      const install = path.join(tmpBase, "AppFolder");
      fs.mkdirSync(install, { recursive: true });
      const exec = path.join(install, "Bedrock Villager Editor.exe");
      fs.writeFileSync(exec, "");

      const run1 = computeInstallationDataDirectory({
        isPackaged: true,
        execPath: exec,
        defaultAppData: path.join(tmpBase, "AppData"),
        defaultUserData: path.join(tmpBase, "AppData", "Bedrock Villager Editor")
      });

      const run2 = computeInstallationDataDirectory({
        isPackaged: true,
        execPath: exec,
        defaultAppData: path.join(tmpBase, "AppData"),
        defaultUserData: path.join(tmpBase, "AppData", "Bedrock Villager Editor")
      });

      assert.equal(run1, run2);
    } finally {
      fs.rmSync(tmpBase, { recursive: true, force: true });
    }
  });
});
