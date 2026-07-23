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
  evaluateJobHardFiltersInTransaction,
  isJobFilterEvaluationFresh,
  reevaluateJobHardFilters,
  scanJobsWithHardFilters,
  viewJobFilterEvaluation,
} from "@/modules/job-hard-filters/public.server";
import {
  defaultJobFilterConfiguration,
  type JobFilterConfiguration,
} from "@/modules/job-hard-filters/public";
import { saveJobFilterProfile } from "@/modules/job-hard-filters/use-cases";
import { countPrimaryCollapsedFilterResults } from "@/modules/job-hard-filters/use-cases";
import {
  confirmJobParseDraft,
  createJobParseDraft,
  updateJobParseDraft,
  viewParseDraft,
} from "@/modules/job-parsing/use-cases";
import {
  recordDuplicateDecision,
  selectDuplicateGroupPrimary,
} from "@/modules/job-duplicates/use-cases";
import { emptyJobValues, persistedJobToValues } from "@/modules/jobs/schemas";
import { transitionJob, updateJob } from "@/modules/jobs/use-cases";
import { runSerializableTransaction } from "@/server/db/transaction";

const run = randomUUID();
const userAId = `filters-a-${run}`;
const userBId = `filters-b-${run}`;
const contextA = {
  userId: userAId,
  sessionId: `filters-session-${run}`,
  identityMode: "authenticated" as const,
};
let client: PrismaClient;
let profileAId: string;
let profileBId: string;
const batchIds: string[] = [];
const jobIds: string[] = [];

function filterConfiguration(minimum = "100000"): JobFilterConfiguration {
  const configuration = defaultJobFilterConfiguration();
  Object.assign(configuration.rules.MINIMUM_SALARY, {
    enabled: true,
    minimum,
    currency: "USD",
    salaryPeriod: "YEAR",
  });
  Object.assign(configuration.rules.ALLOWED_EMPLOYMENT_TYPES, {
    enabled: true,
    allowedEmploymentTypes: ["FULL_TIME"],
  });
  Object.assign(configuration.rules.ALLOWED_WORKPLACE_ARRANGEMENTS, {
    enabled: true,
    allowedWorkplaceArrangements: ["REMOTE"],
  });
  Object.assign(configuration.rules.COUNTRY_ALLOW_DENY, {
    enabled: true,
    allowedCountryCodes: ["PH"],
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
    companyName: "Example Company",
    employmentType: "FULL_TIME" as const,
    workplaceArrangement: "REMOTE" as const,
    countryCode: "PH",
    locationLabel: "Remote",
    salaryMin: "120000",
    salaryMax: "140000",
    salaryCurrency: "USD",
    salaryPeriod: "YEAR" as const,
    sourceUrl: "https://jobs.example.test/opening/filter-test?jobId=42",
    description: `private raw description ${suffix}`,
    ...overrides,
  };
  const preview = previewDiscoveryImport(contextA, {
    contractVersion: 1,
    importMethod: "PASTED_TEXT",
    sourceLabel: "Hard filter integration test",
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
  return { job, batch, discoveryId: batch.discoveries[0]!.id };
}

describe("Job Hard Filters persistence and lifecycle", () => {
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

  it("creates exactly one owned profile with compact event and product audit", async () => {
    const profileA = await saveJobFilterProfile(userAId, {
      configuration: filterConfiguration(),
    });
    const profileB = await saveJobFilterProfile(userBId, {
      configuration: defaultJobFilterConfiguration(),
    });
    profileAId = profileA.id;
    profileBId = profileB.id;
    expect(profileA.version).toBe(1);
    expect(profileA.configurationHash).toMatch(/^[0-9a-f]{64}$/);
    expect(await client.jobFilterEvent.count({ where: { profileId: profileA.id } })).toBe(1);
    expect(
      await client.auditLog.count({
        where: { entityType: "JOB_FILTER_PROFILE", entityId: profileA.id },
      }),
    ).toBe(1);
    await expect(
      client.jobFilterProfile.create({
        data: {
          userId: userAId,
          configuration: filterConfiguration(),
          configurationHash: "a".repeat(64),
        },
      }),
    ).rejects.toThrow();
  });

  it("enforces configuration JSON, hash, version, actor, and composite ownership constraints", async () => {
    const tempUserId = `filters-constraints-${run}`;
    await client.user.create({ data: { id: tempUserId } });
    await expect(
      client.jobFilterProfile.create({
        data: {
          userId: tempUserId,
          configuration: { schemaVersion: 2, rules: {} },
          configurationHash: "not-a-hash",
          version: 0,
        },
      }),
    ).rejects.toThrow();

    const first = await createAuthoritativeJob("owned");
    const evaluation = await client.jobFilterEvaluation.findUniqueOrThrow({
      where: { jobId_userId: { jobId: first.job.id, userId: userAId } },
    });
    await expect(
      client.jobFilterEvaluation.create({
        data: {
          userId: userBId,
          profileId: profileBId,
          jobId: first.job.id,
          outcome: evaluation.outcome,
          ruleSetVersion: 1,
          filterProfileVersion: 1,
          configurationHash: evaluation.configurationHash,
          sourceJobVersion: evaluation.sourceJobVersion,
          explanation: evaluation.explanation as Prisma.InputJsonValue,
          explanationHash: evaluation.explanationHash,
        },
      }),
    ).rejects.toThrow();
    await expect(
      client.jobFilterEvaluation.update({
        where: { id: evaluation.id },
        data: {
          explanation: {
            ...(evaluation.explanation as Prisma.JsonObject),
            profileVersion: evaluation.filterProfileVersion + 1,
          },
        },
      }),
    ).rejects.toThrow();
    await expect(
      client.jobFilterEvent.create({
        data: {
          userId: userAId,
          profileId: profileAId,
          jobId: first.job.id,
          eventType: "JOB_REEVALUATED",
          actorUserId: userBId,
          newOutcome: "PASS",
          filterProfileVersion: 1,
          sourceJobVersion: first.job.version,
          safeMetadata: { schemaVersion: 1 },
        },
      }),
    ).rejects.toThrow();
    await client.user.delete({ where: { id: tempUserId } });
  });

  it("evaluates initial confirmation and denies cross-user reads", async () => {
    const jobId = jobIds[0]!;
    const state = await viewJobFilterEvaluation(userAId, jobId);
    expect(state.evaluation).toMatchObject({ outcome: "PASS", sourceJobVersion: 1 });
    expect(
      isJobFilterEvaluationFresh(state.profile, { version: 1, status: "ACTIVE" }, state.evaluation),
    ).toBe(true);
    const crossUser = await viewJobFilterEvaluation(userBId, jobId);
    expect(crossUser.evaluation).toBeNull();
  });

  it("uses optimistic profile versions and derives staleness after a profile edit", async () => {
    const current = await client.jobFilterProfile.findUniqueOrThrow({ where: { userId: userAId } });
    await expect(
      saveJobFilterProfile(userAId, {
        expectedVersion: current.version + 1,
        configuration: filterConfiguration("150000"),
      }),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    const updated = await saveJobFilterProfile(userAId, {
      expectedVersion: current.version,
      configuration: filterConfiguration("150000"),
    });
    const job = await client.job.findUniqueOrThrow({ where: { id: jobIds[0]! } });
    const evaluation = await client.jobFilterEvaluation.findUniqueOrThrow({
      where: { jobId_userId: { jobId: job.id, userId: userAId } },
    });
    expect(updated.version).toBe(2);
    expect(isJobFilterEvaluationFresh(updated, job, evaluation)).toBe(false);
  });

  it("runs bounded version-bound scans and rejects a cursor after another profile edit", async () => {
    await createAuthoritativeJob("bounded-scan", {
      sourceUrl: `https://jobs.example.test/opening/bounded-scan-${run}`,
    });
    const cursorWithExtraData = Buffer.from(
      JSON.stringify({ lastJobId: "job", profileVersion: 2, unexpected: true }),
      "utf8",
    ).toString("base64url");
    await expect(
      scanJobsWithHardFilters(userAId, { cursor: cursorWithExtraData, pageSize: 1 }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const firstPage = await scanJobsWithHardFilters(userAId, { pageSize: 1 });
    expect(firstPage.processedJobs).toBe(1);
    expect(firstPage.nextCursor).toBeTruthy();
    const current = await client.jobFilterProfile.findUniqueOrThrow({ where: { userId: userAId } });
    const updated = await saveJobFilterProfile(userAId, {
      expectedVersion: current.version,
      configuration: filterConfiguration("110000"),
    });
    await expect(
      scanJobsWithHardFilters(userAId, { cursor: firstPage.nextCursor, pageSize: 1 }),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    const completed = await scanJobsWithHardFilters(userAId, { pageSize: 50 }, updated.version);
    expect(completed.processedJobs).toBeGreaterThan(0);
  });

  it("keeps repeated evaluation state-idempotent", async () => {
    const jobId = jobIds[0]!;
    const before = await client.jobFilterEvaluation.findUniqueOrThrow({
      where: { jobId_userId: { jobId, userId: userAId } },
    });
    const eventCount = await client.jobFilterEvent.count({ where: { userId: userAId, jobId } });
    const first = await reevaluateJobHardFilters(userAId, jobId);
    const second = await reevaluateJobHardFilters(userAId, jobId);
    expect(first?.id).toBe(before.id);
    expect(second?.evaluatedAt).toEqual(before.evaluatedAt);
    expect(await client.jobFilterEvent.count({ where: { userId: userAId, jobId } })).toBe(
      eventCount,
    );
  });

  it("reevaluates authoritative edits and selected-field reparses in the Job transaction", async () => {
    const jobId = jobIds[0]!;
    const current = await client.job.findUniqueOrThrow({ where: { id: jobId } });
    const updated = await updateJob(userAId, jobId, current.version, {
      ...persistedJobToValues(current),
      countryCode: "US",
    });
    let evaluation = await client.jobFilterEvaluation.findUniqueOrThrow({
      where: { jobId_userId: { jobId, userId: userAId } },
    });
    expect(evaluation).toMatchObject({ outcome: "FAIL", sourceJobVersion: updated.version });

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
        values: { ...correction.values, title: "Reparsed Platform Engineer" },
      },
    });
    const reparsed = await confirmJobParseDraft(userAId, draft.id, {
      expectedVersion: corrected.version,
      idempotencyKey: randomUUID(),
      reviewed: true,
      selectedFields: ["title"],
    });
    evaluation = await client.jobFilterEvaluation.findUniqueOrThrow({
      where: { jobId_userId: { jobId, userId: userAId } },
    });
    expect(evaluation.sourceJobVersion).toBe(reparsed.version);
    expect(evaluation.outcome).toBe("FAIL");
  });

  it("preserves evaluation on archive and refreshes it on restore", async () => {
    const jobId = jobIds[0]!;
    const current = await client.job.findUniqueOrThrow({ where: { id: jobId } });
    const before = await client.jobFilterEvaluation.findUniqueOrThrow({
      where: { jobId_userId: { jobId, userId: userAId } },
    });
    const archived = await transitionJob(userAId, jobId, {
      expectedVersion: current.version,
      targetStatus: "ARCHIVED",
    });
    const retained = await client.jobFilterEvaluation.findUniqueOrThrow({
      where: { id: before.id },
    });
    expect(retained.sourceJobVersion).toBe(before.sourceJobVersion);
    const restored = await transitionJob(userAId, jobId, {
      expectedVersion: archived.version,
      targetStatus: "ACTIVE",
    });
    const refreshed = await client.jobFilterEvaluation.findUniqueOrThrow({
      where: { id: before.id },
    });
    expect(refreshed.sourceJobVersion).toBe(restored.version);
  });

  it("serializes a concurrent Job edit and explicit evaluation to one current result", async () => {
    const jobId = jobIds[0]!;
    const current = await client.job.findUniqueOrThrow({ where: { id: jobId } });
    const results = await Promise.allSettled([
      updateJob(userAId, jobId, current.version, {
        ...persistedJobToValues(current),
        notes: `concurrent-${run}`,
      }),
      reevaluateJobHardFilters(userAId, jobId),
    ]);
    expect(results.every((result) => result.status === "fulfilled")).toBe(true);
    const finalJob = await client.job.findUniqueOrThrow({ where: { id: jobId } });
    const evaluation = await client.jobFilterEvaluation.findUniqueOrThrow({
      where: { jobId_userId: { jobId, userId: userAId } },
    });
    expect(evaluation.sourceJobVersion).toBe(finalJob.version);
  });

  it("rolls back a Job change, evaluation, and event together", async () => {
    const jobId = jobIds[0]!;
    const beforeJob = await client.job.findUniqueOrThrow({ where: { id: jobId } });
    const beforeEvaluation = await client.jobFilterEvaluation.findUniqueOrThrow({
      where: { jobId_userId: { jobId, userId: userAId } },
    });
    const beforeEvents = await client.jobFilterEvent.count({ where: { userId: userAId, jobId } });
    await expect(
      runSerializableTransaction(async (tx) => {
        await tx.job.update({
          where: { id_userId: { id: jobId, userId: userAId } },
          data: { countryCode: "PH", version: { increment: 1 } },
        });
        await evaluateJobHardFiltersInTransaction(tx, userAId, jobId, userAId);
        throw new Error("force rollback");
      }),
    ).rejects.toThrow("force rollback");
    expect((await client.job.findUniqueOrThrow({ where: { id: jobId } })).version).toBe(
      beforeJob.version,
    );
    expect(
      (await client.jobFilterEvaluation.findUniqueOrThrow({ where: { id: beforeEvaluation.id } }))
        .explanationHash,
    ).toBe(beforeEvaluation.explanationHash);
    expect(await client.jobFilterEvent.count({ where: { userId: userAId, jobId } })).toBe(
      beforeEvents,
    );
  });

  it("evaluates duplicate members independently and collapses counts to the explicit primary", async () => {
    const second = await createAuthoritativeJob("duplicate", { countryCode: "PH" });
    await scanJobsWithHardFilters(userAId, { pageSize: 50 });
    const candidate = await client.jobDuplicateCandidate.findFirstOrThrow({
      where: {
        userId: userAId,
        OR: [
          { jobAId: jobIds[0]!, jobBId: second.job.id },
          { jobAId: second.job.id, jobBId: jobIds[0]! },
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
      where: { userId: userAId, members: { some: { jobId: second.job.id } } },
    });
    const timestamps = await client.jobFilterEvaluation.findMany({
      where: { userId: userAId, jobId: { in: [candidate.jobAId, candidate.jobBId] } },
      select: { jobId: true, evaluatedAt: true },
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
      await client.jobFilterEvaluation.findMany({
        where: { userId: userAId, jobId: { in: [candidate.jobAId, candidate.jobBId] } },
        select: { jobId: true, evaluatedAt: true },
        orderBy: { jobId: "asc" },
      }),
    ).toEqual(timestamps);
    const profile = await client.jobFilterProfile.findUniqueOrThrow({ where: { userId: userAId } });
    const counts = await countPrimaryCollapsedFilterResults(userAId, profile.version, 1);
    expect(counts.considered).toBe(
      (await client.job.count({ where: { userId: userAId, status: "ACTIVE" } })) - 1,
    );
    const selectedPrimary = await client.job.findUniqueOrThrow({ where: { id: nextPrimary } });
    const retainedEvaluation = await client.jobFilterEvaluation.findUniqueOrThrow({
      where: { jobId_userId: { jobId: nextPrimary, userId: userAId } },
    });
    await transitionJob(userAId, nextPrimary, {
      expectedVersion: selectedPrimary.version,
      targetStatus: "ARCHIVED",
    });
    const archivedGroup = await client.jobDuplicateGroup.findUniqueOrThrow({
      where: { id_userId: { id: group.id, userId: userAId } },
    });
    expect(archivedGroup.primaryJobId).toBe(nextPrimary);
    expect(
      (
        await client.jobFilterEvaluation.findUniqueOrThrow({
          where: { jobId_userId: { jobId: nextPrimary, userId: userAId } },
        })
      ).explanationHash,
    ).toBe(retainedEvaluation.explanationHash);
    const archivedPrimary = await client.job.findUniqueOrThrow({ where: { id: nextPrimary } });
    await transitionJob(userAId, nextPrimary, {
      expectedVersion: archivedPrimary.version,
      targetStatus: "ACTIVE",
    });
    expect(
      await client.jobDuplicateGroup.findUniqueOrThrow({
        where: { id_userId: { id: group.id, userId: userAId } },
      }),
    ).toMatchObject({ primaryJobId: nextPrimary });
  });

  it("privacy-purges source content without copying it into filter records", async () => {
    const batchId = batchIds[0]!;
    await purgeDiscoveryImportBatch(userAId, batchId, {
      confirmation: expectedPurgeConfirmation(batchId),
    });
    const serialized = JSON.stringify(
      await client.jobFilterEvaluation.findMany({ where: { userId: userAId } }),
    );
    const events = JSON.stringify(
      await client.jobFilterEvent.findMany({ where: { userId: userAId } }),
    );
    expect(serialized).not.toContain("private raw description");
    expect(events).not.toContain("private raw description");
    expect(await client.job.count({ where: { userId: userAId } })).toBeGreaterThan(0);
  });

  it("preserves filter data on soft deletion and cascades it on practical hard deletion", async () => {
    const before = await client.jobFilterEvaluation.count({ where: { userId: userAId } });
    await setUserStatus(userAId, "DELETED", "HARD_FILTER_TEST");
    expect(await client.jobFilterEvaluation.count({ where: { userId: userAId } })).toBe(before);
    await setUserStatus(userAId, "ACTIVE", "HARD_FILTER_TEST_COMPLETE");

    const hardDeleteUserId = `filters-hard-delete-${run}`;
    await client.user.create({ data: { id: hardDeleteUserId } });
    await saveJobFilterProfile(hardDeleteUserId, {
      configuration: defaultJobFilterConfiguration(),
    });
    await client.user.delete({ where: { id: hardDeleteUserId } });
    expect(
      await client.jobFilterProfile.findUnique({ where: { userId: hardDeleteUserId } }),
    ).toBeNull();
    expect(await client.jobFilterEvent.count({ where: { userId: hardDeleteUserId } })).toBe(0);
  });
});
