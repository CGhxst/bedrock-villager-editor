import { BedrockDbManager } from "../core/bedrockDb";
import { RestartRequiredStorageError } from "../core/storageFatalError";
import { StorageHealth } from "./storageHealth";

export interface FatalStorageContext {
  storageHealth: StorageHealth;
  manager: BedrockDbManager | null;
  clearSession: () => void;
  clearManager: (expected: BedrockDbManager) => void;
}

async function applyRestartRequiredStorageLock(
  error: RestartRequiredStorageError,
  context: FatalStorageContext
): Promise<void> {
  context.clearSession();

  context.storageHealth.markRestartRequired(error.publicMessage);

  if (!context.manager) {
    return;
  }

  try {
    await context.manager.close();
    context.storageHealth.release(context.manager);
    context.clearManager(context.manager);
  } catch (closeError) {
    console.error(
      "Failed closing manager after restart-required storage error:",
      closeError
    );

    context.storageHealth.quarantine(
      context.manager,
      error.publicMessage
    );
  }
}

export async function handleRestartRequiredStorageFailure(
  error: RestartRequiredStorageError,
  context: FatalStorageContext
): Promise<{
  success: false;
  restartRequired: true;
  error: string;
}> {
  await applyRestartRequiredStorageLock(error, context);

  return {
    success: false,
    restartRequired: true,
    error: error.publicMessage
  };
}

export async function handleCommittedRestartRequiredStorageFailure(
  error: RestartRequiredStorageError,
  context: FatalStorageContext,
  warning: string
): Promise<{
  success: true;
  reloadRequired: true;
  restartRequired: true;
  warning: string;
}> {
  await applyRestartRequiredStorageLock(error, context);

  return {
    success: true,
    reloadRequired: true,
    restartRequired: true,
    warning
  };
}
