export interface WindowCloseDisposeResult {
  success: boolean;
}

export interface WindowCloseCleanupOptions {
  restartRequired: boolean;
  disposeStorage: () => Promise<WindowCloseDisposeResult>;
  destroyWindow: () => void;
  logError?: (message: string, error?: unknown) => void;
}

export interface WindowCloseCleanupResult {
  forceQuit: boolean;
}

export async function disposeStorageBeforeWindowDestroy(
  options: WindowCloseCleanupOptions
): Promise<WindowCloseCleanupResult> {
  const logError =
    options.logError ??
    ((message: string, error?: unknown) => {
      if (error === undefined) {
        console.error(message);
      } else {
        console.error(message, error);
      }
    });

  let forceQuit = options.restartRequired;

  try {
    const result = await options.disposeStorage();

    if (!result.success) {
      forceQuit = true;
      logError(
        "Storage handle could not be closed cleanly during window disposal. " +
          "The process must quit to release native LevelDB resources."
      );
    }

    if (options.restartRequired) {
      logError(
        "A restart-required storage condition was active during window disposal. " +
          "The process must quit after storage cleanup."
      );
    }
  } catch (error) {
    forceQuit = true;
    logError(
      "Unexpected storage disposal failure during window close:",
      error
    );
  } finally {
    options.destroyWindow();
  }

  return {
    forceQuit
  };
}
