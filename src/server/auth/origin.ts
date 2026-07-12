import "server-only";

import type { ServerEnv } from "@/config/env.schema";
import { InvalidMutationOriginError } from "./errors";

export function assertTrustedMutationOrigin(
  requestHeaders: Headers,
  trustedOrigins: ServerEnv["AUTH_TRUSTED_ORIGINS"],
) {
  const originValue = requestHeaders.get("origin");
  const host = requestHeaders.get("host");
  if (!originValue || !host) throw new InvalidMutationOriginError();

  let origin: URL;
  try {
    origin = new URL(originValue);
  } catch {
    throw new InvalidMutationOriginError();
  }

  if (
    origin.origin !== originValue ||
    origin.host !== host ||
    !trustedOrigins.includes(origin.origin)
  ) {
    throw new InvalidMutationOriginError();
  }
}
