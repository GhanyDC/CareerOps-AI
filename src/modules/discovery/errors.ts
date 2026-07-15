import { DomainError, type SafeActionErrorCode } from "@/modules/shared/errors";

export class DiscoveryError extends DomainError {
  constructor(code: SafeActionErrorCode, message: string) {
    super(message, code);
    this.name = "DiscoveryError";
  }
}
