import { describe, expect, it } from "vitest";

import { hasMaterialProjectChange } from "@/modules/projects/material-change";
import { projectInputSchema } from "@/modules/projects/schemas";

const validProject = {
  name: "Project",
  shortDescription: undefined,
  problemAddressed: undefined,
  candidateRole: undefined,
  responsibilities: [],
  technologies: [],
  skills: [],
  challenges: [],
  actionsTaken: [],
  outcomes: [],
  quantifiedResults: [],
  relevantRoleFamilies: [],
  projectUrl: "https://example.com/project",
  repositoryUrl: "https://github.com/example/project",
  startDate: undefined,
  endDate: undefined,
};

describe("project validation", () => {
  it("accepts safe HTTP URLs", () => {
    expect(projectInputSchema.parse(validProject).projectUrl).toBe("https://example.com/project");
  });

  it("rejects unsafe URL protocols", () => {
    expect(() =>
      projectInputSchema.parse({ ...validProject, projectUrl: "javascript:alert(1)" }),
    ).toThrow();
  });
});

describe("project material changes", () => {
  const input = projectInputSchema.parse({
    ...validProject,
    technologies: ["TypeScript", "PostgreSQL"],
    outcomes: ["Delivered safely"],
    startDate: "2026-01-01",
  });
  const existing = {
    ...input,
    shortDescription: null,
    problemAddressed: null,
    candidateRole: null,
    projectUrl: input.projectUrl ?? null,
    repositoryUrl: input.repositoryUrl ?? null,
    startDate: input.startDate ?? null,
    endDate: null,
  };

  it("treats null and undefined optional values as identical", () => {
    expect(hasMaterialProjectChange(existing, input)).toBe(false);
  });

  it("detects technology, outcome, and date changes", () => {
    expect(hasMaterialProjectChange(existing, { ...input, technologies: ["Go"] })).toBe(true);
    expect(hasMaterialProjectChange(existing, { ...input, outcomes: ["Different outcome"] })).toBe(
      true,
    );
    expect(
      hasMaterialProjectChange(existing, {
        ...input,
        startDate: new Date("2026-02-01T00:00:00.000Z"),
      }),
    ).toBe(true);
  });

  it("treats array ordering as meaningful", () => {
    expect(
      hasMaterialProjectChange(existing, {
        ...input,
        technologies: [...input.technologies].reverse(),
      }),
    ).toBe(true);
  });
});
