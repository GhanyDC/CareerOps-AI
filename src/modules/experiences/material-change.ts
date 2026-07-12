import type { Experience } from "@/generated/prisma/client";
import {
  sameOptionalDate,
  sameOptionalValue,
  sameOrderedValues,
} from "@/modules/shared/comparison";

import type { ExperienceInput } from "./schemas";

type ExperienceMaterialRecord = Pick<
  Experience,
  | "title"
  | "organization"
  | "experienceType"
  | "location"
  | "workSetup"
  | "startDate"
  | "endDate"
  | "currentlyActive"
  | "summary"
  | "responsibilities"
  | "technologies"
  | "skills"
  | "outcomes"
>;

export function hasMaterialExperienceChange(
  existing: ExperienceMaterialRecord,
  input: ExperienceInput,
) {
  return !(
    existing.title === input.title &&
    sameOptionalValue(existing.organization, input.organization) &&
    existing.experienceType === input.experienceType &&
    sameOptionalValue(existing.location, input.location) &&
    sameOptionalValue(existing.workSetup, input.workSetup) &&
    sameOptionalDate(existing.startDate, input.startDate) &&
    sameOptionalDate(existing.endDate, input.endDate) &&
    existing.currentlyActive === input.currentlyActive &&
    sameOptionalValue(existing.summary, input.summary) &&
    sameOrderedValues(existing.responsibilities, input.responsibilities) &&
    sameOrderedValues(existing.technologies, input.technologies) &&
    sameOrderedValues(existing.skills, input.skills) &&
    sameOrderedValues(existing.outcomes, input.outcomes)
  );
}
