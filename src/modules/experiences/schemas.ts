import { z } from "zod";

import {
  optionalDateSchema,
  optionalMultiline,
  optionalSingleLine,
  requiredSingleLine,
  stringListSchema,
} from "@/modules/shared/validation";

export const experienceTypes = [
  "EMPLOYMENT",
  "INTERNSHIP",
  "FREELANCE",
  "VOLUNTEER",
  "STUDENT_LEADERSHIP",
  "ACADEMIC",
  "INDEPENDENT_WORK",
  "OTHER",
] as const;

export const experienceInputSchema = z
  .object({
    title: requiredSingleLine("Title", 200),
    organization: optionalSingleLine(200),
    experienceType: z.enum(experienceTypes),
    location: optionalSingleLine(200),
    workSetup: optionalSingleLine(80),
    startDate: optionalDateSchema,
    endDate: optionalDateSchema,
    currentlyActive: z.boolean(),
    summary: optionalMultiline(5000),
    responsibilities: stringListSchema,
    technologies: stringListSchema,
    skills: stringListSchema,
    outcomes: stringListSchema,
    sourceNotes: optionalMultiline(3000),
  })
  .superRefine((value, context) => {
    if (value.startDate && value.endDate && value.endDate < value.startDate) {
      context.addIssue({
        code: "custom",
        path: ["endDate"],
        message: "End date cannot precede start date",
      });
    }

    if (value.currentlyActive && value.endDate) {
      context.addIssue({
        code: "custom",
        path: ["endDate"],
        message: "A currently active experience cannot have an end date",
      });
    }
  });

export type ExperienceInput = z.infer<typeof experienceInputSchema>;
