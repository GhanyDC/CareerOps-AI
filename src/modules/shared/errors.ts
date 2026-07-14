export type SafeActionErrorCode =
  | "SESSION_REQUIRED"
  | "INVALID_INPUT"
  | "PAYLOAD_TOO_LARGE"
  | "INVALID_URL"
  | "UNSUPPORTED_CONTRACT_VERSION"
  | "INVALID_PREVIEW_TOKEN"
  | "PREVIEW_EXPIRED"
  | "IDEMPOTENCY_CONFLICT"
  | "DISCOVERY_NOT_FOUND"
  | "BATCH_NOT_FOUND"
  | "INVALID_STATUS_TRANSITION"
  | "VERSION_CONFLICT"
  | "INVALID_PURGE_CONFIRMATION"
  | "CONFLICT"
  | "UNEXPECTED_ERROR";

export class DomainError extends Error {
  constructor(
    message: string,
    readonly code?: SafeActionErrorCode,
  ) {
    super(message);
    this.name = "DomainError";
  }
}
