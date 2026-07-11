import { z } from "zod";

import {
  optionalMultiline,
  optionalSingleLine,
  stringListSchema,
} from "@/modules/shared/validation";

const optionalSalary = z.preprocess(
  (value) => (value === "" || value === null ? undefined : value),
  z.coerce.number().nonnegative().max(999_999_999).optional(),
);

const optionalNightShift = z.preprocess(
  (value) => (value === "" || value === undefined ? null : value),
  z.boolean().nullable(),
);

export const candidateProfileInputSchema = z.object({
  fullName: optionalSingleLine(160),
  professionalHeadline: optionalSingleLine(240),
  careerSummary: optionalMultiline(5000),
  preferredRoleFamilies: stringListSchema,
  preferredLocations: stringListSchema,
  acceptedWorkArrangements: stringListSchema,
  acceptedEmploymentTypes: stringListSchema,
  schedulePreferences: stringListSchema,
  nightShiftAcceptance: optionalNightShift,
  relocationPreference: optionalSingleLine(160),
  salaryCurrency: z.preprocess(
    (value) => (typeof value === "string" ? value.trim().toUpperCase() || undefined : value),
    z.string().length(3).optional(),
  ),
  salaryMinimum: optionalSalary,
  salaryNotes: optionalMultiline(2000),
  careerGoals: optionalMultiline(5000),
  dostReturnServiceNotes: optionalMultiline(3000),
  applicationPreferences: optionalMultiline(3000),
  hardExclusions: stringListSchema,
});

export type CandidateProfileInput = z.infer<typeof candidateProfileInputSchema>;
