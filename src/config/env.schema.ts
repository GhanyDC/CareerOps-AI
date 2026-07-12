import { z } from "zod";

const databaseUrlSchema = z
  .string()
  .trim()
  .min(1, "DATABASE_URL is required")
  .superRefine((value, context) => {
    try {
      const url = new URL(value);

      if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
        context.addIssue({
          code: "custom",
          message: "DATABASE_URL must use the postgresql:// or postgres:// protocol",
        });
      }

      if (!url.hostname) {
        context.addIssue({ code: "custom", message: "DATABASE_URL must include a hostname" });
      }
    } catch {
      context.addIssue({
        code: "custom",
        message: "DATABASE_URL must be a valid PostgreSQL connection URL",
      });
    }
  });

const exactOriginSchema = z
  .string()
  .trim()
  .superRefine((value, context) => {
    try {
      const url = new URL(value);
      if (!url.hostname || !["http:", "https:"].includes(url.protocol)) {
        context.addIssue({ code: "custom", message: "must be an HTTP or HTTPS origin" });
      }
      if (url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
        context.addIssue({ code: "custom", message: "must be an exact origin without a path" });
      }
      if (value.includes("*")) {
        context.addIssue({ code: "custom", message: "wildcard origins are not allowed" });
      }
    } catch {
      context.addIssue({ code: "custom", message: "must be a valid origin" });
    }
  });

const nodeEnvSchema = z.enum(["development", "test", "production"]).default("development");

export const databaseEnvSchema = z.object({
  DATABASE_URL: databaseUrlSchema,
  NODE_ENV: nodeEnvSchema,
});

export const serverEnvSchema = databaseEnvSchema
  .extend({
    BETTER_AUTH_SECRET: z
      .string()
      .min(32, "BETTER_AUTH_SECRET must contain at least 32 characters"),
    BETTER_AUTH_URL: exactOriginSchema,
    AUTH_TRUSTED_ORIGINS: z.string().trim().min(1, "AUTH_TRUSTED_ORIGINS is required"),
    GOOGLE_CLIENT_ID: z.string().trim().min(1, "GOOGLE_CLIENT_ID is required"),
    GOOGLE_CLIENT_SECRET: z.string().trim().min(1, "GOOGLE_CLIENT_SECRET is required"),
    BETTER_AUTH_TRUSTED_ORIGINS: z.string().optional(),
    DEVELOPMENT_SEED_ENABLED: z.enum(["true", "false"]).default("false"),
    DEVELOPMENT_USER_KEY: z
      .string()
      .trim()
      .min(1, "DEVELOPMENT_USER_KEY cannot be empty")
      .max(100)
      .optional(),
    DEVELOPMENT_IDENTITY_ENABLED: z.enum(["true", "false"]).optional(),
  })
  .superRefine((value, context) => {
    if (value.BETTER_AUTH_TRUSTED_ORIGINS?.trim()) {
      context.addIssue({
        code: "custom",
        path: ["BETTER_AUTH_TRUSTED_ORIGINS"],
        message:
          "BETTER_AUTH_TRUSTED_ORIGINS is not supported; use AUTH_TRUSTED_ORIGINS exclusively",
      });
    }

    const trustedOrigins = value.AUTH_TRUSTED_ORIGINS.split(",").map((origin) => origin.trim());
    for (const [index, origin] of trustedOrigins.entries()) {
      const result = exactOriginSchema.safeParse(origin);
      if (!result.success) {
        context.addIssue({
          code: "custom",
          path: ["AUTH_TRUSTED_ORIGINS"],
          message: `origin ${index + 1} is invalid: ${result.error.issues[0]?.message ?? "invalid"}`,
        });
      }
    }

    if (!trustedOrigins.includes(value.BETTER_AUTH_URL)) {
      context.addIssue({
        code: "custom",
        path: ["AUTH_TRUSTED_ORIGINS"],
        message: "AUTH_TRUSTED_ORIGINS must include BETTER_AUTH_URL exactly",
      });
    }

    if (value.DEVELOPMENT_IDENTITY_ENABLED === "true") {
      context.addIssue({
        code: "custom",
        path: ["DEVELOPMENT_IDENTITY_ENABLED"],
        message: "Development identity authentication has been removed",
      });
    }

    if (value.DEVELOPMENT_SEED_ENABLED === "true" && !value.DEVELOPMENT_USER_KEY) {
      context.addIssue({
        code: "custom",
        path: ["DEVELOPMENT_USER_KEY"],
        message: "DEVELOPMENT_USER_KEY is required when the development seed is enabled",
      });
    }

    if (value.NODE_ENV === "production") {
      let baseUrl: URL | undefined;
      try {
        baseUrl = new URL(value.BETTER_AUTH_URL);
      } catch {
        // The field-level schema reports the invalid URL.
      }
      if (baseUrl && baseUrl.protocol !== "https:") {
        context.addIssue({
          code: "custom",
          path: ["BETTER_AUTH_URL"],
          message: "BETTER_AUTH_URL must use HTTPS in production",
        });
      }

      for (const origin of trustedOrigins) {
        let url: URL;
        try {
          url = new URL(origin);
        } catch {
          continue;
        }
        if (url.protocol !== "https:" || ["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
          context.addIssue({
            code: "custom",
            path: ["AUTH_TRUSTED_ORIGINS"],
            message: "Production trusted origins must use HTTPS and cannot use loopback hosts",
          });
        }
      }

      if (value.DEVELOPMENT_SEED_ENABLED === "true") {
        context.addIssue({
          code: "custom",
          path: ["DEVELOPMENT_SEED_ENABLED"],
          message: "Development seed data cannot be enabled in production",
        });
      }

      const placeholders = [
        "replace-with",
        "ci-not-used",
        "development-only",
        "test-only",
        "production-ci",
        "example",
        "dummy",
        "fake",
        "changeme",
        "e2e-",
      ];
      for (const [field, secret] of [
        ["BETTER_AUTH_SECRET", value.BETTER_AUTH_SECRET],
        ["GOOGLE_CLIENT_ID", value.GOOGLE_CLIENT_ID],
        ["GOOGLE_CLIENT_SECRET", value.GOOGLE_CLIENT_SECRET],
      ] as const) {
        if (placeholders.some((placeholder) => secret.toLowerCase().includes(placeholder))) {
          context.addIssue({
            code: "custom",
            path: [field],
            message: `${field} cannot use a placeholder in production`,
          });
        }
      }

      if (
        value.GOOGLE_CLIENT_ID.length < 40 ||
        !/^\d{6,}-[a-z0-9_-]{20,}\.apps\.googleusercontent\.com$/i.test(value.GOOGLE_CLIENT_ID)
      ) {
        context.addIssue({
          code: "custom",
          path: ["GOOGLE_CLIENT_ID"],
          message: "GOOGLE_CLIENT_ID must use the production Google OAuth client ID format",
        });
      }

      if (value.GOOGLE_CLIENT_SECRET.length < 20) {
        context.addIssue({
          code: "custom",
          path: ["GOOGLE_CLIENT_SECRET"],
          message: "GOOGLE_CLIENT_SECRET must contain at least 20 characters in production",
        });
      }
    }
  })
  .transform((value) => ({
    ...value,
    AUTH_TRUSTED_ORIGINS: value.AUTH_TRUSTED_ORIGINS.split(",").map((origin) => origin.trim()),
    DEVELOPMENT_SEED_ENABLED: value.DEVELOPMENT_SEED_ENABLED === "true",
  }));

export type DatabaseEnv = z.infer<typeof databaseEnvSchema>;
export type ServerEnv = z.infer<typeof serverEnvSchema>;

function formatEnvironmentError(error: z.ZodError) {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "environment"}: ${issue.message}`)
    .join("\n");
}

export function parseDatabaseEnv(input: Record<string, string | undefined>): DatabaseEnv {
  const result = databaseEnvSchema.safeParse(input);
  if (!result.success) {
    throw new Error(
      `Invalid database environment variables:\n${formatEnvironmentError(result.error)}`,
    );
  }
  return result.data;
}

export function parseServerEnv(input: Record<string, string | undefined>): ServerEnv {
  const result = serverEnvSchema.safeParse(input);
  if (!result.success) {
    throw new Error(
      `Invalid server environment variables:\n${formatEnvironmentError(result.error)}`,
    );
  }
  return result.data;
}
