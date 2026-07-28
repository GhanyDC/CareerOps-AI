import { randomUUID } from "node:crypto";

import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseDatabaseEnv } from "@/config/env.schema";
import { PrismaClient } from "@/generated/prisma/client";
import { deleteEvidenceItem, updateEvidenceItem } from "@/modules/evidence/use-cases";
import { transitionJob } from "@/modules/jobs/use-cases";
import {
  hashRequirementLinkSet,
  hashRequirementOrder,
} from "@/modules/requirement-matching/matching";
import {
  completeRequirementReview,
  createJobRequirement,
  createRequirementEvidenceLink,
  getActiveRequirementCoverageSummary,
  moveJobRequirement,
  transitionJobRequirementState,
  updateJobRequirement,
  viewJobRequirementMatching,
} from "@/modules/requirement-matching/use-cases";

const run = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const userAKey = `requirement-match-a-${run}`;
const userBKey = `requirement-match-b-${run}`;

const manualRequirement = {
  statement: "Design and operate reliable TypeScript APIs.",
  category: "SKILL",
  importance: "REQUIRED",
  source: "MANUAL",
} as const;

function evidenceUpdateInput(experienceId: string, claim: string) {
  return {
    sourceType: "EXPERIENCE",
    sourceExperienceId: experienceId,
    sourceProjectId: undefined,
    claim,
    supportingContext: "Bounded integration context.",
    skillsDemonstrated: ["TypeScript"],
    relevantRoleFamilies: ["Backend Developer"],
    evidenceStrength: "DIRECT",
    allowedForResume: true,
    allowedForCoverLetters: false,
    allowedForInterviews: true,
    allowedForRecruiterMessages: false,
    sourceNotes: undefined,
  } as const;
}

describe("Requirement-to-Evidence Matching", () => {
  const env = parseDatabaseEnv(process.env);
  const client = new PrismaClient({
    adapter: new PrismaPg({ connectionString: env.DATABASE_URL }),
  });
  let userAId: string;
  let userBId: string;
  let experienceAId: string;
  let evidenceAId: string;
  let evidenceBId: string;
  let jobAId: string;

  async function createProvenancedJob(
    userId: string,
    input: Readonly<{
      title: string;
      description?: string;
      qualifications?: string[];
      responsibilities?: string[];
      skills?: string[];
    }>,
  ) {
    return client.$transaction(async (tx) => {
      const reference = `requirement-match-${randomUUID()}`;
      const draft = await tx.jobParseDraft.create({
        data: {
          userId,
          sourceDiscoveryRef: reference,
          sourceBatchRef: reference,
          parserVersion: "deterministic-job-parser-v1",
          contractVersion: 1,
          sourcePayloadHash: "a".repeat(64),
          parsedPayload: {},
          validationSummary: { schemaVersion: 1 },
          fieldProvenance: { schemaVersion: 1, fields: {} },
          status: "CONFIRMED",
          userCorrections: {},
          confirmedAt: new Date(),
          contentPurgedAt: new Date(),
        },
      });
      const job = await tx.job.create({
        data: {
          userId,
          ...input,
          fieldProvenance: { schemaVersion: 1, fields: {} },
        },
      });
      await tx.jobSource.create({
        data: {
          userId,
          jobId: job.id,
          parseDraftId: draft.id,
          sourceDiscoveryRef: reference,
          sourceBatchRef: reference,
          purpose: "INITIAL_CONFIRMATION",
          sourcePayloadHash: "a".repeat(64),
          parserVersion: "deterministic-job-parser-v1",
          contractVersion: 1,
          appliedFields: ["title"],
          confirmedByUserId: userId,
          idempotencyKey: randomUUID(),
          confirmationHash: randomUUID().replaceAll("-", "").repeat(2),
          sourcePurgedAt: new Date(),
        },
      });
      return job;
    });
  }

  beforeAll(async () => {
    const [userA, userB] = await Promise.all([
      client.user.create({ data: { developmentKey: userAKey } }),
      client.user.create({ data: { developmentKey: userBKey } }),
    ]);
    userAId = userA.id;
    userBId = userB.id;
    const [profileA, profileB] = await Promise.all([
      client.candidateProfile.create({ data: { userId: userAId } }),
      client.candidateProfile.create({ data: { userId: userBId } }),
    ]);
    const [experienceA, experienceB] = await Promise.all([
      client.experience.create({
        data: {
          userId: userAId,
          candidateProfileId: profileA.id,
          title: "Platform Engineer",
          experienceType: "EMPLOYMENT",
        },
      }),
      client.experience.create({
        data: {
          userId: userBId,
          candidateProfileId: profileB.id,
          title: "Other tenant experience",
          experienceType: "EMPLOYMENT",
        },
      }),
    ]);
    experienceAId = experienceA.id;
    const [evidenceA, evidenceB] = await Promise.all([
      client.evidenceItem.create({
        data: {
          userId: userAId,
          sourceType: "EXPERIENCE",
          sourceExperienceId: experienceA.id,
          claim: "Built and operated reliable TypeScript APIs.",
          skillsDemonstrated: ["TypeScript"],
          evidenceStrength: "DIRECT",
        },
      }),
      client.evidenceItem.create({
        data: {
          userId: userBId,
          sourceType: "EXPERIENCE",
          sourceExperienceId: experienceB.id,
          claim: "Other tenant private evidence.",
          evidenceStrength: "DIRECT",
        },
      }),
    ]);
    evidenceAId = evidenceA.id;
    evidenceBId = evidenceB.id;
    const job = await createProvenancedJob(userAId, {
      title: "Senior Backend Engineer",
      qualifications: ["Five years of backend engineering experience."],
      responsibilities: ["Design reliable APIs."],
      skills: ["TypeScript"],
    });
    jobAId = job.id;
  });

  afterAll(async () => {
    await client.user.deleteMany({ where: { developmentKey: { in: [userAKey, userBKey] } } });
    await client.$disconnect();
  });

  it("starts with no authoritative requirement records and validates explicit source authority", async () => {
    expect(await client.jobRequirement.count({ where: { jobId: jobAId } })).toBe(0);
    await expect(
      createJobRequirement(userAId, jobAId, {
        ...manualRequirement,
        statement: "Not an exact qualification.",
        source: "JOB_QUALIFICATION",
      }),
    ).rejects.toThrow(/exactly match/);
    const imported = await createJobRequirement(userAId, jobAId, {
      statement: "Five years of backend engineering experience.",
      category: "EXPERIENCE",
      importance: "REQUIRED",
      source: "JOB_QUALIFICATION",
    });
    expect(imported.source).toBe("JOB_QUALIFICATION");
  });

  it("enforces tenant isolation in application logic and composite foreign keys", async () => {
    const requirement = await createJobRequirement(userAId, jobAId, manualRequirement);
    await expect(
      updateJobRequirement(userBId, requirement.id, {
        ...manualRequirement,
        expectedVersion: requirement.version,
      }),
    ).rejects.toThrow(/not found/);
    await expect(
      createRequirementEvidenceLink(userAId, requirement.id, {
        evidenceItemId: evidenceBId,
        expectedEvidenceVersion: 1,
        expectedRequirementVersion: requirement.version,
        expectedMatchSetVersion: requirement.matchSetVersion,
        supportLevel: "FULL",
      }),
    ).rejects.toThrow(/unavailable or changed/);
    await expect(
      client.jobRequirementEvidenceLink.create({
        data: {
          userId: userAId,
          requirementId: requirement.id,
          evidenceItemId: evidenceBId,
          supportLevel: "FULL",
          position: 0,
        },
      }),
    ).rejects.toThrow();
  });

  it("creates unique links, derives full support, and rejects an inconsistent database review", async () => {
    const requirement = await createJobRequirement(userAId, jobAId, {
      ...manualRequirement,
      statement: "Operate reliable TypeScript services.",
    });
    const link = await createRequirementEvidenceLink(userAId, requirement.id, {
      evidenceItemId: evidenceAId,
      expectedEvidenceVersion: 1,
      expectedRequirementVersion: requirement.version,
      expectedMatchSetVersion: requirement.matchSetVersion,
      supportLevel: "FULL",
      rationale: "The evidence directly records API delivery and operation.",
    });
    const afterLink = await client.jobRequirement.findUniqueOrThrow({
      where: { id: requirement.id },
    });
    expect(afterLink.matchSetVersion).toBe(requirement.matchSetVersion + 1);
    await expect(
      client.jobRequirementEvidenceLink.create({
        data: {
          userId: userAId,
          requirementId: requirement.id,
          evidenceItemId: evidenceAId,
          supportLevel: "PARTIAL",
          position: 1,
        },
      }),
    ).rejects.toThrow();

    await client.jobRequirementEvidenceLink.update({
      where: { id: link.id },
      data: { reviewedEvidenceVersion: 1 },
    });
    await expect(
      client.jobRequirementReview.create({
        data: {
          userId: userAId,
          requirementId: requirement.id,
          status: "UNSUPPORTED",
          reviewedRequirementVersion: afterLink.version,
          reviewedMatchSetVersion: afterLink.matchSetVersion,
          matchSchemaVersion: 1,
          linkSetHash: "0".repeat(64),
        },
      }),
    ).rejects.toThrow();
    await expect(
      client.jobRequirementReview.create({
        data: {
          userId: userAId,
          requirementId: requirement.id,
          status: "SUPPORTED",
          reviewedRequirementVersion: afterLink.version,
          reviewedMatchSetVersion: afterLink.matchSetVersion,
          matchSchemaVersion: 1,
          linkSetHash: "0".repeat(64),
        },
      }),
    ).rejects.toThrow(/link-set hash/);
    const [databaseHash] = await client.$queryRaw<Array<{ hash: string }>>`
      SELECT "careerops_requirement_link_set_hash"(${requirement.id}, ${userAId})::text AS hash
    `;
    expect(databaseHash?.hash).toBe(hashRequirementLinkSet([link]));

    const review = await completeRequirementReview(userAId, requirement.id, {
      expectedRequirementVersion: afterLink.version,
      expectedMatchSetVersion: afterLink.matchSetVersion,
      expectedReviewVersion: 0,
      evidenceCoordinates: [{ evidenceItemId: evidenceAId, evidenceVersion: 1 }],
    });
    expect(review.status).toBe("SUPPORTED");
    const view = await viewJobRequirementMatching(userAId, jobAId);
    expect(view.requirements.find((item) => item.id === requirement.id)?.assessment).toMatchObject({
      freshness: "CURRENT",
      status: "SUPPORTED",
    });
  });

  it("keeps NOT_REVIEWED distinct from an explicit no-recorded-evidence review", async () => {
    const requirement = await createJobRequirement(userAId, jobAId, {
      ...manualRequirement,
      statement: "Hold an advanced database certification.",
      category: "CERTIFICATION",
      importance: "PREFERRED",
    });
    let view = await viewJobRequirementMatching(userAId, jobAId);
    expect(view.requirements.find((item) => item.id === requirement.id)?.assessment.status).toBe(
      "NOT_REVIEWED",
    );
    await completeRequirementReview(userAId, requirement.id, {
      expectedRequirementVersion: requirement.version,
      expectedMatchSetVersion: requirement.matchSetVersion,
      expectedReviewVersion: 0,
      evidenceCoordinates: [],
    });
    view = await viewJobRequirementMatching(userAId, jobAId);
    expect(view.requirements.find((item) => item.id === requirement.id)?.assessment).toMatchObject({
      freshness: "CURRENT",
      status: "UNSUPPORTED",
    });
  });

  it("marks requirement edits and Candidate Evidence edits stale without deleting links", async () => {
    const requirement = await createJobRequirement(userAId, jobAId, {
      ...manualRequirement,
      statement: "Build observable API services.",
    });
    await createRequirementEvidenceLink(userAId, requirement.id, {
      evidenceItemId: evidenceAId,
      expectedEvidenceVersion: 1,
      expectedRequirementVersion: 1,
      expectedMatchSetVersion: 1,
      supportLevel: "PARTIAL",
    });
    let current = await client.jobRequirement.findUniqueOrThrow({ where: { id: requirement.id } });
    await completeRequirementReview(userAId, requirement.id, {
      expectedRequirementVersion: current.version,
      expectedMatchSetVersion: current.matchSetVersion,
      expectedReviewVersion: 0,
      evidenceCoordinates: [{ evidenceItemId: evidenceAId, evidenceVersion: 1 }],
    });
    const edited = await updateJobRequirement(userAId, requirement.id, {
      ...manualRequirement,
      statement: "Build and operate observable API services.",
      expectedVersion: current.version,
    });
    let view = await viewJobRequirementMatching(userAId, jobAId);
    expect(
      view.requirements.find((item) => item.id === requirement.id)?.assessment.staleReasons,
    ).toContain("REQUIREMENT_VERSION_CHANGED");

    current = await client.jobRequirement.findUniqueOrThrow({ where: { id: requirement.id } });
    await completeRequirementReview(userAId, requirement.id, {
      expectedRequirementVersion: current.version,
      expectedMatchSetVersion: current.matchSetVersion,
      expectedReviewVersion: 1,
      evidenceCoordinates: [{ evidenceItemId: evidenceAId, evidenceVersion: 1 }],
    });
    const evidence = await updateEvidenceItem(
      userAId,
      evidenceAId,
      evidenceUpdateInput(experienceAId, "Built, observed, and operated reliable TypeScript APIs."),
    );
    expect(evidence.version).toBe(2);
    view = await viewJobRequirementMatching(userAId, jobAId);
    expect(
      view.requirements.find((item) => item.id === requirement.id)?.assessment.staleReasons,
    ).toContain("EVIDENCE_VERSION_CHANGED");
    expect(
      await client.jobRequirementEvidenceLink.count({
        where: { requirementId: requirement.id, evidenceItemId: evidenceAId },
      }),
    ).toBe(1);
    expect(edited.version).toBe(2);
  });

  it("removes evidence links transactionally on evidence deletion and preserves compact metadata", async () => {
    const evidence = await client.evidenceItem.create({
      data: {
        userId: userAId,
        sourceType: "EXPERIENCE",
        sourceExperienceId: experienceAId,
        claim: "Private deletion narrative that must not enter compact events.",
        evidenceStrength: "SUPPORTING",
      },
    });
    const requirement = await createJobRequirement(userAId, jobAId, {
      ...manualRequirement,
      statement: "Document operational decisions.",
    });
    await createRequirementEvidenceLink(userAId, requirement.id, {
      evidenceItemId: evidence.id,
      expectedEvidenceVersion: evidence.version,
      expectedRequirementVersion: requirement.version,
      expectedMatchSetVersion: requirement.matchSetVersion,
      supportLevel: "PARTIAL",
    });
    const linked = await client.jobRequirement.findUniqueOrThrow({ where: { id: requirement.id } });
    await completeRequirementReview(userAId, requirement.id, {
      expectedRequirementVersion: linked.version,
      expectedMatchSetVersion: linked.matchSetVersion,
      expectedReviewVersion: 0,
      evidenceCoordinates: [{ evidenceItemId: evidence.id, evidenceVersion: evidence.version }],
    });
    await deleteEvidenceItem(userAId, evidence.id);
    expect(
      await client.jobRequirementEvidenceLink.count({ where: { evidenceItemId: evidence.id } }),
    ).toBe(0);
    const view = await viewJobRequirementMatching(userAId, jobAId);
    expect(view.requirements.find((item) => item.id === requirement.id)?.assessment.freshness).toBe(
      "STALE",
    );
    const currentRequirement = await client.jobRequirement.findUniqueOrThrow({
      where: { id: requirement.id },
    });
    const deletionEvent = await client.jobRequirementMatchEvent.findFirstOrThrow({
      where: {
        requirementId: requirement.id,
        evidenceItemId: evidence.id,
        eventType: "EVIDENCE_UNLINKED",
      },
      orderBy: { createdAt: "desc" },
    });
    expect(deletionEvent.matchSetVersion).toBe(currentRequirement.matchSetVersion);
    const stored = JSON.stringify({
      events: await client.jobRequirementMatchEvent.findMany({
        where: { requirementId: requirement.id },
      }),
      audits: await client.auditLog.findMany({ where: { entityId: requirement.id } }),
    });
    expect(stored).not.toContain("Private deletion narrative");
  });

  it("handles concurrent link creation and review completion without duplicates or lost updates", async () => {
    const evidence = await client.evidenceItem.create({
      data: {
        userId: userAId,
        sourceType: "EXPERIENCE",
        sourceExperienceId: experienceAId,
        claim: "Concurrency evidence.",
        evidenceStrength: "DIRECT",
      },
    });
    const requirement = await createJobRequirement(userAId, jobAId, {
      ...manualRequirement,
      statement: "Handle concurrent data safely.",
    });
    const linkInput = {
      evidenceItemId: evidence.id,
      expectedEvidenceVersion: evidence.version,
      expectedRequirementVersion: requirement.version,
      expectedMatchSetVersion: requirement.matchSetVersion,
      supportLevel: "FULL",
    } as const;
    const linkResults = await Promise.allSettled([
      createRequirementEvidenceLink(userAId, requirement.id, linkInput),
      createRequirementEvidenceLink(userAId, requirement.id, linkInput),
    ]);
    expect(linkResults.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(
      await client.jobRequirementEvidenceLink.count({
        where: { requirementId: requirement.id, evidenceItemId: evidence.id },
      }),
    ).toBe(1);

    const current = await client.jobRequirement.findUniqueOrThrow({
      where: { id: requirement.id },
    });
    const reviewInput = {
      expectedRequirementVersion: current.version,
      expectedMatchSetVersion: current.matchSetVersion,
      expectedReviewVersion: 0,
      evidenceCoordinates: [{ evidenceItemId: evidence.id, evidenceVersion: evidence.version }],
    };
    const reviewResults = await Promise.allSettled([
      completeRequirementReview(userAId, requirement.id, reviewInput),
      completeRequirementReview(userAId, requirement.id, reviewInput),
    ]);
    expect(reviewResults.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(
      await client.jobRequirementReview.count({ where: { requirementId: requirement.id } }),
    ).toBe(1);
  });

  it("rolls back the review, link snapshots, event, and audit when a downstream write fails", async () => {
    const requirement = await createJobRequirement(userAId, jobAId, {
      ...manualRequirement,
      statement: "Rollback requirement review.",
      importance: "OTHER",
    });
    const beforeEvents = await client.jobRequirementMatchEvent.count({
      where: { requirementId: requirement.id },
    });
    await expect(
      completeRequirementReview(
        userAId,
        requirement.id,
        {
          expectedRequirementVersion: requirement.version,
          expectedMatchSetVersion: requirement.matchSetVersion,
          expectedReviewVersion: 0,
          evidenceCoordinates: [],
        },
        {
          recordAudit: async () => {
            throw new Error("forced downstream failure");
          },
        },
      ),
    ).rejects.toThrow(/forced downstream failure/);
    expect(
      await client.jobRequirementReview.findUnique({
        where: { requirementId_userId: { requirementId: requirement.id, userId: userAId } },
      }),
    ).toBeNull();
    expect(
      await client.jobRequirementMatchEvent.count({ where: { requirementId: requirement.id } }),
    ).toBe(beforeEvents);
  });

  it("preserves reviews across requirement and Job archive/restore while excluding archived records", async () => {
    const requirement = await createJobRequirement(userAId, jobAId, {
      ...manualRequirement,
      statement: "Preserve lifecycle state.",
      importance: "PREFERRED",
    });
    await completeRequirementReview(userAId, requirement.id, {
      expectedRequirementVersion: requirement.version,
      expectedMatchSetVersion: requirement.matchSetVersion,
      expectedReviewVersion: 0,
      evidenceCoordinates: [],
    });
    await transitionJobRequirementState(userAId, requirement.id, {
      targetState: "ARCHIVED",
      expectedVersion: requirement.version,
    });
    const replacement = await createJobRequirement(userAId, jobAId, {
      ...manualRequirement,
      statement: "A later active requirement owns the next available position.",
      importance: "PREFERRED",
    });
    let summary = await getActiveRequirementCoverageSummary(userAId, true);
    const archivedTotal = summary.PREFERRED.total;
    const restored = await transitionJobRequirementState(userAId, requirement.id, {
      targetState: "ACTIVE",
      expectedVersion: requirement.version,
    });
    expect(restored.position).toBeGreaterThan(replacement.position);
    const activeOrder = await client.jobRequirement.findMany({
      where: { userId: userAId, jobId: jobAId, state: "ACTIVE" },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    });
    expect(new Set(activeOrder.map((item) => item.position)).size).toBe(activeOrder.length);
    const moved = await moveJobRequirement(userAId, requirement.id, {
      direction: "UP",
      expectedOrderHash: hashRequirementOrder(
        activeOrder.map(({ id, position }) => ({ id, position })),
      ),
    });
    expect(moved.position).toBeLessThan(restored.position);
    summary = await getActiveRequirementCoverageSummary(userAId, true);
    expect(summary.PREFERRED.total).toBe(archivedTotal + 1);
    expect(
      (await viewJobRequirementMatching(userAId, jobAId)).requirements.find(
        (item) => item.id === requirement.id,
      )?.assessment,
    ).toMatchObject({ freshness: "CURRENT", status: "UNSUPPORTED" });

    const job = await client.job.findUniqueOrThrow({ where: { id: jobAId } });
    const activePreferredForJob = await client.jobRequirement.count({
      where: { userId: userAId, jobId: jobAId, state: "ACTIVE", importance: "PREFERRED" },
    });
    await transitionJob(userAId, jobAId, {
      targetStatus: "ARCHIVED",
      expectedVersion: job.version,
    });
    const archivedJobSummary = await getActiveRequirementCoverageSummary(userAId, true);
    expect(archivedJobSummary.PREFERRED.total).toBe(
      summary.PREFERRED.total - activePreferredForJob,
    );
    const archivedJob = await client.job.findUniqueOrThrow({ where: { id: jobAId } });
    await transitionJob(userAId, jobAId, {
      targetStatus: "ACTIVE",
      expectedVersion: archivedJob.version,
    });
    expect(
      (await viewJobRequirementMatching(userAId, jobAId)).requirements.find(
        (item) => item.id === requirement.id,
      )?.assessment.freshness,
    ).toBe("CURRENT");
  });

  it("keeps duplicate members independent and collapses only the active summary projection", async () => {
    const [primary, member] = await Promise.all([
      createProvenancedJob(userAId, { title: `Primary requirement Job ${run}` }),
      createProvenancedJob(userAId, { title: `Member requirement Job ${run}` }),
    ]);
    const primaryRequirement = await createJobRequirement(userAId, primary.id, {
      ...manualRequirement,
      statement: "Primary-only requirement.",
    });
    await completeRequirementReview(userAId, primaryRequirement.id, {
      expectedRequirementVersion: 1,
      expectedMatchSetVersion: 1,
      expectedReviewVersion: 0,
      evidenceCoordinates: [],
    });
    await createJobRequirement(userAId, member.id, {
      ...manualRequirement,
      statement: "Member-only requirement.",
    });
    await client.$transaction(async (tx) => {
      const group = await tx.jobDuplicateGroup.create({
        data: { userId: userAId, primaryJobId: primary.id },
      });
      await tx.jobDuplicateGroupMember.createMany({
        data: [primary.id, member.id].map((jobId) => ({
          groupId: group.id,
          userId: userAId,
          jobId,
        })),
      });
    });
    const collapsed = await getActiveRequirementCoverageSummary(userAId, false);
    const allMembers = await getActiveRequirementCoverageSummary(userAId, true);
    expect(allMembers.REQUIRED.total).toBe(collapsed.REQUIRED.total + 1);
    expect((await viewJobRequirementMatching(userAId, member.id)).requirements[0]?.statement).toBe(
      "Member-only requirement.",
    );
  });

  it("cascades matching records on Job and user deletion without retaining private narratives", async () => {
    const deletionUser = await client.user.create({
      data: { developmentKey: `requirement-delete-${run}` },
    });
    const job = await createProvenancedJob(deletionUser.id, {
      title: "Deletion Job",
      description: "Private Job description must not enter match events.",
    });
    const requirement = await createJobRequirement(deletionUser.id, job.id, {
      ...manualRequirement,
      statement: "Private requirement statement omitted from compact history.",
    });
    const stored = JSON.stringify({
      events: await client.jobRequirementMatchEvent.findMany({
        where: { requirementId: requirement.id },
      }),
      audits: await client.auditLog.findMany({ where: { entityId: requirement.id } }),
    });
    expect(stored).not.toContain("Private requirement statement");
    expect(stored).not.toContain("Private Job description");
    await client.job.delete({ where: { id: job.id } });
    expect(await client.jobRequirement.count({ where: { userId: deletionUser.id } })).toBe(0);
    await client.user.delete({ where: { id: deletionUser.id } });
    expect(
      await client.jobRequirementMatchEvent.count({ where: { userId: deletionUser.id } }),
    ).toBe(0);
  });

  it("enforces the 100-link application cap and immutable link identity", async () => {
    const requirement = await createJobRequirement(userAId, jobAId, {
      ...manualRequirement,
      statement: "Bound the reviewed evidence set.",
      importance: "OTHER",
    });
    const evidenceIds = Array.from(
      { length: 101 },
      (_, index) => `requirement-capacity-${run}-${index}`,
    );
    await client.evidenceItem.createMany({
      data: evidenceIds.map((id, index) => ({
        id,
        userId: userAId,
        sourceType: "EXPERIENCE",
        sourceExperienceId: experienceAId,
        claim: `Capacity evidence ${index}.`,
        evidenceStrength: "SUPPORTING",
      })),
    });
    await client.jobRequirementEvidenceLink.createMany({
      data: evidenceIds.slice(0, 100).map((evidenceItemId, position) => ({
        userId: userAId,
        requirementId: requirement.id,
        evidenceItemId,
        supportLevel: "PARTIAL",
        position,
      })),
    });
    const current = await client.jobRequirement.findUniqueOrThrow({
      where: { id: requirement.id },
    });
    await expect(
      createRequirementEvidenceLink(userAId, requirement.id, {
        evidenceItemId: evidenceIds[100],
        expectedEvidenceVersion: 1,
        expectedRequirementVersion: current.version,
        expectedMatchSetVersion: current.matchSetVersion,
        supportLevel: "PARTIAL",
      }),
    ).rejects.toThrow(/at most 100/);
    const firstLink = await client.jobRequirementEvidenceLink.findFirstOrThrow({
      where: { requirementId: requirement.id },
    });
    await expect(
      client.jobRequirementEvidenceLink.update({
        where: { id: firstLink.id },
        data: { evidenceItemId: evidenceBId },
      }),
    ).rejects.toThrow(/identity is immutable/);
  });
});
