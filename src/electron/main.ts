import { app, BrowserWindow, dialog } from "electron";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import squirrelStartup from "electron-squirrel-startup";
import {
  IpcHandlerController,
  registerIpcHandlers,
  unregisterIpcHandlers
} from "../main/ipcHandlers";
import { disposeStorageBeforeWindowDestroy } from "./windowCloseCleanup";
import { configureInstallationUserData } from "./userDataPath";

// Enforce strict per-installation data isolation before any storage or window initializes
configureInstallationUserData(app);

let mainWindow: BrowserWindow | null = null;
let ipcController: IpcHandlerController | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 650,
    title: "Bedrock Villager Editor",
    icon: path.join(__dirname, "../../public/icon.png"),
    backgroundColor: "#121316",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "../main/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      allowRunningInsecureContent: false
    }
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  const backupRoot = path.join(app.getPath("userData"), "backups");
  ipcController = registerIpcHandlers(mainWindow, { backupRoot });

  const htmlPath = path.join(__dirname, "../../public/index.html");
  const appUrl = pathToFileURL(htmlPath).href;

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (url !== appUrl) {
      event.preventDefault();
      console.warn("Blocked navigation:", url);
    }
  });

  mainWindow.loadFile(htmlPath);

  let closeCleanupStarted = false;

  mainWindow.on("close", (event) => {
    const state = ipcController?.getSessionState();

    if (closeCleanupStarted) {
      event.preventDefault();
      return;
    }

    if (state?.busyOperation) {
      event.preventDefault();
      dialog.showMessageBoxSync(mainWindow!, {
        type: "warning",
        buttons: ["OK"],
        defaultId: 0,
        title: "World Operation In Progress",
        message: state.busyOperation,
        detail:
          "Wait for the current save/restore/backup operation to finish before closing the editor."
      });
      return;
    }

    if (state && state.dirtyCount > 0) {
      const choice = dialog.showMessageBoxSync(mainWindow!, {
        type: "warning",
        buttons: ["Cancel", "Discard Changes and Exit"],
        defaultId: 0,
        cancelId: 0,
        title: "Unsaved Changes",
        message: `You have ${state.dirtyCount} unsaved change(s).`,
        detail: "Exit without saving these changes?"
      });

      if (choice === 0) {
        event.preventDefault();
        return;
      }
    }

    const win = mainWindow;
    const controller = ipcController;

    if (!win || !controller) {
      return;
    }

    event.preventDefault();
    closeCleanupStarted = true;

    const restartRequired = Boolean(
      controller.getSessionState().restartRequired
    );

    unregisterIpcHandlers();

    win.hide();

    void disposeStorageBeforeWindowDestroy({
      restartRequired,
      disposeStorage: () => controller.disposeStorage(),
      destroyWindow: () => {
        if (!win.isDestroyed()) {
          win.destroy();
        }
      },
      logError: (message, error) => {
        if (error === undefined) {
          console.error(message);
        } else {
          console.error(message, error);
        }
      }
    })
      .then(({ forceQuit }) => {
        if (forceQuit) {
          app.quit();
        }
      })
      .catch((error) => {
        console.error(
          "Unexpected failure while finalizing the application window:",
          error
        );
        if (!win.isDestroyed()) {
          win.destroy();
        }
        app.quit();
      });
  });

  mainWindow.on("closed", () => {
    ipcController = null;
    mainWindow = null;
    unregisterIpcHandlers();
  });
}

if (squirrelStartup) {
  app.quit();
} else {
  app.whenReady().then(() => {
    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });
}
