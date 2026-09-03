export class OperationBusyError extends Error {
  public readonly operation: string;

  constructor(operation: string) {
    super(`Another world operation is already in progress: ${operation}`);
    this.name = "OperationBusyError";
    this.operation = operation;
  }
}

export class OperationGate {
  private activeOperation: string | null = null;

  public get current(): string | null {
    return this.activeOperation;
  }

  public async run<T>(
    operation: string,
    task: () => Promise<T>
  ): Promise<T> {
    if (this.activeOperation) {
      throw new OperationBusyError(this.activeOperation);
    }

    this.activeOperation = operation;

    try {
      return await task();
    } finally {
      this.activeOperation = null;
    }
  }
}
