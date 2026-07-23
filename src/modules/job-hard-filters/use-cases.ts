import "server-only";

import type { Job, JobFilterEvaluation, JobFilterProfile, Prisma } from "@/generated/prisma/client";
import { recordAudit } from "@/modules/audit/public.server";
import { DomainError } from "@/modules/shared/errors";
import { runSerializableTransaction } from "@/server/db/transaction";

import {
  canonicalizeJobFilterConfiguration,
  evaluateJobHardFilters,
  hashJobFilterConfiguration,
} from "./evaluator";
import {
  countActivePrimaryCollapsedJobs,
  countPrimaryCollapsedFilterResults,
  getJobFilterEvaluationRecord,
  getJobFilterProfileRecord,
  listActiveJobIdsForFilterScan,
  listJobFilterEvents,
} from "./repository";
import {
  JOB_FILTER_RULE_SET_VERSION,
  jobFilterConfigurationSchema,
  jobFilterExplanationSchema,
  jobFilterProfileMutationSchema,
  jobFilterScanCursorSchema,
  jobFilterScanInputSchema,
  type JobFilterConfiguration,
} from "./schemas";

function json(value: unknown) {
  return value as Prisma.InputJsonValue;
}

function eventMetadata(input: Record<string, unknown>) {
  return json({ schemaVersion: 1, ...input });
}

function enabledRuleIds(configuration: JobFilterConfiguration) {
  return Object.values(configuration.rules)
    .filter((rule) => rule.enabled)
    .map((rule) => rule.ruleId)
    .sort();
}

export function isJobFilterEvaluationFresh(
  profile: Pick<JobFilterProfile, "version"> | null,
  job: Pick<Job, "version" | "status">,
  evaluation: Pick<
    JobFilterEvaluation,
    "filterProfileVersion" | "ruleSetVersion" | "sourceJobVersion"
  > | null,
) {
  if (job.status !== "ACTIVE") return false;
  return Boolean(
    profile &&
    evaluation &&
    evaluation.filterProfileVersion === profile.version &&
    evaluation.ruleSetVersion === JOB_FILTER_RULE_SET_VERSION &&
    evaluation.sourceJobVersion === job.version,
  );
}

export async function viewJobFilterProfile(userId: string) {
  const profile = await getJobFilterProfileRecord(userId);
  if (!profile) return null;
  return {
    ...profile,
    configuration: jobFilterConfigurationSchema.parse(profile.configuration),
  };
}

export async function viewJobFilterSettings(userId: string) {
  const profile = await viewJobFilterProfile(userId);
  if (!profile) {
    const considered = await countActivePrimaryCollapsedJobs(userId);
    return {
      profile: null,
      events: [],
      counts: {
        pass: 0,
        fail: 0,
        needsReview: 0,
        staleOrMissing: considered,
        considered,
      },
    };
  }
  const [counts, events] = await Promise.all([
    countPrimaryCollapsedFilterResults(userId, profile.version, JOB_FILTER_RULE_SET_VERSION),
    listJobFilterEvents(userId, profile.id),
  ]);
  return { profile, counts, events };
}

export async function getJobFilterDashboardSummary(userId: string) {
  const profile = await getJobFilterProfileRecord(userId);
  if (!profile) {
    const considered = await countActivePrimaryCollapsedJobs(userId);
    return {
      configured: false as const,
      pass: 0,
      fail: 0,
      needsReview: 0,
      staleOrMissing: considered,
      considered,
    };
  }
  return {
    configured: true as const,
    ...(await countPrimaryCollapsedFilterResults(
      userId,
      profile.version,
      JOB_FILTER_RULE_SET_VERSION,
    )),
  };
}

export async function saveJobFilterProfile(userId: string, untrustedInput: unknown) {
  const parsed = jobFilterProfileMutationSchema.parse(untrustedInput);
  const configuration = canonicalizeJobFilterConfiguration(parsed.configuration);
  const configurationHash = hashJobFilterConfiguration(configuration);
  return runSerializableTransaction(async (tx) => {
    const current = await tx.jobFilterProfile.findUnique({ where: { userId } });
    if (!current) {
      if (parsed.expectedVersion !== undefined) {
        throw new DomainError(
          "Job filter settings changed. Reload and try again.",
          "VERSION_CONFLICT",
        );
      }
      const created = await tx.jobFilterProfile.create({
        data: { userId, configuration: json(configuration), configurationHash },
      });
      await tx.jobFilterEvent.create({
        data: {
          userId,
          profileId: created.id,
          eventType: "PROFILE_CREATED",
          actorUserId: userId,
          filterProfileVersion: created.version,
          safeMetadata: eventMetadata({
            configurationHash,
            enabledRuleIds: enabledRuleIds(configuration),
          }),
        },
      });
      await recordAudit(tx, {
        userId,
        entityType: "JOB_FILTER_PROFILE",
        entityId: created.id,
        action: "JOB_FILTER_PROFILE_CREATED",
        newState: {
          version: created.version,
          configurationHash,
          enabledRuleIds: enabledRuleIds(configuration),
        },
      });
      return created;
    }
    if (parsed.expectedVersion === undefined || current.version !== parsed.expectedVersion) {
      throw new DomainError(
        "Job filter settings changed. Reload and try again.",
        "VERSION_CONFLICT",
      );
    }
    const rows = await tx.jobFilterProfile.updateMany({
      where: { id: current.id, userId, version: parsed.expectedVersion },
      data: {
        configuration: json(configuration),
        configurationHash,
        version: { increment: 1 },
      },
    });
    if (rows.count !== 1) {
      throw new DomainError(
        "Job filter settings changed. Reload and try again.",
        "VERSION_CONFLICT",
      );
    }
    const updated = await tx.jobFilterProfile.findUniqueOrThrow({ where: { userId } });
    await tx.jobFilterEvent.create({
      data: {
        userId,
        profileId: updated.id,
        eventType: "PROFILE_UPDATED",
        actorUserId: userId,
        filterProfileVersion: updated.version,
        safeMetadata: eventMetadata({
          previousConfigurationHash: current.configurationHash,
          configurationHash,
          enabledRuleIds: enabledRuleIds(configuration),
        }),
      },
    });
    await recordAudit(tx, {
      userId,
      entityType: "JOB_FILTER_PROFILE",
      entityId: updated.id,
      action: "JOB_FILTER_PROFILE_UPDATED",
      previousState: { version: current.version, configurationHash: current.configurationHash },
      newState: {
        version: updated.version,
        configurationHash,
        enabledRuleIds: enabledRuleIds(configuration),
      },
    });
    return updated;
  });
}

export async function evaluateJobHardFiltersInTransaction(
  tx: Prisma.TransactionClient,
  userId: string,
  jobId: string,
  actorUserId: string | null = userId,
) {
  const profile = await tx.jobFilterProfile.findUnique({ where: { userId } });
  if (!profile) return null;
  const job = await tx.job.findUnique({ where: { id_userId: { id: jobId, userId } } });
  if (!job) throw new DomainError("Job not found.", "JOB_NOT_FOUND");
  if (job.status !== "ACTIVE") return null;
  const result = evaluateJobHardFilters(profile.configuration, profile.version, job);
  const existing = await tx.jobFilterEvaluation.findUnique({
    where: { jobId_userId: { jobId, userId } },
  });
  if (
    existing &&
    existing.profileId === profile.id &&
    existing.outcome === result.outcome &&
    existing.ruleSetVersion === JOB_FILTER_RULE_SET_VERSION &&
    existing.filterProfileVersion === profile.version &&
    existing.configurationHash === result.configurationHash &&
    existing.sourceJobVersion === job.version &&
    existing.explanationHash === result.explanationHash
  ) {
    return existing;
  }
  const evaluatedAt = new Date();
  const evaluation = await tx.jobFilterEvaluation.upsert({
    where: { jobId_userId: { jobId, userId } },
    create: {
      userId,
      profileId: profile.id,
      jobId,
      outcome: result.outcome,
      ruleSetVersion: JOB_FILTER_RULE_SET_VERSION,
      filterProfileVersion: profile.version,
      configurationHash: result.configurationHash,
      sourceJobVersion: job.version,
      explanation: json(result.explanation),
      explanationHash: result.explanationHash,
      evaluatedAt,
    },
    update: {
      profileId: profile.id,
      outcome: result.outcome,
      ruleSetVersion: JOB_FILTER_RULE_SET_VERSION,
      filterProfileVersion: profile.version,
      configurationHash: result.configurationHash,
      sourceJobVersion: job.version,
      explanation: json(result.explanation),
      explanationHash: result.explanationHash,
      evaluatedAt,
    },
  });
  await tx.jobFilterEvent.create({
    data: {
      userId,
      profileId: profile.id,
      jobId,
      eventType: existing ? "JOB_REEVALUATED" : "JOB_EVALUATED",
      actorUserId,
      previousOutcome: existing?.outcome,
      newOutcome: result.outcome,
      filterProfileVersion: profile.version,
      sourceJobVersion: job.version,
      safeMetadata: eventMetadata({
        explanationHash: result.explanationHash,
        reasonCodes: result.explanation.ruleResults
          .filter((rule) => rule.enabled)
          .map((rule) => (rule.enabled ? rule.reasonCode : null))
          .filter(Boolean),
      }),
    },
  });
  return evaluation;
}

export function reevaluateJobHardFilters(userId: string, jobId: string) {
  return runSerializableTransaction((tx) =>
    evaluateJobHardFiltersInTransaction(tx, userId, jobId, userId),
  );
}

type ScanCursor = Readonly<{ lastJobId: string; profileVersion: number }>;

function encodeScanCursor(value: ScanCursor) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodeScanCursor(value: string): ScanCursor {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new DomainError("The filter scan cursor is invalid.", "INVALID_INPUT");
  }
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
    return jobFilterScanCursorSchema.parse(parsed);
  } catch {
    throw new DomainError("The filter scan cursor is invalid.", "INVALID_INPUT");
  }
}

export async function scanJobsWithHardFilters(
  userId: string,
  untrustedInput: unknown,
  expectedProfileVersion?: number,
) {
  const input = jobFilterScanInputSchema.parse(untrustedInput);
  const cursor = input.cursor ? decodeScanCursor(input.cursor) : undefined;
  const profile = await getJobFilterProfileRecord(userId);
  if (!profile) throw new DomainError("Configure Job Hard Filters first.", "CONFLICT");
  const scanVersion = cursor?.profileVersion ?? expectedProfileVersion ?? profile.version;
  if (profile.version !== scanVersion) {
    throw new DomainError("Filter settings changed. Restart the bounded scan.", "VERSION_CONFLICT");
  }
  const jobs = await listActiveJobIdsForFilterScan(userId, cursor?.lastJobId, input.pageSize);
  const page = jobs.slice(0, input.pageSize);
  for (const job of page) {
    await runSerializableTransaction(async (tx) => {
      const currentProfile = await tx.jobFilterProfile.findUnique({ where: { userId } });
      if (!currentProfile || currentProfile.version !== scanVersion) {
        throw new DomainError(
          "Filter settings changed. Restart the bounded scan.",
          "VERSION_CONFLICT",
        );
      }
      await evaluateJobHardFiltersInTransaction(tx, userId, job.id, userId);
    });
  }
  return {
    processedJobs: page.length,
    profileVersion: scanVersion,
    nextCursor:
      jobs.length > input.pageSize && page.at(-1)
        ? encodeScanCursor({ lastJobId: page.at(-1)!.id, profileVersion: scanVersion })
        : undefined,
  };
}

export async function viewJobFilterEvaluation(userId: string, jobId: string) {
  const [profile, evaluation] = await Promise.all([
    getJobFilterProfileRecord(userId),
    getJobFilterEvaluationRecord(userId, jobId),
  ]);
  return {
    profile,
    evaluation: evaluation
      ? { ...evaluation, explanation: jobFilterExplanationSchema.parse(evaluation.explanation) }
      : null,
  };
}

export { countPrimaryCollapsedFilterResults };
