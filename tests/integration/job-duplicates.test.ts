import { randomUUID } from "node:crypto";

import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseDatabaseEnv } from "@/config/env.schema";
import { PrismaClient } from "@/generated/prisma/client";
import {
  confirmDiscoveryImport,
  previewDiscoveryImport,
  purgeDiscoveryImportBatch,
} from "@/modules/discovery/use-cases";
import { expectedPurgeConfirmation } from "@/modules/discovery/purge";
import { confirmJobParseDraft, createJobParseDraft } from "@/modules/job-parsing/use-cases";
import {
  recordDuplicateDecision,
  refreshDuplicateStateForJob,
  viewDuplicateCandidate,
} from "@/modules/job-duplicates/use-cases";
import { emptyJobValues, persistedJobToValues } from "@/modules/jobs/schemas";
import { updateJob } from "@/modules/jobs/use-cases";
import { runSerializableTransaction } from "@/server/db/transaction";

const run = randomUUID();
const userAId = `duplicates-a-${run}`;
const userBId = `duplicates-b-${run}`;
const contextA = {
  userId: userAId,
  sessionId: `duplicates-session-${run}`,
  identityMode: "authenticated" as const,
};
let client: PrismaClient;
const batchIds: string[] = [];
const jobIds: string[] = [];

async function createAuthoritativeJob(suffix: string) {
  const values = {
    ...emptyJobValues(),
    title: "Backend Engineer",
    companyName: "Example Company",
    locationLabel: "Remote – Philippines",
    employmentType: "FULL_TIME" as const,
    workplaceArrangement: "REMOTE" as const,
    sourceUrl: `https://jobs.example.test/opening/42?jobId=42&utm_source=${suffix}`,
    responsibilities: ["Build APIs", "Review code"],
    qualifications: ["TypeScript experience"],
    skills: ["TypeScript", "PostgreSQL"],
  };
  const preview = previewDiscoveryImport(contextA, {
    contractVersion: 1,
    importMethod: "PASTED_TEXT",
    sourceLabel: "Integration test",
    rawText: JSON.stringify({ contractVersion: 1, job: values }),
  });
  const batch = await confirmDiscoveryImport(contextA, preview.token);
  batchIds.push(batch.id);
  const draft = await createJobParseDraft(userAId, batch.discoveries[0]!.id);
  const job = await confirmJobParseDraft(userAId, draft.id, {
    expectedVersion: draft.version,
    idempotencyKey: randomUUID(),
    reviewed: true,
    selectedFields: [],
  });
  jobIds.push(job.id);
  return job;
}

describe("Job canonicalization and duplicate resolution", () => {
  beforeAll(async () => {
    const env = parseDatabaseEnv(process.env);
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: env.DATABASE_URL }) });
    await client.user.createMany({ data: [{ id: userAId }, { id: userBId }] });
    await createAuthoritativeJob("first");
    await createAuthoritativeJob("second");
  });

  afterAll(async () => {
    for (const batchId of batchIds) {
      const exists = await client.discoveryImportBatch.findUnique({ where: { id: batchId } });
      if (exists) {
        await purgeDiscoveryImportBatch(userAId, batchId, {
          confirmation: expectedPurgeConfirmation(batchId),
        });
      }
    }
    await client.jobDuplicateEvent.deleteMany({ where: { userId: { in: [userAId, userBId] } } });
    await client.jobDuplicateGroup.deleteMany({ where: { userId: { in: [userAId, userBId] } } });
    await client.jobDuplicateCandidate.deleteMany({
      where: { userId: { in: [userAId, userBId] } },
    });
    await client.auditLog.deleteMany({ where: { userId: { in: [userAId, userBId] } } });
    await client.user.deleteMany({ where: { id: { in: [userAId, userBId] } } });
    await client.$disconnect();
  });

  it("creates versioned representations and one explainable ordered candidate", async () => {
    const representations = await client.jobCanonicalRepresentation.findMany({
      where: { userId: userAId },
      orderBy: { jobId: "asc" },
    });
    expect(representations).toHaveLength(2);
    expect(representations.every((item) => item.canonicalizationVersion === 1)).toBe(true);
    expect(representations[0]!.canonicalSourceUrl).toBe(representations[1]!.canonicalSourceUrl);
    const candidate = await client.jobDuplicateCandidate.findFirstOrThrow({
      where: { userId: userAId },
    });
    expect(candidate.jobAId < candidate.jobBId).toBe(true);
    expect(candidate.evidenceTier).toBe("STRONG");
    expect(candidate.decision).toBeNull();
    expect(JSON.stringify(candidate.evidence)).toContain("EXACT_CANONICAL_URL");
    expect(JSON.stringify(candidate.evidence)).not.toContain("Build APIs");
  });

  it("treats another user's candidate as unavailable", async () => {
    const candidate = await client.jobDuplicateCandidate.findFirstOrThrow({
      where: { userId: userAId },
    });
    await expect(viewDuplicateCandidate(userBId, candidate.id)).rejects.toMatchObject({
      code: "DUPLICATE_CANDIDATE_NOT_FOUND",
    });
  });

  it("rejects self-pairs and reversed pairs at the database boundary", async () => {
    const ordered = [...jobIds].sort();
    const evidence = { schemaVersion: 1, qualifyingRules: [], supportingRules: [] };
    const conflicts = { schemaVersion: 1, items: [] };
    await expect(
      client.jobDuplicateCandidate.create({
        data: {
          userId: userAId,
          jobAId: ordered[0]!,
          jobBId: ordered[0]!,
          evidenceTier: "MODERATE",
          jobARepresentationHash: "a".repeat(64),
          jobBRepresentationHash: "b".repeat(64),
          evidence,
          conflicts,
        },
      }),
    ).rejects.toThrow();
    await expect(
      client.jobDuplicateCandidate.create({
        data: {
          userId: userAId,
          jobAId: ordered[1]!,
          jobBId: ordered[0]!,
          evidenceTier: "MODERATE",
          jobARepresentationHash: "a".repeat(64),
          jobBRepresentationHash: "b".repeat(64),
          evidence,
          conflicts,
        },
      }),
    ).rejects.toThrow();
  });

  it("keeps concurrent rescans idempotent", async () => {
    const candidate = await client.jobDuplicateCandidate.findFirstOrThrow({
      where: { userId: userAId },
    });
    await client.jobDuplicateEvent.deleteMany({ where: { candidateId: candidate.id } });
    await client.jobDuplicateCandidate.delete({
      where: { id_userId: { id: candidate.id, userId: userAId } },
    });
    await Promise.all(
      jobIds.map((jobId) =>
        runSerializableTransaction((tx) => refreshDuplicateStateForJob(tx, userAId, jobId)),
      ),
    );
    expect(await client.jobDuplicateCandidate.count({ where: { userId: userAId } })).toBe(1);
  });

  it("does not rewrite unchanged deterministic evidence", async () => {
    const before = await client.jobDuplicateCandidate.findFirstOrThrow({
      where: { userId: userAId },
    });
    await runSerializableTransaction((tx) => refreshDuplicateStateForJob(tx, userAId, jobIds[0]!));
    const after = await client.jobDuplicateCandidate.findUniqueOrThrow({
      where: { id: before.id },
    });
    expect(after.version).toBe(before.version);
    expect(after.decisionNeedsReview).toBe(false);
  });

  it("records same opportunity atomically with an explicit primary and idempotent replay", async () => {
    const candidate = await client.jobDuplicateCandidate.findFirstOrThrow({
      where: { userId: userAId },
    });
    const idempotencyKey = randomUUID();
    const input = {
      expectedVersion: candidate.version,
      decision: "SAME_OPPORTUNITY" as const,
      primaryJobId: candidate.jobAId,
      splitPrimaryJobIds: [],
      idempotencyKey,
    };
    const decided = await recordDuplicateDecision(userAId, candidate.id, input);
    const replay = await recordDuplicateDecision(userAId, candidate.id, input);
    expect(decided.decision).toBe("SAME_OPPORTUNITY");
    expect(replay.id).toBe(decided.id);
    const group = await client.jobDuplicateGroup.findFirstOrThrow({
      where: { userId: userAId },
      include: { members: true },
    });
    expect(group.primaryJobId).toBe(candidate.jobAId);
    expect(group.members.map((member) => member.jobId).sort()).toEqual([...jobIds].sort());
    expect(
      await client.auditLog.count({
        where: { userId: userAId, action: "JOB_DUPLICATE_DECISION_RECORDED" },
      }),
    ).toBe(1);
  });

  it("preserves the decision but marks it stale after a relevant authoritative edit", async () => {
    const current = await client.job.findUniqueOrThrow({ where: { id: jobIds[1]! } });
    await updateJob(userAId, current.id, current.version, {
      ...persistedJobToValues(current),
      title: "Senior Backend Engineer",
      sourceUrl: "https://jobs.example.test/opening/99?jobId=99",
    });
    const candidate = await client.jobDuplicateCandidate.findFirstOrThrow({
      where: { userId: userAId },
    });
    expect(candidate.decision).toBe("SAME_OPPORTUNITY");
    expect(candidate.activeCandidate).toBe(false);
    expect(candidate.decisionNeedsReview).toBe(true);
    expect(candidate.decisionStaleAt).not.toBeNull();
    expect(await client.jobDuplicateGroup.count({ where: { userId: userAId } })).toBe(1);
  });

  it("can explicitly change a same decision without deleting either Job", async () => {
    const candidate = await client.jobDuplicateCandidate.findFirstOrThrow({
      where: { userId: userAId },
    });
    const updated = await recordDuplicateDecision(userAId, candidate.id, {
      expectedVersion: candidate.version,
      decision: "DIFFERENT_OPPORTUNITIES",
      splitPrimaryJobIds: [],
      idempotencyKey: randomUUID(),
    });
    expect(updated.decision).toBe("DIFFERENT_OPPORTUNITIES");
    expect(updated.decisionNeedsReview).toBe(false);
    expect(await client.jobDuplicateGroup.count({ where: { userId: userAId } })).toBe(0);
    expect(await client.job.count({ where: { userId: userAId } })).toBe(2);
  });

  it("privacy-purges raw provenance without removing Jobs or retaining raw duplicate evidence", async () => {
    const batchId = batchIds[0]!;
    await purgeDiscoveryImportBatch(userAId, batchId, {
      confirmation: expectedPurgeConfirmation(batchId),
    });
    const candidate = await client.jobDuplicateCandidate.findFirstOrThrow({
      where: { userId: userAId },
    });
    expect(await client.job.count({ where: { userId: userAId } })).toBe(2);
    expect(JSON.stringify([candidate.evidence, candidate.conflicts])).not.toContain("Build APIs");
    expect(
      await client.jobSource.count({
        where: { userId: userAId, sourceBatchRef: batchId, sourcePurgedAt: { not: null } },
      }),
    ).toBeGreaterThan(0);
  });
});
