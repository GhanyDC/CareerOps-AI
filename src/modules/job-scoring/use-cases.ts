import "server-only";

import type {
  Job,
  JobPreliminaryScore,
  JobScoringProfile,
  Prisma,
} from "@/generated/prisma/client";
import { recordAudit } from "@/modules/audit/public.server";
import { DomainError } from "@/modules/shared/errors";
import { runSerializableTransaction } from "@/server/db/transaction";

import {
  canonicalizeJobScoringConfiguration,
  evaluatePreliminaryJobScore,
  hashJobScoringConfiguration,
} from "./evaluator";
import {
  countActivePrimaryCollapsedJobs,
  getJobPreliminaryScoreRecord,
  getJobScoringProfileRecord,
  listActiveJobIdsForScoringScan,
  listJobScoringEvents,
  summarizePrimaryCollapsedScores,
} from "./repository";
import {
  JOB_SCORING_RULE_SET_VERSION,
  jobScoringConfigurationSchema,
  jobScoringExplanationSchema,
  jobScoringProfileMutationSchema,
  jobScoringScanCursorSchema,
  jobScoringScanInputSchema,
  type JobScoringConfiguration,
} from "./schemas";

function json(value: unknown) {
  return value as Prisma.InputJsonValue;
}

function eventMetadata(input: Record<string, unknown>) {
  return json({ schemaVersion: 1, ...input });
}

function enabledComponentIds(configuration: JobScoringConfiguration) {
  return Object.values(configuration.components)
    .filter((component) => component.enabled)
    .map((component) => component.componentId)
    .sort();
}

export function isPreliminaryJobScoreFresh(
  profile: Pick<JobScoringProfile, "version"> | null,
  job: Pick<Job, "version" | "status">,
  score: Pick<
    JobPreliminaryScore,
    "scoringProfileVersion" | "ruleSetVersion" | "sourceJobVersion"
  > | null,
) {
  if (job.status !== "ACTIVE") return false;
  return Boolean(
    profile &&
    score &&
    score.scoringProfileVersion === profile.version &&
    score.ruleSetVersion === JOB_SCORING_RULE_SET_VERSION &&
    score.sourceJobVersion === job.version,
  );
}

export async function viewJobScoringProfile(userId: string) {
  const profile = await getJobScoringProfileRecord(userId);
  if (!profile) return null;
  return {
    ...profile,
    configuration: jobScoringConfigurationSchema.parse(profile.configuration),
  };
}

export async function viewJobScoringSettings(userId: string) {
  const profile = await viewJobScoringProfile(userId);
  if (!profile) {
    const considered = await countActivePrimaryCollapsedJobs(userId);
    return {
      profile: null,
      events: [],
      summary: {
        high: 0,
        medium: 0,
        low: 0,
        noCoverage: 0,
        staleOrMissing: considered,
        considered,
        averageScore: 0,
      },
    };
  }
  const [summary, events] = await Promise.all([
    summarizePrimaryCollapsedScores(userId, profile.version, JOB_SCORING_RULE_SET_VERSION),
    listJobScoringEvents(userId, profile.id),
  ]);
  return { profile, summary, events };
}

export async function getJobScoringDashboardSummary(userId: string) {
  const profile = await getJobScoringProfileRecord(userId);
  if (!profile) {
    const considered = await countActivePrimaryCollapsedJobs(userId);
    return {
      configured: false as const,
      high: 0,
      medium: 0,
      low: 0,
      noCoverage: 0,
      staleOrMissing: considered,
      considered,
      averageScore: 0,
    };
  }
  return {
    configured: true as const,
    ...(await summarizePrimaryCollapsedScores(
      userId,
      profile.version,
      JOB_SCORING_RULE_SET_VERSION,
    )),
  };
}

export async function saveJobScoringProfile(userId: string, untrustedInput: unknown) {
  const parsed = jobScoringProfileMutationSchema.parse(untrustedInput);
  const configuration = canonicalizeJobScoringConfiguration(parsed.configuration);
  const configurationHash = hashJobScoringConfiguration(configuration);
  return runSerializableTransaction(async (tx) => {
    const current = await tx.jobScoringProfile.findUnique({ where: { userId } });
    if (!current) {
      if (parsed.expectedVersion !== undefined) {
        throw new DomainError(
          "Job scoring settings changed. Reload and try again.",
          "VERSION_CONFLICT",
        );
      }
      const created = await tx.jobScoringProfile.create({
        data: { userId, configuration: json(configuration), configurationHash },
      });
      await tx.jobScoringEvent.create({
        data: {
          userId,
          profileId: created.id,
          eventType: "PROFILE_CREATED",
          actorUserId: userId,
          scoringProfileVersion: created.version,
          safeMetadata: eventMetadata({
            configurationHash,
            enabledComponentIds: enabledComponentIds(configuration),
          }),
        },
      });
      await recordAudit(tx, {
        userId,
        entityType: "JOB_SCORING_PROFILE",
        entityId: created.id,
        action: "JOB_SCORING_PROFILE_CREATED",
        newState: {
          version: created.version,
          configurationHash,
          enabledComponentIds: enabledComponentIds(configuration),
        },
      });
      return created;
    }
    if (parsed.expectedVersion === undefined || current.version !== parsed.expectedVersion) {
      throw new DomainError(
        "Job scoring settings changed. Reload and try again.",
        "VERSION_CONFLICT",
      );
    }
    const rows = await tx.jobScoringProfile.updateMany({
      where: { id: current.id, userId, version: parsed.expectedVersion },
      data: {
        configuration: json(configuration),
        configurationHash,
        version: { increment: 1 },
      },
    });
    if (rows.count !== 1) {
      throw new DomainError(
        "Job scoring settings changed. Reload and try again.",
        "VERSION_CONFLICT",
      );
    }
    const updated = await tx.jobScoringProfile.findUniqueOrThrow({ where: { userId } });
    await tx.jobScoringEvent.create({
      data: {
        userId,
        profileId: updated.id,
        eventType: "PROFILE_UPDATED",
        actorUserId: userId,
        scoringProfileVersion: updated.version,
        safeMetadata: eventMetadata({
          previousConfigurationHash: current.configurationHash,
          configurationHash,
          enabledComponentIds: enabledComponentIds(configuration),
        }),
      },
    });
    await recordAudit(tx, {
      userId,
      entityType: "JOB_SCORING_PROFILE",
      entityId: updated.id,
      action: "JOB_SCORING_PROFILE_UPDATED",
      previousState: { version: current.version, configurationHash: current.configurationHash },
      newState: {
        version: updated.version,
        configurationHash,
        enabledComponentIds: enabledComponentIds(configuration),
      },
    });
    return updated;
  });
}

export async function scoreJobInTransaction(
  tx: Prisma.TransactionClient,
  userId: string,
  jobId: string,
  actorUserId: string | null = userId,
) {
  const profile = await tx.jobScoringProfile.findUnique({ where: { userId } });
  if (!profile) return null;
  const job = await tx.job.findUnique({ where: { id_userId: { id: jobId, userId } } });
  if (!job) throw new DomainError("Job not found.", "JOB_NOT_FOUND");
  if (job.status !== "ACTIVE") return null;
  const result = evaluatePreliminaryJobScore(profile.configuration, profile.version, job);
  const existing = await tx.jobPreliminaryScore.findUnique({
    where: { jobId_userId: { jobId, userId } },
  });
  if (
    existing &&
    existing.profileId === profile.id &&
    existing.score === result.score &&
    existing.coverage === result.coverage &&
    existing.ruleSetVersion === JOB_SCORING_RULE_SET_VERSION &&
    existing.scoringProfileVersion === profile.version &&
    existing.configurationHash === result.configurationHash &&
    existing.sourceJobVersion === job.version &&
    existing.explanationHash === result.explanationHash
  ) {
    return existing;
  }
  const scoredAt = new Date();
  const score = await tx.jobPreliminaryScore.upsert({
    where: { jobId_userId: { jobId, userId } },
    create: {
      userId,
      profileId: profile.id,
      jobId,
      score: result.score,
      coverage: result.coverage,
      ruleSetVersion: JOB_SCORING_RULE_SET_VERSION,
      scoringProfileVersion: profile.version,
      configurationHash: result.configurationHash,
      sourceJobVersion: job.version,
      explanation: json(result.explanation),
      explanationHash: result.explanationHash,
      scoredAt,
    },
    update: {
      profileId: profile.id,
      score: result.score,
      coverage: result.coverage,
      ruleSetVersion: JOB_SCORING_RULE_SET_VERSION,
      scoringProfileVersion: profile.version,
      configurationHash: result.configurationHash,
      sourceJobVersion: job.version,
      explanation: json(result.explanation),
      explanationHash: result.explanationHash,
      scoredAt,
    },
  });
  await tx.jobScoringEvent.create({
    data: {
      userId,
      profileId: profile.id,
      jobId,
      eventType: existing ? "JOB_RESCORED" : "JOB_SCORED",
      actorUserId,
      previousScore: existing?.score,
      newScore: result.score,
      previousCoverage: existing?.coverage,
      newCoverage: result.coverage,
      scoringProfileVersion: profile.version,
      sourceJobVersion: job.version,
      safeMetadata: eventMetadata({
        explanationHash: result.explanationHash,
        reasonCodes: result.explanation.componentResults
          .filter((component) => component.enabled)
          .map((component) => (component.enabled ? component.reasonCode : null))
          .filter(Boolean),
      }),
    },
  });
  return score;
}

export function rescoreJob(userId: string, jobId: string) {
  return runSerializableTransaction((tx) => scoreJobInTransaction(tx, userId, jobId, userId));
}

type ScanCursor = Readonly<{ lastJobId: string; profileVersion: number }>;

function encodeScanCursor(value: ScanCursor) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodeScanCursor(value: string): ScanCursor {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new DomainError("The scoring scan cursor is invalid.", "INVALID_INPUT");
  }
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
    return jobScoringScanCursorSchema.parse(parsed);
  } catch {
    throw new DomainError("The scoring scan cursor is invalid.", "INVALID_INPUT");
  }
}

export async function scanJobsWithPreliminaryScoring(
  userId: string,
  untrustedInput: unknown,
  expectedProfileVersion?: number,
) {
  const input = jobScoringScanInputSchema.parse(untrustedInput);
  const cursor = input.cursor ? decodeScanCursor(input.cursor) : undefined;
  const profile = await getJobScoringProfileRecord(userId);
  if (!profile) throw new DomainError("Configure Preliminary Job Scoring first.", "CONFLICT");
  const scanVersion = cursor?.profileVersion ?? expectedProfileVersion ?? profile.version;
  if (profile.version !== scanVersion) {
    throw new DomainError(
      "Scoring settings changed. Restart the bounded scan.",
      "VERSION_CONFLICT",
    );
  }
  const jobs = await listActiveJobIdsForScoringScan(userId, cursor?.lastJobId, input.pageSize);
  const page = jobs.slice(0, input.pageSize);
  for (const job of page) {
    await runSerializableTransaction(async (tx) => {
      const currentProfile = await tx.jobScoringProfile.findUnique({ where: { userId } });
      if (!currentProfile || currentProfile.version !== scanVersion) {
        throw new DomainError(
          "Scoring settings changed. Restart the bounded scan.",
          "VERSION_CONFLICT",
        );
      }
      await scoreJobInTransaction(tx, userId, job.id, userId);
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

export async function viewJobPreliminaryScore(userId: string, jobId: string) {
  const [profile, score] = await Promise.all([
    getJobScoringProfileRecord(userId),
    getJobPreliminaryScoreRecord(userId, jobId),
  ]);
  return {
    profile,
    score: score
      ? { ...score, explanation: jobScoringExplanationSchema.parse(score.explanation) }
      : null,
  };
}

export { summarizePrimaryCollapsedScores };
