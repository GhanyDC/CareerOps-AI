import Link from "next/link";

import { StatusBadge } from "@/components/status-badge";
import { listExperiences } from "@/modules/experiences/use-cases";
import { formatDate, humanizeEnum } from "@/modules/shared/presentation";
import { getRequestContext } from "@/server/request-context";

export const dynamic = "force-dynamic";

export default async function ExperiencesPage({
  searchParams,
}: {
  searchParams: Promise<{ deleted?: string }>;
}) {
  const { userId } = await getRequestContext();
  const [experiences, query] = await Promise.all([listExperiences(userId), searchParams]);

  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Experiences</p>
          <h1>Employment, academic, and independent work</h1>
        </div>
        <Link className="button primary" href="/experiences/new">
          Add experience
        </Link>
      </div>
      {query.deleted ? <div className="notice success">Experience deleted.</div> : null}
      <div className="record-list">
        {experiences.map((experience) => (
          <Link className="record-card" href={`/experiences/${experience.id}`} key={experience.id}>
            <div className="record-card-heading">
              <div>
                <span className="record-kicker">{humanizeEnum(experience.experienceType)}</span>
                <h2>{experience.title}</h2>
              </div>
              <StatusBadge value={experience.verificationStatus} />
            </div>
            <p>{experience.organization ?? "Independent"}</p>
            <div className="record-meta">
              <span>
                {formatDate(experience.startDate)} —{" "}
                {experience.currentlyActive ? "Present" : formatDate(experience.endDate)}
              </span>
              <span>{experience._count.evidenceItems} evidence items</span>
            </div>
          </Link>
        ))}
        {experiences.length === 0 ? (
          <div className="empty-state">
            No experiences yet. Add one before recording experience evidence.
          </div>
        ) : null}
      </div>
    </div>
  );
}
