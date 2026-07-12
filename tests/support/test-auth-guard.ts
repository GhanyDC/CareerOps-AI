export function assertTestAuthenticationEnvironment(nodeEnv: string | undefined) {
  if (nodeEnv === "production") {
    throw new Error("Test authentication is unavailable in production.");
  }
}
