import { z } from "zod";

function normalizeSingleLine(value: unknown) {
  if (typeof value !== "string") return value;

  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeMultiline(value: unknown) {
  if (typeof value !== "string") return value;

  const normalized = value.replace(/\r\n/g, "\n").trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function requiredSingleLine(label: string, maxLength: number) {
  return z.preprocess(
    normalizeSingleLine,
    z
      .string({ error: `${label} is required` })
      .min(1, `${label} is required`)
      .max(maxLength),
  );
}

export function optionalSingleLine(maxLength: number) {
  return z.preprocess(normalizeSingleLine, z.string().max(maxLength).optional());
}

export function optionalMultiline(maxLength: number) {
  return z.preprocess(normalizeMultiline, z.string().max(maxLength).optional());
}

export function requiredClaim(label = "Claim") {
  return z.preprocess(
    normalizeMultiline,
    z
      .string({ error: `${label} is required` })
      .min(1, `${label} is required`)
      .max(1000),
  );
}

export const optionalDateSchema = z.preprocess(
  (value) => (value === "" || value === null ? undefined : value),
  z.coerce.date().optional(),
);

export const optionalHttpUrlSchema = z.preprocess(
  normalizeSingleLine,
  z
    .url()
    .max(2048)
    .refine((value) => ["http:", "https:"].includes(new URL(value).protocol), {
      message: "URL must use http:// or https://",
    })
    .optional(),
);

export const stringListSchema = z.array(z.string().trim().min(1).max(160)).max(50);

export function readList(formData: FormData, name: string) {
  const value = formData.get(name);
  if (typeof value !== "string") return [];

  return [...new Set(value.split(/[\n,]/).map((item) => item.trim().replace(/\s+/g, " ")))].filter(
    Boolean,
  );
}

export function readString(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value : undefined;
}

export function readCheckbox(formData: FormData, name: string) {
  return formData.get(name) === "on";
}
