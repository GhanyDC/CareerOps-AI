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
        context.addIssue({
          code: "custom",
          message: "DATABASE_URL must include a hostname",
        });
      }
    } catch {
      context.addIssue({
        code: "custom",
        message: "DATABASE_URL must be a valid PostgreSQL connection URL",
      });
    }
  });

export const serverEnvSchema = z
  .object({
    DATABASE_URL: databaseUrlSchema,
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DEVELOPMENT_IDENTITY_ENABLED: z.enum(["true", "false"]).default("false"),
    DEVELOPMENT_USER_KEY: z
      .string()
      .trim()
      .min(1, "DEVELOPMENT_USER_KEY cannot be empty")
      .max(100)
      .optional(),
  })
  .superRefine((value, context) => {
    if (value.DEVELOPMENT_IDENTITY_ENABLED === "true" && !value.DEVELOPMENT_USER_KEY) {
      context.addIssue({
        code: "custom",
        path: ["DEVELOPMENT_USER_KEY"],
        message: "DEVELOPMENT_USER_KEY is required when development identity is enabled",
      });
    }

    if (value.NODE_ENV === "production" && value.DEVELOPMENT_IDENTITY_ENABLED === "true") {
      context.addIssue({
        code: "custom",
        path: ["DEVELOPMENT_IDENTITY_ENABLED"],
        message: "Development identity cannot be enabled in production",
      });
    }
  })
  .transform((value) => ({
    ...value,
    DEVELOPMENT_IDENTITY_ENABLED: value.DEVELOPMENT_IDENTITY_ENABLED === "true",
  }));

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function parseServerEnv(input: Record<string, string | undefined>): ServerEnv {
  const result = serverEnvSchema.safeParse(input);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join(".") || "environment"}: ${issue.message}`)
      .join("\n");

    throw new Error(`Invalid server environment variables:\n${details}`);
  }

  return result.data;
}
