import { beforeEach, describe, expect, it, vi } from "vitest";

import { transitionClaimAction } from "@/modules/claims/actions";
import { deleteEvidenceAction, transitionEvidenceAction } from "@/modules/evidence/actions";
import { deleteExperienceAction } from "@/modules/experiences/actions";
import { deleteProjectAction } from "@/modules/projects/actions";
import { initialActionState } from "@/modules/shared/action-state";
import { DomainError } from "@/modules/shared/errors";

const mocks = vi.hoisted(() => ({
  getRequestContext: vi.fn(),
  transitionEvidenceStatus: vi.fn(),
  deleteEvidenceItem: vi.fn(),
  transitionClaimStatus: vi.fn(),
  deleteExperience: vi.fn(),
  deleteProject: vi.fn(),
  redirect: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/server/request-context", () => ({ getRequestContext: mocks.getRequestContext }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/modules/evidence/use-cases", () => ({
  createEvidenceItem: vi.fn(),
  updateEvidenceItem: vi.fn(),
  transitionEvidenceStatus: mocks.transitionEvidenceStatus,
  deleteEvidenceItem: mocks.deleteEvidenceItem,
}));
vi.mock("@/modules/claims/use-cases", () => ({
  createDraftClaim: vi.fn(),
  updateDraftClaim: vi.fn(),
  transitionClaimStatus: mocks.transitionClaimStatus,
}));
vi.mock("@/modules/experiences/use-cases", () => ({
  createExperience: vi.fn(),
  updateExperience: vi.fn(),
  deleteExperience: mocks.deleteExperience,
}));
vi.mock("@/modules/projects/use-cases", () => ({
  createProject: vi.fn(),
  updateProject: vi.fn(),
  deleteProject: mocks.deleteProject,
}));

function formData(targetStatus?: string) {
  const data = new FormData();
  data.set("id", "owned-record");
  if (targetStatus) data.set("targetStatus", targetStatus);
  return data;
}

describe("mutation action error boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRequestContext.mockResolvedValue({
      userId: "trusted-user",
      identityMode: "development",
    });
  });

  it.each([
    ["evidence.transition", mocks.transitionEvidenceStatus, transitionEvidenceAction, "REJECTED"],
    ["evidence.delete", mocks.deleteEvidenceItem, deleteEvidenceAction, undefined],
    ["claim.transition", mocks.transitionClaimStatus, transitionClaimAction, "ARCHIVED"],
    ["experience.delete", mocks.deleteExperience, deleteExperienceAction, undefined],
    ["project.delete", mocks.deleteProject, deleteProjectAction, undefined],
  ] as const)(
    "redacts unexpected errors from %s",
    async (operation, dependency, action, status) => {
      const logger = vi.spyOn(console, "error").mockImplementation(() => undefined);
      dependency.mockRejectedValueOnce(
        Object.assign(new Error("DATABASE_URL and raw submitted content"), {
          code: "P2002",
          meta: { value: "secret-token" },
        }),
      );

      const result = await action(initialActionState, formData(status));

      expect(result.status).toBe("error");
      expect(result.message).toMatch(/^The request could not be completed safely\. Reference: /);
      expect(JSON.stringify(result)).not.toContain("DATABASE_URL");
      const serializedLog = JSON.stringify(logger.mock.calls);
      expect(serializedLog).toContain(operation);
      expect(serializedLog).not.toContain("DATABASE_URL");
      expect(serializedLog).not.toContain("secret-token");
      expect(mocks.redirect).not.toHaveBeenCalled();
      logger.mockRestore();
    },
  );

  it("returns an understandable domain error from deletion", async () => {
    mocks.deleteEvidenceItem.mockRejectedValueOnce(
      new DomainError("This evidence item has linked claims and cannot be deleted."),
    );

    await expect(deleteEvidenceAction(initialActionState, formData())).resolves.toEqual({
      status: "error",
      message: "This evidence item has linked claims and cannot be deleted.",
    });
  });
});
