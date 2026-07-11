import { z } from "zod";

import {
  optionalDateSchema,
  optionalHttpUrlSchema,
  optionalMultiline,
  optionalSingleLine,
  requiredSingleLine,
  stringListSchema,
} from "@/modules/shared/validation";

export const projectInputSchema = z
  .object({
    name: requiredSingleLine("Project name", 200),
    shortDescription: optionalSingleLine(500),
    problemAddressed: optionalMultiline(5000),
    candidateRole: optionalSingleLine(200),
    responsibilities: stringListSchema,
    technologies: stringListSchema,
    skills: stringListSchema,
    challenges: stringListSchema,
    actionsTaken: stringListSchema,
    outcomes: stringListSchema,
    quantifiedResults: stringListSchema,
    relevantRoleFamilies: stringListSchema,
    projectUrl: optionalHttpUrlSchema,
    repositoryUrl: optionalHttpUrlSchema,
    startDate: optionalDateSchema,
    endDate: optionalDateSchema,
  })
  .superRefine((value, context) => {
    if (value.startDate && value.endDate && value.endDate < value.startDate) {
      context.addIssue({
        code: "custom",
        path: ["endDate"],
        message: "End date cannot precede start date",
      });
    }
  });

export type ProjectInput = z.infer<typeof projectInputSchema>;
