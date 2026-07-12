export class UnauthenticatedError extends Error {
  readonly code = "SESSION_REQUIRED";

  constructor(message = "A valid session is required.") {
    super(message);
    this.name = "UnauthenticatedError";
  }
}

export class SessionExpiredError extends UnauthenticatedError {
  constructor() {
    super("The session has expired.");
    this.name = "SessionExpiredError";
  }
}

export class AccountUnavailableError extends Error {
  readonly code = "ACCOUNT_UNAVAILABLE";

  constructor() {
    super("The account is unavailable.");
    this.name = "AccountUnavailableError";
  }
}

export class InvalidMutationOriginError extends Error {
  readonly code = "INVALID_MUTATION_ORIGIN";

  constructor() {
    super("The mutation origin is not trusted.");
    this.name = "InvalidMutationOriginError";
  }
}

export function isSessionRequiredError(error: unknown): error is UnauthenticatedError {
  return error instanceof UnauthenticatedError;
}
