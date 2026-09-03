import { RestartRequiredStorageError } from "../core/storageFatalError";

export interface RestartHealthView {
  isRestartRequired(): boolean;
  getRestartMessage(): string;
}

export class MapReadBarrier {
  private readonly active = new Set<Promise<unknown>>();

  public async run<T>(task: () => Promise<T>): Promise<T> {
    const operation = task();
    this.active.add(operation);

    try {
      return await operation;
    } finally {
      this.active.delete(operation);
    }
  }

  public async drain(): Promise<void> {
    while (this.active.size > 0) {
      const snapshot = Array.from(this.active);
      await Promise.allSettled(snapshot);
    }
  }

  public async drainAndRequireHealthy(
    health: RestartHealthView,
    context: string
  ): Promise<void> {
    await this.drain();

    if (!health.isRestartRequired()) {
      return;
    }

    throw new RestartRequiredStorageError(
      "STORAGE_CLOSE_FAILED",
      health.getRestartMessage() ||
        "Restart the editor before performing another world operation.",
      {
        context,
        reason:
          "Storage became restart-required while the operation was draining active world-map reads."
      }
    );
  }

  public getActiveCountForTesting(): number {
    return this.active.size;
  }
}
