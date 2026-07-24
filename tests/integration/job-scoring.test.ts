import { randomUUID } from "node:crypto";

import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseDatabaseEnv } from "@/config/env.schema";
import { PrismaClient, type Prisma } from "@/generated/prisma/client";
import { setUserStatus } from "@/modules/auth/use-cases";
import {
  confirmDiscoveryImport,
  previewDiscoveryImport,
  purgeDiscoveryImportBatch,
} from "@/modules/discovery/use-cases";
import { expectedPurgeConfirmation } from "@/modules/discovery/purge";
import {
  recordDuplicateDecision,
  selectDuplicateGroupPrimary,
} from "@/modules/job-duplicates/use-cases";
import {
  rescoreJob,
  saveJobScoringProfile,
  scanJobsWithPreliminaryScoring,
  scoreJobInTransaction,
  viewJobPreliminaryScore,
} from "@/modules/job-scoring/public.server";
import {
  defaultJobScoringConfiguration,
  type JobScoringConfiguration,
} from "@/modules/job-scoring/public";
import { summarizePrimaryCollapsedScores } from "@/modules/job-scoring/use-cases";
import {
  confirmJobParseDraft,
  createJobParseDraft,
  updateJobParseDraft,
  viewParseDraft,
} from "@/modules/job-parsing/use-cases";
import { emptyJobValues, persistedJobToValues } from "@/modules/jobs/schemas";
import { listJobs, transitionJob, updateJob } from "@/modules/jobs/use-cases";
import { runSerializableTransaction } from "@/server/db/transaction";

const run = randomUUID();
const userAId = `scoring-a-${run}`;
const userBId = `scoring-b-${run}`;
const contextA = {
  userId: userAId,
  sessionId: `scoring-session-${run}`,
  identityMode: "authenticated" as const,
};
let client: PrismaClient;
let profileAId: string;
let profileBId: string;
const batchIds: string[] = [];
const jobIds: string[] = [];

function scoringConfiguration(target = "120000"): JobScoringConfiguration {
  const configuration = defaultJobScoringConfiguration();
  Object.assign(configuration.components.SALARY, {
    enabled: true,
    weight: 40,
    preferredMinimum: "100000",
    target,
    currency: "USD",
    salaryPeriod: "YEAR",
  });
  Object.assign(configuration.components.EMPLOYMENT_TYPE, {
    enabled: true,
    weight: 20,
    tiers: {
      mostPreferred: ["FULL_TIME"],
      acceptable: ["CONTRACT"],
      lessPreferred: ["PART_TIME"],
    },
  });
  Object.assign(configuration.components.WORKPLACE_ARRANGEMENT, {
    enabled: true,
    weight: 25,
    tiers: {
      mostPreferred: ["REMOTE"],
      acceptable: ["HYBRID"],
      lessPreferred: ["ON_SITE"],
    },
  });
  Object.assign(configuration.components.COUNTRY, {
    enabled: true,
    weight: 15,
    tiers: {
      mostPreferred: ["PH"],
      acceptable: ["SG"],
      lessPreferred: ["JP"],
    },
  });
  return configuration;
}

async function createAuthoritativeJob(
  suffix: string,
  overrides: Partial<ReturnType<typeof emptyJobValues>> = {},
) {
  const values = {
    ...emptyJobValues(),
    title: `Platform Engineer ${suffix}`,
    companyName: "Scoring Example Company",
    employmentType: "FULL_TIME" as const,
    workplaceArrangement: "REMOTE" as const,
    countryCode: "PH",
    locationLabel: "Remote",
    salaryMin: "120000",
    salaryMax: "140000",
    salaryCurrency: "USD",
    salaryPeriod: "YEAR" as const,
    sourceUrl: `https://jobs.example.test/scoring/${suffix}-${run}`,
    description: `private scoring description ${suffix}`,
    contactDetails: `private-${suffix}@example.test`,
    ...overrides,
  };
  const preview = previewDiscoveryImport(contextA, {
    contractVersion: 1,
    importMethod: "PASTED_TEXT",
    sourceLabel: "Preliminary scoring integration test",
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
  return { job, batch };
}

describe.sequential("Preliminary Job Scoring persistence and lifecycle", () => {
  beforeAll(async () => {
    const env = parseDatabaseEnv(process.env);
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: env.DATABASE_URL }) });
    await client.user.createMany({ data: [{ id: userAId }, { id: userBId }] });
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
    await client.authenticationAuditLog.deleteMany({
      where: { userId: { in: [userAId, userBId] } },
    });
    await client.user.deleteMany({ where: { id: { in: [userAId, userBId] } } });
    await client.$disconnect();
  });

  it("creates one owned versioned profile with compact event and product audit", async () => {
    const profileA = await saveJobScoringProfile(userAId, {
      configuration: scoringConfiguration(),
    });
    const profileB = await saveJobScoringProfile(userBId, {
      configuration: scoringConfiguration(),
    });
    profileAId = profileA.id;
    profileBId = profileB.id;
    expect(profileA).toMatchObject({ version: 1 });
    expect(profileA.configurationHash).toMatch(/^[0-9a-f]{64}$/);
    expect(await client.jobScoringEvent.count({ where: { profileId: profileA.id } })).toBe(1);
    expect(
      await client.auditLog.count({
        where: { entityType: "JOB_SCORING_PROFILE", entityId: profileA.id },
      }),
    ).toBe(1);
    await expect(
      client.jobScoringProfile.create({
        data: {
          userId: userAId,
          configuration: scoringConfiguration(),
          configurationHash: "a".repeat(64),
        },
      }),
    ).rejects.toThrow();
  });

  it("enforces database value, JSON, actor, and composite ownership constraints", async () => {
    const tempUserId = `scoring-constraints-${run}`;
    await client.user.create({ data: { id: tempUserId } });
    await expect(
      client.jobScoringProfile.create({
        data: {
          userId: tempUserId,
          configuration: { schemaVersion: 2, components: {} },
          configurationHash: "not-a-hash",
          version: 0,
        },
      }),
    ).rejects.toThrow();

    const first = await createAuthoritativeJob("owned");
    const score = await client.jobPreliminaryScore.findUniqueOrThrow({
      where: { jobId_userId: { jobId: first.job.id, userId: userAId } },
    });
    await expect(
      client.jobPreliminaryScore.create({
        data: {
          userId: userBId,
          profileId: profileBId,
          jobId: first.job.id,
          score: 101,
          coverage: 100,
          ruleSetVersion: 1,
          scoringProfileVersion: 1,
          configurationHash: score.configurationHash,
          sourceJobVersion: score.sourceJobVersion,
          explanation: score.explanation as Prisma.InputJsonValue,
          explanationHash: score.explanationHash,
        },
      }),
    ).rejects.toThrow();
    await expect(
      client.jobScoringEvent.create({
        data: {
          userId: userAId,
          profileId: profileAId,
          jobId: first.job.id,
          eventType: "JOB_RESCORED",
          actorUserId: userBId,
          previousScore: 100,
          newScore: 100,
          previousCoverage: 100,
          newCoverage: 100,
          scoringProfileVersion: 1,
          sourceJobVersion: first.job.version,
          safeMetadata: { schemaVersion: 1 },
        },
      }),
    ).rejects.toThrow();
    await client.user.delete({ where: { id: tempUserId } });
  });

  it("scores initial confirmation and makes cross-tenant records unavailable", async () => {
    const jobId = jobIds[0]!;
    const state = await viewJobPreliminaryScore(userAId, jobId);
    expect(state.score).toMatchObject({ score: 100, coverage: 100, sourceJobVersion: 1 });
    expect((await viewJobPreliminaryScore(userBId, jobId)).score).toBeNull();
  });

  it("uses optimistic profile versions and derives stale scores after profile edits", async () => {
    const current = await client.jobScoringProfile.findUniqueOrThrow({
      where: { userId: userAId },
    });
    await expect(
      saveJobScoringProfile(userAId, {
        expectedVersion: current.version + 1,
        configuration: scoringConfiguration("150000"),
      }),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    const updated = await saveJobScoringProfile(userAId, {
      expectedVersion: current.version,
      configuration: scoringConfiguration("150000"),
    });
    const state = await viewJobPreliminaryScore(userAId, jobIds[0]!);
    expect(updated.version).toBe(2);
    expect(state.score?.scoringProfileVersion).toBe(1);
  });

  it("runs bounded version-bound scans and rejects old cursors", async () => {
    await createAuthoritativeJob("bounded");
    const invalidCursor = Buffer.from(
      JSON.stringify({ lastJobId: "job", profileVersion: 2, extra: true }),
      "utf8",
    ).toString("base64url");
    await expect(
      scanJobsWithPreliminaryScoring(userAId, { cursor: invalidCursor, pageSize: 1 }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const firstPage = await scanJobsWithPreliminaryScoring(userAId, { pageSize: 1 });
    expect(firstPage).toMatchObject({ processedJobs: 1, profileVersion: 2 });
    expect(firstPage.nextCursor).toBeTruthy();
    const current = await client.jobScoringProfile.findUniqueOrThrow({
      where: { userId: userAId },
    });
    const updated = await saveJobScoringProfile(userAId, {
      expectedVersion: current.version,
      configuration: scoringConfiguration("130000"),
    });
    await expect(
      scanJobsWithPreliminaryScoring(userAId, {
        cursor: firstPage.nextCursor,
        pageSize: 1,
      }),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    await scanJobsWithPreliminaryScoring(userAId, { pageSize: 50 }, updated.version);
  });

  it("keeps repeated scoring state-idempotent", async () => {
    const jobId = jobIds[0]!;
    const before = await client.jobPreliminaryScore.findUniqueOrThrow({
      where: { jobId_userId: { jobId, userId: userAId } },
    });
    const events = await client.jobScoringEvent.count({ where: { userId: userAId, jobId } });
    await rescoreJob(userAId, jobId);
    const second = await rescoreJob(userAId, jobId);
    expect(second?.scoredAt).toEqual(before.scoredAt);
    expect(await client.jobScoringEvent.count({ where: { userId: userAId, jobId } })).toBe(events);
  });

  it("refreshes scores transactionally after edits and selected-field reparses", async () => {
    const jobId = jobIds[0]!;
    const current = await client.job.findUniqueOrThrow({ where: { id: jobId } });
    const updated = await updateJob(userAId, jobId, current.version, {
      ...persistedJobToValues(current),
      employmentType: "CONTRACT",
    });
    let score = await client.jobPreliminaryScore.findUniqueOrThrow({
      where: { jobId_userId: { jobId, userId: userAId } },
    });
    expect(score.sourceJobVersion).toBe(updated.version);
    expect(score.score).toBeLessThan(100);

    const source = await client.jobSource.findFirstOrThrow({ where: { userId: userAId, jobId } });
    const draft = await createJobParseDraft(userAId, source.discoveryId!, jobId);
    const review = await viewParseDraft(userAId, draft.id);
    const correction = review.userCorrections as {
      schemaVersion: 1;
      rawInput: Record<string, string>;
      values: ReturnType<typeof emptyJobValues>;
    };
    const corrected = await updateJobParseDraft(userAId, draft.id, {
      expectedVersion: draft.version,
      correction: {
        ...correction,
        values: { ...correction.values, title: "Reparsed Scoring Engineer" },
      },
    });
    const reparsed = await confirmJobParseDraft(userAId, draft.id, {
      expectedVersion: corrected.version,
      idempotencyKey: randomUUID(),
      reviewed: true,
      selectedFields: ["title"],
    });
    score = await client.jobPreliminaryScore.findUniqueOrThrow({
      where: { jobId_userId: { jobId, userId: userAId } },
    });
    expect(score.sourceJobVersion).toBe(reparsed.version);
  });

  it("preserves the last score on archive and refreshes it on restore", async () => {
    const jobId = jobIds[0]!;
    const current = await client.job.findUniqueOrThrow({ where: { id: jobId } });
    const before = await client.jobPreliminaryScore.findUniqueOrThrow({
      where: { jobId_userId: { jobId, userId: userAId } },
    });
    const archived = await transitionJob(userAId, jobId, {
      expectedVersion: current.version,
      targetStatus: "ARCHIVED",
    });
    expect(
      (
        await client.jobPreliminaryScore.findUniqueOrThrow({
          where: { jobId_userId: { jobId, userId: userAId } },
        })
      ).explanationHash,
    ).toBe(before.explanationHash);
    const restored = await transitionJob(userAId, jobId, {
      expectedVersion: archived.version,
      targetStatus: "ACTIVE",
    });
    expect(
      (
        await client.jobPreliminaryScore.findUniqueOrThrow({
          where: { jobId_userId: { jobId, userId: userAId } },
        })
      ).sourceJobVersion,
    ).toBe(restored.version);
  });

  it("serializes concurrency and rolls scoring back with the Job transaction", async () => {
    const jobId = jobIds[0]!;
    const current = await client.job.findUniqueOrThrow({ where: { id: jobId } });
    const concurrent = await Promise.allSettled([
      updateJob(userAId, jobId, current.version, {
        ...persistedJobToValues(current),
        notes: `concurrent-scoring-${run}`,
      }),
      rescoreJob(userAId, jobId),
    ]);
    expect(concurrent.every((result) => result.status === "fulfilled")).toBe(true);
    const finalJob = await client.job.findUniqueOrThrow({ where: { id: jobId } });
    expect(
      (
        await client.jobPreliminaryScore.findUniqueOrThrow({
          where: { jobId_userId: { jobId, userId: userAId } },
        })
      ).sourceJobVersion,
    ).toBe(finalJob.version);

    const beforeScore = await client.jobPreliminaryScore.findUniqueOrThrow({
      where: { jobId_userId: { jobId, userId: userAId } },
    });
    const beforeEvents = await client.jobScoringEvent.count({ where: { userId: userAId, jobId } });
    await expect(
      runSerializableTransaction(async (tx) => {
        await tx.job.update({
          where: { id_userId: { id: jobId, userId: userAId } },
          data: { countryCode: "SG", version: { increment: 1 } },
        });
        await scoreJobInTransaction(tx, userAId, jobId, userAId);
        throw new Error("force scoring rollback");
      }),
    ).rejects.toThrow("force scoring rollback");
    expect(
      (
        await client.jobPreliminaryScore.findUniqueOrThrow({
          where: { jobId_userId: { jobId, userId: userAId } },
        })
      ).explanationHash,
    ).toBe(beforeScore.explanationHash);
    expect(await client.jobScoringEvent.count({ where: { userId: userAId, jobId } })).toBe(
      beforeEvents,
    );
  });

  it("scores duplicate members independently and ranks only the explicit primary by default", async () => {
    const duplicateOf = await client.job.findUniqueOrThrow({ where: { id: jobIds[0]! } });
    const secondary = await createAuthoritativeJob("duplicate-low", {
      title: duplicateOf.title,
      companyName: duplicateOf.companyName,
      salaryMin: "80000",
      salaryMax: "90000",
      sourceUrl: duplicateOf.sourceUrl,
    });
    await scanJobsWithPreliminaryScoring(userAId, { pageSize: 50 });
    const candidate = await client.jobDuplicateCandidate.findFirstOrThrow({
      where: {
        userId: userAId,
        OR: [
          { jobAId: jobIds[0]!, jobBId: secondary.job.id },
          { jobAId: secondary.job.id, jobBId: jobIds[0]! },
        ],
      },
    });
    await recordDuplicateDecision(userAId, candidate.id, {
      expectedVersion: candidate.version,
      decision: "SAME_OPPORTUNITY",
      primaryJobId: candidate.jobAId,
      splitPrimaryJobIds: [],
      idempotencyKey: randomUUID(),
    });
    const group = await client.jobDuplicateGroup.findFirstOrThrow({
      where: { userId: userAId, members: { some: { jobId: secondary.job.id } } },
    });
    const scoresBefore = await client.jobPreliminaryScore.findMany({
      where: { userId: userAId, jobId: { in: [candidate.jobAId, candidate.jobBId] } },
      select: { jobId: true, scoredAt: true },
      orderBy: { jobId: "asc" },
    });
    const nextPrimary =
      candidate.jobAId === group.primaryJobId ? candidate.jobBId : candidate.jobAId;
    await selectDuplicateGroupPrimary(userAId, group.id, {
      expectedVersion: group.version,
      primaryJobId: nextPrimary,
      idempotencyKey: randomUUID(),
    });
    expect(
      await client.jobPreliminaryScore.findMany({
        where: { userId: userAId, jobId: { in: [candidate.jobAId, candidate.jobBId] } },
        select: { jobId: true, scoredAt: true },
        orderBy: { jobId: "asc" },
      }),
    ).toEqual(scoresBefore);
    const profile = await client.jobScoringProfile.findUniqueOrThrow({
      where: { userId: userAId },
    });
    const summary = await summarizePrimaryCollapsedScores(userAId, profile.version, 1);
    expect(summary.considered).toBe(
      (await client.job.count({ where: { userId: userAId, status: "ACTIVE" } })) - 1,
    );

    const collapsed = await listJobs(userAId, {
      status: "ACTIVE",
      consideration: true,
      scoreSort: true,
      pageSize: 50,
    });
    expect(collapsed.items.some((job) => job.id === nextPrimary)).toBe(true);
    expect(
      collapsed.items.some(
        (job) =>
          job.id === (nextPrimary === candidate.jobAId ? candidate.jobBId : candidate.jobAId),
      ),
    ).toBe(false);
    const inventory = await listJobs(userAId, {
      status: "ACTIVE",
      consideration: false,
      scoreSort: true,
      pageSize: 50,
    });
    expect(inventory.items.some((job) => job.id === candidate.jobAId)).toBe(true);
    expect(inventory.items.some((job) => job.id === candidate.jobBId)).toBe(true);
  });

  it("does not retain purged source content in scores or compact events", async () => {
    const batchId = batchIds[0]!;
    await purgeDiscoveryImportBatch(userAId, batchId, {
      confirmation: expectedPurgeConfirmation(batchId),
    });
    expect(
      JSON.stringify(await client.jobPreliminaryScore.findMany({ where: { userId: userAId } })),
    ).not.toContain("private scoring description");
    expect(
      JSON.stringify(await client.jobScoringEvent.findMany({ where: { userId: userAId } })),
    ).not.toContain("private-");
  });

  it("preserves scoring on soft deletion and cascades it on hard deletion", async () => {
    const before = await client.jobPreliminaryScore.count({ where: { userId: userAId } });
    await setUserStatus(userAId, "DELETED", "SCORING_TEST");
    expect(await client.jobPreliminaryScore.count({ where: { userId: userAId } })).toBe(before);
    await setUserStatus(userAId, "ACTIVE", "SCORING_TEST_COMPLETE");

    const hardDeleteUserId = `scoring-hard-delete-${run}`;
    await client.user.create({ data: { id: hardDeleteUserId } });
    await saveJobScoringProfile(hardDeleteUserId, {
      configuration: scoringConfiguration(),
    });
    await client.user.delete({ where: { id: hardDeleteUserId } });
    expect(
      await client.jobScoringProfile.findUnique({ where: { userId: hardDeleteUserId } }),
    ).toBeNull();
    expect(await client.jobScoringEvent.count({ where: { userId: hardDeleteUserId } })).toBe(0);
  });
});
