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

export const serverEnvSchema = z.object({
  DATABASE_URL: databaseUrlSchema,
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

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
