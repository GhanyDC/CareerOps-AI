const allowedProtectedPath =
  /^\/(?:$|candidate-profile(?:\/.*)?$|experiences(?:\/.*)?$|projects(?:\/.*)?$|evidence(?:\/.*)?$|claims(?:\/.*)?$|discoveries(?:\/.*)?$)/;

export function safeReturnPath(value: string | null | undefined, fallback = "/") {
  if (!value) return fallback;

  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return fallback;
  }

  let parsed: URL;
  try {
    parsed = new URL(decoded, "https://careerops.invalid");
  } catch {
    return fallback;
  }

  if (
    !decoded.startsWith("/") ||
    decoded.startsWith("//") ||
    decoded.includes("\\") ||
    decoded.includes("\0") ||
    /[\r\n]/.test(decoded) ||
    parsed.origin !== "https://careerops.invalid" ||
    !allowedProtectedPath.test(parsed.pathname)
  ) {
    return fallback;
  }

  return decoded;
}
