export type StorageFatalCode =
  | "SAVE_ROLLBACK_FAILED"
  | "SAVE_WRITE_STATE_UNKNOWN"
  | "RESTORE_ROLLBACK_FAILED"
  | "STORAGE_CLOSE_FAILED";

export class RestartRequiredStorageError extends Error {
  public readonly code: StorageFatalCode;
  public readonly publicMessage: string;
  public readonly debugDetail?: unknown;

  constructor(
    code: StorageFatalCode,
    publicMessage: string,
    debugDetail?: unknown
  ) {
    super(publicMessage);
    this.name = "RestartRequiredStorageError";
    this.code = code;
    this.publicMessage = publicMessage;
    this.debugDetail = debugDetail;
  }
}

export function isRestartRequiredStorageError(
  error: unknown
): error is RestartRequiredStorageError {
  return error instanceof RestartRequiredStorageError;
}
