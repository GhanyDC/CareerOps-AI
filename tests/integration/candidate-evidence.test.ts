import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { listAuditHistory, recordAudit } from "@/modules/audit/public.server";
import {
  updateCandidateProfile,
  viewCandidateProfile,
} from "@/modules/candidate-profile/use-cases";
import {
  createDraftClaim,
  transitionClaimStatus,
  updateDraftClaim,
  viewClaim,
} from "@/modules/claims/use-cases";
import {
  createEvidenceItem,
  deleteEvidenceItem,
  transitionEvidenceStatus,
  updateEvidenceItem,
  viewEvidenceItem,
} from "@/modules/evidence/use-cases";
import {
  createExperience,
  deleteExperience,
  updateExperience,
  viewExperience,
} from "@/modules/experiences/use-cases";
import {
  createProject,
  deleteProject,
  updateProject,
  viewProject,
} from "@/modules/projects/use-cases";
import { PrismaClient } from "@/generated/prisma/client";
import { parseDatabaseEnv } from "@/config/env.schema";
import { seedDevelopmentData } from "@/server/db/seed-data";

const profileInput = {
  fullName: "Integration Candidate",
  professionalHeadline: undefined,
  careerSummary: undefined,
  preferredRoleFamilies: ["Backend Developer"],
  preferredLocations: [],
  acceptedWorkArrangements: [],
  acceptedEmploymentTypes: [],
  schedulePreferences: [],
  nightShiftAcceptance: null,
  relocationPreference: undefined,
  salaryCurrency: undefined,
  salaryMinimum: undefined,
  salaryNotes: undefined,
  careerGoals: undefined,
  dostReturnServiceNotes: undefined,
  applicationPreferences: undefined,
  hardExclusions: [],
};

const experienceInput = {
  title: "Integration experience",
  organization: "CareerOps Tests",
  experienceType: "EMPLOYMENT",
  location: undefined,
  workSetup: "Remote",
  startDate: "2026-01-01",
  endDate: undefined,
  currentlyActive: true,
  summary: undefined,
  responsibilities: ["Build safely"],
  technologies: ["TypeScript"],
  skills: ["Testing"],
  outcomes: [],
  sourceNotes: undefined,
};

const projectInput = {
  name: "Integration project",
  shortDescription: "An isolated test project",
  problemAddressed: undefined,
  candidateRole: "Developer",
  responsibilities: [],
  technologies: ["PostgreSQL"],
  skills: ["Integration testing"],
  challenges: [],
  actionsTaken: [],
  outcomes: [],
  quantifiedResults: [],
  relevantRoleFamilies: ["Backend Developer"],
  projectUrl: "https://example.com/integration-project",
  repositoryUrl: undefined,
  startDate: undefined,
  endDate: undefined,
};

const evidenceInput = (source: { experienceId?: string; projectId?: string }) => ({
  sourceType: source.experienceId ? "EXPERIENCE" : "PROJECT",
  sourceExperienceId: source.experienceId,
  sourceProjectId: source.projectId,
  claim: source.experienceId
    ? "Created evidence from an owned experience."
    : "Created evidence from an owned project.",
  supportingContext: undefined,
  skillsDemonstrated: ["Testing"],
  relevantRoleFamilies: ["Backend Developer"],
  evidenceStrength: "DIRECT",
  allowedForResume: true,
  allowedForCoverLetters: false,
  allowedForInterviews: true,
  allowedForRecruiterMessages: false,
  sourceNotes: undefined,
});

const claimInput = (evidenceItemId: string, claimText: string) => ({
  evidenceItemId,
  claimText,
  reviewerNotes: "Integration review",
  allowedForResume: true,
  allowedForCoverLetters: false,
  allowedForInterviews: true,
  allowedForRecruiterMessages: false,
});

describe("candidate evidence vertical slice", () => {
  const token = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const userAKey = `integration-a-${token}`;
  const userBKey = `integration-b-${token}`;
  const seedKey = `integration-seed-${token}`;
  const failureKey = `integration-failure-${token}`;
  const env = parseDatabaseEnv(process.env);
  const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });
  const client = new PrismaClient({ adapter });
  let userAId: string;
  let userBId: string;
  let experienceAId: string;
  let experienceBId: string;
  let projectAId: string;
  let projectBId: string;
  let evidenceBId: string;
  let experienceEvidenceId: string;
  let projectEvidenceId: string;
  let approvedClaimId: string;
  let prohibitedClaimId: string;

  beforeAll(async () => {
    const [userA, userB] = await Promise.all([
      client.user.create({ data: { developmentKey: userAKey } }),
      client.user.create({ data: { developmentKey: userBKey } }),
    ]);
    userAId = userA.id;
    userBId = userB.id;
    await updateCandidateProfile(userBId, { ...profileInput, fullName: "Other Candidate" });
    const experienceB = await createExperience(userBId, {
      ...experienceInput,
      title: "Other user's experience",
    });
    experienceBId = experienceB.id;
    const projectB = await createProject(userBId, {
      ...projectInput,
      name: "Other user's project",
    });
    projectBId = projectB.id;
    const evidenceB = await createEvidenceItem(
      userBId,
      evidenceInput({ experienceId: experienceBId }),
    );
    evidenceBId = evidenceB.id;
  });

  afterAll(async () => {
    const users = await client.user.findMany({
      where: { developmentKey: { in: [userAKey, userBKey, seedKey, failureKey] } },
      select: { id: true },
    });
    const userIds = users.map((user) => user.id);
    await client.auditLog.deleteMany({ where: { userId: { in: userIds } } });
    await client.claim.deleteMany({ where: { userId: { in: userIds } } });
    await client.evidenceItem.deleteMany({ where: { userId: { in: userIds } } });
    await client.experience.deleteMany({ where: { userId: { in: userIds } } });
    await client.project.deleteMany({ where: { userId: { in: userIds } } });
    await client.candidateProfile.deleteMany({ where: { userId: { in: userIds } } });
    await client.user.deleteMany({ where: { id: { in: userIds } } });
    await client.$disconnect();
  });

  it("creates and reads one candidate profile", async () => {
    await updateCandidateProfile(userAId, profileInput);
    const profile = await viewCandidateProfile(userAId);
    expect(profile?.fullName).toBe("Integration Candidate");
    expect(profile?.userId).toBe(userAId);
  });

  it("enforces one profile per user", async () => {
    await expect(client.candidateProfile.create({ data: { userId: userAId } })).rejects.toThrow();
  });

  it("creates an owned experience", async () => {
    const experience = await createExperience(userAId, experienceInput);
    experienceAId = experience.id;
    expect(experience.userId).toBe(userAId);
  });

  it("creates an owned project", async () => {
    const project = await createProject(userAId, projectInput);
    projectAId = project.id;
    expect(project.userId).toBe(userAId);
  });

  it("creates evidence from an owned experience", async () => {
    const evidence = await createEvidenceItem(
      userAId,
      evidenceInput({ experienceId: experienceAId }),
    );
    experienceEvidenceId = evidence.id;
    expect(evidence.sourceExperienceId).toBe(experienceAId);
  });

  it("creates evidence from an owned project", async () => {
    const evidence = await createEvidenceItem(userAId, evidenceInput({ projectId: projectAId }));
    projectEvidenceId = evidence.id;
    expect(evidence.sourceProjectId).toBe(projectAId);
  });

  it("rejects cross-user evidence linkage", async () => {
    await expect(
      createEvidenceItem(userAId, evidenceInput({ experienceId: experienceBId })),
    ).rejects.toThrow(/source is unavailable/);
    await expect(
      createEvidenceItem(userAId, evidenceInput({ projectId: projectBId })),
    ).rejects.toThrow(/source is unavailable/);
  });

  it("approves a claim only when linked evidence is verified", async () => {
    await transitionEvidenceStatus(userAId, experienceEvidenceId, { targetStatus: "VERIFIED" });
    const claim = await createDraftClaim(
      userAId,
      claimInput(experienceEvidenceId, "Approved integration claim."),
    );
    approvedClaimId = claim.id;
    const approved = await transitionClaimStatus(userAId, claim.id, { targetStatus: "APPROVED" });
    expect(approved.status).toBe("APPROVED");
    expect(approved.approvedAt).toBeInstanceOf(Date);
  });

  it("rejects edits to verified evidence and preserves its authoritative state", async () => {
    const before = await client.evidenceItem.findUniqueOrThrow({
      where: { id: experienceEvidenceId },
    });

    await expect(
      updateEvidenceItem(userAId, experienceEvidenceId, {
        ...evidenceInput({ experienceId: experienceAId }),
        claim: "Unauthorized material rewrite.",
      }),
    ).rejects.toThrow(/Verified evidence is locked/);

    const after = await client.evidenceItem.findUniqueOrThrow({
      where: { id: experienceEvidenceId },
    });
    expect(after.claim).toBe(before.claim);
    expect(after.verificationStatus).toBe("VERIFIED");
  });

  it("blocks material experience edits while allowing unchanged and source-notes-only updates", async () => {
    await expect(updateExperience(userAId, experienceAId, experienceInput)).resolves.toMatchObject({
      id: experienceAId,
    });
    await expect(
      updateExperience(userAId, experienceAId, {
        ...experienceInput,
        sourceNotes: "Non-material reviewer provenance note.",
      }),
    ).resolves.toMatchObject({ sourceNotes: "Non-material reviewer provenance note." });
    await expect(
      updateExperience(userAId, experienceAId, {
        ...experienceInput,
        title: "Materially changed title",
      }),
    ).rejects.toThrow(/supports verified evidence/);
    expect(
      await client.experience.findUniqueOrThrow({ where: { id: experienceAId } }),
    ).toMatchObject({ title: experienceInput.title });
  });

  it("blocks material project edits without rejecting an unchanged submission", async () => {
    await transitionEvidenceStatus(userAId, projectEvidenceId, { targetStatus: "VERIFIED" });
    await expect(updateProject(userAId, projectAId, projectInput)).resolves.toMatchObject({
      id: projectAId,
    });
    await expect(
      updateProject(userAId, projectAId, {
        ...projectInput,
        technologies: ["Materially different technology"],
      }),
    ).rejects.toThrow(/supports verified evidence/);
    expect(await client.project.findUniqueOrThrow({ where: { id: projectAId } })).toMatchObject({
      technologies: projectInput.technologies,
    });
  });

  it("transactionally revokes linked approval when verified evidence requires verification", async () => {
    const unrelated = await createDraftClaim(
      userAId,
      claimInput(projectEvidenceId, "Unrelated approved claim."),
    );
    await transitionClaimStatus(userAId, unrelated.id, { targetStatus: "APPROVED" });

    await transitionEvidenceStatus(userAId, experienceEvidenceId, {
      targetStatus: "REQUIRES_VERIFICATION",
    });

    const [evidence, claim, unrelatedAfter] = await Promise.all([
      client.evidenceItem.findUniqueOrThrow({ where: { id: experienceEvidenceId } }),
      client.claim.findUniqueOrThrow({ where: { id: approvedClaimId } }),
      client.claim.findUniqueOrThrow({ where: { id: unrelated.id } }),
    ]);
    expect(evidence.verificationStatus).toBe("REQUIRES_VERIFICATION");
    expect(claim).toMatchObject({ status: "REQUIRES_VERIFICATION", approvedAt: null });
    expect(unrelatedAfter.status).toBe("APPROVED");

    const evidenceAudit = await client.auditLog.findFirstOrThrow({
      where: { entityId: experienceEvidenceId, action: "EVIDENCE_VERIFICATION_REVOKED" },
      orderBy: { createdAt: "desc" },
    });
    expect(evidenceAudit).toMatchObject({
      userId: userAId,
      entityType: "EVIDENCE",
      previousState: { verificationStatus: "VERIFIED" },
      newState: { verificationStatus: "REQUIRES_VERIFICATION" },
    });
    const claimAudit = await client.auditLog.findFirstOrThrow({
      where: { entityId: approvedClaimId, action: "CLAIM_APPROVAL_REVOKED" },
      orderBy: { createdAt: "desc" },
    });
    expect(claimAudit).toMatchObject({
      userId: userAId,
      entityType: "CLAIM",
      previousState: { status: "APPROVED" },
      newState: { status: "REQUIRES_VERIFICATION", approvedAt: null },
    });
    expect(JSON.stringify(claimAudit)).not.toContain("Approved integration claim");
  });

  it("transactionally invalidates approval when verified evidence is rejected", async () => {
    const evidence = await createEvidenceItem(userAId, {
      ...evidenceInput({ experienceId: experienceAId }),
      claim: "Evidence dedicated to rejection testing.",
    });
    await transitionEvidenceStatus(userAId, evidence.id, { targetStatus: "VERIFIED" });
    const claim = await createDraftClaim(
      userAId,
      claimInput(evidence.id, "Approved claim dedicated to rejection testing."),
    );
    await transitionClaimStatus(userAId, claim.id, { targetStatus: "APPROVED" });

    await transitionEvidenceStatus(userAId, evidence.id, { targetStatus: "REJECTED" });

    expect(
      await client.evidenceItem.findUniqueOrThrow({ where: { id: evidence.id } }),
    ).toMatchObject({ verificationStatus: "REJECTED" });
    expect(await client.claim.findUniqueOrThrow({ where: { id: claim.id } })).toMatchObject({
      status: "REQUIRES_VERIFICATION",
      approvedAt: null,
    });
    expect(
      await client.auditLog.findFirst({
        where: { entityId: evidence.id, action: "EVIDENCE_REJECTED" },
      }),
    ).toMatchObject({
      previousState: { verificationStatus: "VERIFIED" },
      newState: { verificationStatus: "REJECTED" },
    });
    expect(
      await client.auditLog.findFirst({
        where: { entityId: claim.id, action: "CLAIM_APPROVAL_REVOKED" },
      }),
    ).toMatchObject({
      previousState: { status: "APPROVED" },
      newState: { status: "REQUIRES_VERIFICATION", approvedAt: null },
    });
  });

  it("records truthful audit data for every allowed evidence transition", async () => {
    const transitions = [
      ["DRAFT", "REQUIRES_VERIFICATION", "EVIDENCE_REQUIRES_VERIFICATION"],
      ["DRAFT", "VERIFIED", "EVIDENCE_VERIFIED"],
      ["DRAFT", "REJECTED", "EVIDENCE_REJECTED"],
      ["REQUIRES_VERIFICATION", "DRAFT", "EVIDENCE_RETURNED_TO_DRAFT"],
      ["REQUIRES_VERIFICATION", "VERIFIED", "EVIDENCE_VERIFIED"],
      ["REQUIRES_VERIFICATION", "REJECTED", "EVIDENCE_REJECTED"],
      ["VERIFIED", "REQUIRES_VERIFICATION", "EVIDENCE_VERIFICATION_REVOKED"],
      ["VERIFIED", "REJECTED", "EVIDENCE_REJECTED"],
      ["REJECTED", "DRAFT", "EVIDENCE_RETURNED_TO_DRAFT"],
      ["REJECTED", "REQUIRES_VERIFICATION", "EVIDENCE_REQUIRES_VERIFICATION"],
    ] as const;

    for (const [from, to, action] of transitions) {
      const rawClaim = `Audit edge ${from} to ${to} must not enter audit JSON.`;
      const evidence = await createEvidenceItem(userAId, {
        ...evidenceInput({ projectId: projectAId }),
        claim: rawClaim,
      });
      if (from !== "DRAFT") {
        await client.evidenceItem.update({
          where: { id: evidence.id },
          data: { verificationStatus: from },
        });
      }

      await transitionEvidenceStatus(userAId, evidence.id, { targetStatus: to });

      const audit = await client.auditLog.findFirstOrThrow({
        where: { userId: userAId, entityId: evidence.id, action },
        orderBy: { createdAt: "desc" },
      });
      expect(audit).toMatchObject({
        entityType: "EVIDENCE",
        entityId: evidence.id,
        previousState: { verificationStatus: from },
        newState: { verificationStatus: to },
      });
      expect(JSON.stringify(audit.previousState)).not.toContain(rawClaim);
      expect(JSON.stringify(audit.newState)).not.toContain(rawClaim);
    }
  });

  it("records truthful audit data for every allowed claim transition", async () => {
    const transitions = [
      ["DRAFT", "REQUIRES_VERIFICATION", "CLAIM_REQUIRES_VERIFICATION"],
      ["DRAFT", "APPROVED", "CLAIM_APPROVED"],
      ["DRAFT", "PROHIBITED", "CLAIM_PROHIBITED"],
      ["DRAFT", "ARCHIVED", "CLAIM_ARCHIVED"],
      ["REQUIRES_VERIFICATION", "DRAFT", "CLAIM_RETURNED_TO_DRAFT"],
      ["REQUIRES_VERIFICATION", "APPROVED", "CLAIM_APPROVED"],
      ["REQUIRES_VERIFICATION", "PROHIBITED", "CLAIM_PROHIBITED"],
      ["REQUIRES_VERIFICATION", "ARCHIVED", "CLAIM_ARCHIVED"],
      ["APPROVED", "REQUIRES_VERIFICATION", "CLAIM_REQUIRES_VERIFICATION"],
      ["APPROVED", "PROHIBITED", "CLAIM_PROHIBITED"],
      ["APPROVED", "ARCHIVED", "CLAIM_ARCHIVED"],
      ["PROHIBITED", "ARCHIVED", "CLAIM_ARCHIVED"],
    ] as const;

    for (const [from, to, action] of transitions) {
      const rawClaim = `Claim audit edge ${from} to ${to} must remain outside audit JSON.`;
      const claim = await client.claim.create({
        data: {
          userId: userAId,
          evidenceItemId: projectEvidenceId,
          claimText: rawClaim,
          status: from,
          approvedAt: from === "APPROVED" ? new Date() : null,
        },
      });

      await transitionClaimStatus(userAId, claim.id, { targetStatus: to });

      const audit = await client.auditLog.findFirstOrThrow({
        where: { userId: userAId, entityId: claim.id, action },
        orderBy: { createdAt: "desc" },
      });
      expect(audit).toMatchObject({
        entityType: "CLAIM",
        entityId: claim.id,
        previousState: { status: from },
        newState: { status: to },
      });
      expect(JSON.stringify(audit.previousState)).not.toContain(rawClaim);
      expect(JSON.stringify(audit.newState)).not.toContain(rawClaim);
      if (from === "APPROVED") {
        expect(
          await client.auditLog.findFirst({
            where: { userId: userAId, entityId: claim.id, action: "CLAIM_APPROVAL_REVOKED" },
          }),
        ).not.toBeNull();
      }
    }
  });

  it("rolls back evidence, claims, and audits when downstream invalidation fails", async () => {
    const evidence = await createEvidenceItem(userAId, {
      ...evidenceInput({ experienceId: experienceAId }),
      claim: "Rollback evidence.",
    });
    await transitionEvidenceStatus(userAId, evidence.id, { targetStatus: "VERIFIED" });
    const claim = await createDraftClaim(userAId, claimInput(evidence.id, "Rollback claim."));
    const approved = await transitionClaimStatus(userAId, claim.id, { targetStatus: "APPROVED" });
    const auditCount = await client.auditLog.count({
      where: { userId: userAId, entityId: { in: [evidence.id, claim.id] } },
    });

    await expect(
      transitionEvidenceStatus(
        userAId,
        evidence.id,
        { targetStatus: "REQUIRES_VERIFICATION" },
        {
          recordAudit: async (tx, input) => {
            if (input.action === "CLAIM_APPROVAL_REVOKED") {
              throw new Error("Controlled audit failure");
            }
            return recordAudit(tx, input);
          },
        },
      ),
    ).rejects.toThrow(/Controlled audit failure/);

    expect(
      await client.evidenceItem.findUniqueOrThrow({ where: { id: evidence.id } }),
    ).toMatchObject({ verificationStatus: "VERIFIED" });
    expect(await client.claim.findUniqueOrThrow({ where: { id: claim.id } })).toMatchObject({
      status: "APPROVED",
      approvedAt: approved.approvedAt,
    });
    expect(
      await client.auditLog.count({
        where: { userId: userAId, entityId: { in: [evidence.id, claim.id] } },
      }),
    ).toBe(auditCount);
  });

  it("never commits an approved claim linked to concurrently unverified evidence", async () => {
    const evidence = await createEvidenceItem(userAId, {
      ...evidenceInput({ projectId: projectAId }),
      claim: "Concurrency evidence.",
    });
    await transitionEvidenceStatus(userAId, evidence.id, { targetStatus: "VERIFIED" });
    const claim = await createDraftClaim(userAId, claimInput(evidence.id, "Concurrency claim."));

    await Promise.allSettled([
      transitionEvidenceStatus(userAId, evidence.id, {
        targetStatus: "REQUIRES_VERIFICATION",
      }),
      transitionClaimStatus(userAId, claim.id, { targetStatus: "APPROVED" }),
    ]);

    const [finalEvidence, finalClaim] = await Promise.all([
      client.evidenceItem.findUniqueOrThrow({ where: { id: evidence.id } }),
      client.claim.findUniqueOrThrow({ where: { id: claim.id } }),
    ]);
    expect(
      finalEvidence.verificationStatus !== "VERIFIED" && finalClaim.status === "APPROVED",
    ).toBe(false);
  });

  it("rejects approval when linked evidence is unverified", async () => {
    const unverifiedEvidence = await createEvidenceItem(userAId, {
      ...evidenceInput({ projectId: projectAId }),
      claim: "Unverified evidence dedicated to approval rejection.",
    });
    const claim = await createDraftClaim(
      userAId,
      claimInput(unverifiedEvidence.id, "Unverified integration claim."),
    );
    await expect(
      transitionClaimStatus(userAId, claim.id, { targetStatus: "APPROVED" }),
    ).rejects.toThrow(/verified evidence/);
  });

  it("prohibits a claim while preserving it", async () => {
    const claim = await createDraftClaim(
      userAId,
      claimInput(experienceEvidenceId, "Claim that should be prohibited."),
    );
    prohibitedClaimId = claim.id;
    const prohibited = await transitionClaimStatus(userAId, claim.id, {
      targetStatus: "PROHIBITED",
    });
    expect(prohibited.status).toBe("PROHIBITED");
    expect(await client.claim.findUnique({ where: { id: claim.id } })).not.toBeNull();
  });

  it("records evidence and claim audit history", async () => {
    const audit = await client.auditLog.findMany({
      where: {
        userId: userAId,
        OR: [
          { entityId: experienceEvidenceId, action: "EVIDENCE_VERIFIED" },
          { entityId: approvedClaimId, action: "CLAIM_APPROVED" },
          { entityId: prohibitedClaimId, action: "CLAIM_PROHIBITED" },
        ],
      },
    });
    expect(audit).toHaveLength(3);
  });

  it("keeps candidate-profile reads and updates bound to the trusted user", async () => {
    const beforeA = await viewCandidateProfile(userAId);
    expect(await viewCandidateProfile(userBId)).toMatchObject({ userId: userBId });
    await updateCandidateProfile(userBId, {
      ...profileInput,
      userId: userAId,
      fullName: "Updated only for user B",
    });
    expect(await viewCandidateProfile(userAId)).toMatchObject({
      userId: userAId,
      fullName: beforeA?.fullName,
    });
    expect(await viewCandidateProfile(userBId)).toMatchObject({
      userId: userBId,
      fullName: "Updated only for user B",
    });
  });

  it("prevents cross-user reads without revealing record availability", async () => {
    await expect(viewExperience(userBId, experienceAId)).rejects.toThrow(/not found/);
    await expect(viewProject(userBId, projectAId)).rejects.toThrow(/not found/);
    await expect(viewEvidenceItem(userBId, experienceEvidenceId)).rejects.toThrow(/not found/);
    await expect(viewClaim(userBId, approvedClaimId)).rejects.toThrow(/not found/);
    expect(await listAuditHistory(userBId, "EVIDENCE", experienceEvidenceId)).toEqual([]);
  });

  it("prevents cross-user source updates and deletes, including dependency checks", async () => {
    await expect(
      updateExperience(userBId, experienceAId, { ...experienceInput, title: "Unauthorized" }),
    ).rejects.toThrow(/not found/);
    await expect(
      updateProject(userBId, projectAId, { ...projectInput, name: "Unauthorized" }),
    ).rejects.toThrow(/not found/);
    await expect(deleteExperience(userBId, experienceAId)).rejects.toThrow(/not found/);
    await expect(deleteProject(userBId, projectAId)).rejects.toThrow(/not found/);
    await expect(deleteExperience(userAId, experienceAId)).rejects.toThrow(/has evidence items/);
    await expect(deleteProject(userAId, projectAId)).rejects.toThrow(/has evidence items/);
  });

  it("prevents cross-user evidence updates, deletion, transitions, and source relationships", async () => {
    await expect(
      updateEvidenceItem(userBId, experienceEvidenceId, {
        ...evidenceInput({ experienceId: experienceBId }),
        claim: "Unauthorized evidence update.",
      }),
    ).rejects.toThrow(/not found/);
    await expect(deleteEvidenceItem(userBId, experienceEvidenceId)).rejects.toThrow(/not found/);
    await expect(
      transitionEvidenceStatus(userBId, experienceEvidenceId, { targetStatus: "VERIFIED" }),
    ).rejects.toThrow(/not found/);
    await expect(
      createEvidenceItem(userAId, evidenceInput({ experienceId: experienceBId })),
    ).rejects.toThrow(/source is unavailable/);
    await expect(
      client.evidenceItem.create({
        data: {
          userId: userAId,
          sourceType: "EXPERIENCE",
          sourceExperienceId: experienceBId,
          claim: "Database-level cross-user evidence.",
          evidenceStrength: "DIRECT",
        },
      }),
    ).rejects.toThrow();

    const deletable = await createEvidenceItem(userAId, {
      ...evidenceInput({ projectId: projectAId }),
      claim: "Unlinked evidence that can be deleted.",
    });
    await expect(deleteEvidenceItem(userBId, deletable.id)).rejects.toThrow(/not found/);
    await expect(deleteEvidenceItem(userAId, deletable.id)).resolves.toMatchObject({
      id: deletable.id,
    });
  });

  it("prevents cross-user claim mutations and evidence relationships", async () => {
    const claim = await createDraftClaim(
      userAId,
      claimInput(projectEvidenceId, "Cross-user protected claim."),
    );
    await expect(viewClaim(userBId, claim.id)).rejects.toThrow(/not found/);
    await expect(
      updateDraftClaim(userBId, claim.id, claimInput(evidenceBId, "Unauthorized rewrite.")),
    ).rejects.toThrow(/not found/);
    for (const targetStatus of ["APPROVED", "PROHIBITED", "ARCHIVED"] as const) {
      await expect(transitionClaimStatus(userBId, claim.id, { targetStatus })).rejects.toThrow(
        /not found/,
      );
    }
    await expect(
      createDraftClaim(userAId, claimInput(evidenceBId, "Cross-user evidence claim.")),
    ).rejects.toThrow(/linked evidence item is unavailable/);
    await expect(
      client.claim.create({
        data: {
          userId: userAId,
          evidenceItemId: evidenceBId,
          claimText: "Database-level cross-user claim.",
        },
      }),
    ).rejects.toThrow();
  });

  it("seeds stable records without overwriting user edits or reviewed statuses", async () => {
    const first = await seedDevelopmentData(client, seedKey);
    const [firstProfile, firstExperiences, firstProjects, firstEvidence, firstClaims] =
      await Promise.all([
        client.candidateProfile.findUniqueOrThrow({ where: { userId: first.userId } }),
        client.experience.findMany({ where: { userId: first.userId }, orderBy: { id: "asc" } }),
        client.project.findMany({ where: { userId: first.userId }, orderBy: { id: "asc" } }),
        client.evidenceItem.findMany({ where: { userId: first.userId }, orderBy: { id: "asc" } }),
        client.claim.findMany({ where: { userId: first.userId }, orderBy: { id: "asc" } }),
      ]);
    expect(firstClaims.length).toBeGreaterThanOrEqual(2);

    await Promise.all([
      client.candidateProfile.update({
        where: { id: firstProfile.id },
        data: { fullName: "User-edited seeded profile" },
      }),
      client.experience.update({
        where: { id: firstExperiences[0]!.id },
        data: { title: "User-edited seeded experience" },
      }),
      client.project.update({
        where: { id: firstProjects[0]!.id },
        data: { name: "User-edited seeded project" },
      }),
      client.evidenceItem.update({
        where: { id: firstEvidence[0]!.id },
        data: { verificationStatus: "REJECTED" },
      }),
      client.claim.update({
        where: { id: firstClaims[0]!.id },
        data: { status: "ARCHIVED", approvedAt: null },
      }),
      client.claim.update({
        where: { id: firstClaims[1]!.id },
        data: { status: "PROHIBITED", approvedAt: null },
      }),
    ]);

    const second = await seedDevelopmentData(client, seedKey);
    const [secondProfile, secondExperiences, secondProjects, secondEvidence, secondClaims] =
      await Promise.all([
        client.candidateProfile.findUniqueOrThrow({ where: { userId: second.userId } }),
        client.experience.findMany({ where: { userId: second.userId }, orderBy: { id: "asc" } }),
        client.project.findMany({ where: { userId: second.userId }, orderBy: { id: "asc" } }),
        client.evidenceItem.findMany({ where: { userId: second.userId }, orderBy: { id: "asc" } }),
        client.claim.findMany({ where: { userId: second.userId }, orderBy: { id: "asc" } }),
      ]);

    expect(second.userId).toBe(first.userId);
    expect(secondProfile).toMatchObject({
      id: firstProfile.id,
      fullName: "User-edited seeded profile",
    });
    expect(secondExperiences.map(({ id }) => id)).toEqual(firstExperiences.map(({ id }) => id));
    expect(secondExperiences[0]).toMatchObject({ title: "User-edited seeded experience" });
    expect(secondProjects.map(({ id }) => id)).toEqual(firstProjects.map(({ id }) => id));
    expect(secondProjects[0]).toMatchObject({ name: "User-edited seeded project" });
    expect(secondEvidence.map(({ id }) => id)).toEqual(firstEvidence.map(({ id }) => id));
    expect(secondEvidence[0]).toMatchObject({ verificationStatus: "REJECTED" });
    expect(secondClaims.map(({ id }) => id)).toEqual(firstClaims.map(({ id }) => id));
    expect(secondClaims[0]).toMatchObject({ status: "ARCHIVED" });
    expect(secondClaims[1]).toMatchObject({ status: "PROHIBITED" });
    expect([
      secondExperiences.length,
      secondProjects.length,
      secondEvidence.length,
      secondClaims.length,
    ]).toEqual([
      firstExperiences.length,
      firstProjects.length,
      firstEvidence.length,
      firstClaims.length,
    ]);
  });
});
