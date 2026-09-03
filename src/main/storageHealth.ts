import { BedrockDbManager } from "../core/bedrockDb";

export class StorageHealth {
  private restartRequired = false;
  private restartMessage = "";
  private readonly quarantined = new Set<BedrockDbManager>();

  public isRestartRequired(): boolean {
    return this.restartRequired;
  }

  public getRestartMessage(): string {
    return this.restartMessage;
  }

  public requireHealthy(): void {
    if (this.restartRequired) {
      throw new Error(
        this.restartMessage ||
          "Restart the editor before performing another world operation."
      );
    }
  }

  public markRestartRequired(message: string): void {
    this.restartRequired = true;
    this.restartMessage = message;
  }

  public quarantine(manager: BedrockDbManager, message: string): void {
    this.quarantined.add(manager);
    this.markRestartRequired(message);
  }

  public release(manager: BedrockDbManager): void {
    this.quarantined.delete(manager);
  }

  public getQuarantinedForTesting(): readonly BedrockDbManager[] {
    return [...this.quarantined];
  }

  public async disposeAll(
    activeManager?: BedrockDbManager | null
  ): Promise<boolean> {
    const managers = new Set<BedrockDbManager>(this.quarantined);

    if (activeManager) {
      managers.add(activeManager);
    }

    let allClosed = true;

    for (const manager of managers) {
      try {
        await manager.close();
        this.quarantined.delete(manager);
      } catch {
        this.quarantined.add(manager);
        allClosed = false;
      }
    }

    return allClosed;
  }
}
