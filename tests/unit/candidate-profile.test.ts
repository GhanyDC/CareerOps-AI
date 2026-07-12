import { describe, expect, it } from "vitest";

import { candidateProfileInputSchema } from "@/modules/candidate-profile/schemas";

const validProfile = {
  fullName: "  Ghanymede   Dela Cruz  ",
  professionalHeadline: "Software Engineer",
  careerSummary: "Evidence-grounded developer",
  preferredRoleFamilies: ["Backend Developer"],
  preferredLocations: ["NCR"],
  acceptedWorkArrangements: ["Hybrid"],
  acceptedEmploymentTypes: [],
  schedulePreferences: [],
  nightShiftAcceptance: null,
  relocationPreference: undefined,
  salaryCurrency: "php",
  salaryMinimum: "50000",
  salaryNotes: undefined,
  careerGoals: undefined,
  dostReturnServiceNotes: undefined,
  applicationPreferences: undefined,
  hardExclusions: [],
};

describe("candidate profile validation", () => {
  it("normalizes optional candidate facts", () => {
    const parsed = candidateProfileInputSchema.parse(validProfile);
    expect(parsed.fullName).toBe("Ghanymede Dela Cruz");
    expect(parsed.salaryCurrency).toBe("PHP");
    expect(parsed.salaryMinimum).toBe(50000);
  });

  it("enforces input length limits", () => {
    expect(() =>
      candidateProfileInputSchema.parse({ ...validProfile, careerSummary: "x".repeat(5001) }),
    ).toThrow();
  });
});
