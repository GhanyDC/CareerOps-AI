import { z } from "zod";

import { JOB_FIELD_NAMES, jobValuesSchema } from "@/modules/jobs/schemas";

export const correctionPayloadSchema = z
  .object({
    schemaVersion: z.literal(1),
    rawInput: z.record(z.string(), z.union([z.string(), z.array(z.string())])),
    values: jobValuesSchema,
  })
  .strict();

export const draftCorrectionSchema = z
  .object({
    expectedVersion: z.coerce.number().int().positive(),
    correction: correctionPayloadSchema,
  })
  .strict();

export const draftConfirmationSchema = z
  .object({
    expectedVersion: z.coerce.number().int().positive(),
    idempotencyKey: z.uuid(),
    reviewed: z.literal(true),
    selectedFields: z.array(z.enum(JOB_FIELD_NAMES)).max(JOB_FIELD_NAMES.length),
  })
  .strict();

export const draftTransitionSchema = z
  .object({ expectedVersion: z.coerce.number().int().positive() })
  .strict();

export type CorrectionPayload = z.infer<typeof correctionPayloadSchema>;
