const providerTokenFields = [
  "accessToken",
  "refreshToken",
  "idToken",
  "accessTokenExpiresAt",
  "refreshTokenExpiresAt",
  "scope",
  "password",
] as const;

export function stripProviderTokens<T extends Record<string, unknown>>(account: T): T {
  const sanitized: Record<string, unknown> = { ...account };
  for (const field of providerTokenFields) sanitized[field] = null;
  return sanitized as T;
}

export function hasProviderTokenMaterial(account: Record<string, unknown>) {
  return providerTokenFields.some(
    (field) => account[field] !== null && account[field] !== undefined,
  );
}
