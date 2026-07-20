import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";

import { DuplicatePrimaryForm } from "@/components/duplicate-primary-form";
import { StatusBadge } from "@/components/status-badge";
import { viewDuplicateGroup } from "@/modules/job-duplicates/use-cases";
import { DomainError } from "@/modules/shared/errors";
import { getRequestContext } from "@/server/request-context";

export const dynamic = "force-dynamic";

export default async function DuplicateGroupPage({
  params,
  searchParams,
}: {
  params: Promise<{ groupId: string }>;
  searchParams: Promise<{ primaryChanged?: string }>;
}) {
  const [{ groupId }, query, { userId }] = await Promise.all([
    params,
    searchParams,
    getRequestContext(),
  ]);
  let group;
  try {
    group = await viewDuplicateGroup(userId, groupId);
  } catch (error) {
    if (error instanceof DomainError && error.code === "DUPLICATE_GROUP_NOT_FOUND") notFound();
    throw error;
  }

  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Non-destructive duplicate group</p>
          <h1>Confirmed same opportunity</h1>
          <p>Every authoritative Job and its provenance remain stored.</p>
        </div>
        <StatusBadge value="SAME_OPPORTUNITY" />
      </div>
      {query.primaryChanged ? (
        <div className="notice success">Primary Job selection updated.</div>
      ) : null}
      <section className="panel page-stack">
        <h2>Group members</h2>
        {group.members.map((member) => (
          <article className="record-card" key={member.jobId}>
            <div className="record-card-heading">
              <div>
                <h3>{member.job.title}</h3>
                <p>{member.job.companyName ?? "Company not provided"}</p>
              </div>
              <StatusBadge
                value={member.jobId === group.primaryJobId ? "PRIMARY" : member.job.status}
              />
            </div>
            <Link className="button secondary" href={`/jobs/${member.jobId}`}>
              Open authoritative Job
            </Link>
          </article>
        ))}
      </section>
      <DuplicatePrimaryForm
        groupId={group.id}
        version={group.version}
        primaryJobId={group.primaryJobId}
        idempotencyKey={randomUUID()}
        jobs={group.members.map((member) => member.job)}
      />
    </div>
  );
}
