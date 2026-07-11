import { describe, expect, it } from "vitest";

import { hasMaterialExperienceChange } from "@/modules/experiences/material-change";
import { experienceInputSchema } from "@/modules/experiences/schemas";

const validExperience = {
  title: "Intern",
  organization: "Example",
  experienceType: "INTERNSHIP",
  location: undefined,
  workSetup: undefined,
  startDate: "2026-01-01",
  endDate: "2026-02-01",
  currentlyActive: false,
  summary: undefined,
  responsibilities: [],
  technologies: [],
  skills: [],
  outcomes: [],
  sourceNotes: undefined,
};

describe("experience validation", () => {
  it("rejects an end date before the start date", () => {
    expect(() =>
      experienceInputSchema.parse({ ...validExperience, endDate: "2025-12-31" }),
    ).toThrow(/End date/);
  });

  it("rejects an end date for a currently active experience", () => {
    expect(() =>
      experienceInputSchema.parse({ ...validExperience, currentlyActive: true }),
    ).toThrow(/currently active/);
  });
});

describe("experience material changes", () => {
  const input = experienceInputSchema.parse({
    ...validExperience,
    organization: undefined,
    responsibilities: ["First", "Second"],
    outcomes: ["Outcome"],
  });
  const existing = {
    ...input,
    organization: null,
    location: null,
    workSetup: null,
    summary: null,
    startDate: input.startDate ?? null,
    endDate: input.endDate ?? null,
  };

  it("treats null and undefined optional values as identical", () => {
    expect(hasMaterialExperienceChange(existing, input)).toBe(false);
  });

  it("allows a source-notes-only edit", () => {
    expect(hasMaterialExperienceChange(existing, { ...input, sourceNotes: "Reviewer note" })).toBe(
      false,
    );
  });

  it("detects responsibility, outcome, and date changes", () => {
    expect(
      hasMaterialExperienceChange(existing, {
        ...input,
        responsibilities: ["Changed responsibility"],
      }),
    ).toBe(true);
    expect(hasMaterialExperienceChange(existing, { ...input, outcomes: ["Changed outcome"] })).toBe(
      true,
    );
    expect(
      hasMaterialExperienceChange(existing, {
        ...input,
        startDate: new Date("2025-12-31T00:00:00.000Z"),
      }),
    ).toBe(true);
  });

  it("treats array ordering as meaningful", () => {
    expect(
      hasMaterialExperienceChange(existing, {
        ...input,
        responsibilities: [...input.responsibilities].reverse(),
      }),
    ).toBe(true);
  });
});
