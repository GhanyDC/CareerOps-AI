import type { Project } from "@/generated/prisma/client";
import {
  sameOptionalDate,
  sameOptionalValue,
  sameOrderedValues,
} from "@/modules/shared/comparison";

import type { ProjectInput } from "./schemas";

type ProjectMaterialRecord = Pick<
  Project,
  | "name"
  | "shortDescription"
  | "problemAddressed"
  | "candidateRole"
  | "responsibilities"
  | "technologies"
  | "skills"
  | "challenges"
  | "actionsTaken"
  | "outcomes"
  | "quantifiedResults"
  | "relevantRoleFamilies"
  | "projectUrl"
  | "repositoryUrl"
  | "startDate"
  | "endDate"
>;

export function hasMaterialProjectChange(existing: ProjectMaterialRecord, input: ProjectInput) {
  return !(
    existing.name === input.name &&
    sameOptionalValue(existing.shortDescription, input.shortDescription) &&
    sameOptionalValue(existing.problemAddressed, input.problemAddressed) &&
    sameOptionalValue(existing.candidateRole, input.candidateRole) &&
    sameOrderedValues(existing.responsibilities, input.responsibilities) &&
    sameOrderedValues(existing.technologies, input.technologies) &&
    sameOrderedValues(existing.skills, input.skills) &&
    sameOrderedValues(existing.challenges, input.challenges) &&
    sameOrderedValues(existing.actionsTaken, input.actionsTaken) &&
    sameOrderedValues(existing.outcomes, input.outcomes) &&
    sameOrderedValues(existing.quantifiedResults, input.quantifiedResults) &&
    sameOrderedValues(existing.relevantRoleFamilies, input.relevantRoleFamilies) &&
    sameOptionalValue(existing.projectUrl, input.projectUrl) &&
    sameOptionalValue(existing.repositoryUrl, input.repositoryUrl) &&
    sameOptionalDate(existing.startDate, input.startDate) &&
    sameOptionalDate(existing.endDate, input.endDate)
  );
}
