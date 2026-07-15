import { DomainError, type SafeActionErrorCode } from "@/modules/shared/errors";

export class JobParsingError extends DomainError {
  constructor(code: SafeActionErrorCode, message: string) {
    super(message, code);
    this.name = "JobParsingError";
  }
}
