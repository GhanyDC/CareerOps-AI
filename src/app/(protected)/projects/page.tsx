import Link from "next/link";

import { StatusBadge } from "@/components/status-badge";
import { listProjects } from "@/modules/projects/use-cases";
import { getRequestContext } from "@/server/request-context";

export const dynamic = "force-dynamic";

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ deleted?: string }>;
}) {
  const { userId } = await getRequestContext();
  const [projects, query] = await Promise.all([listProjects(userId), searchParams]);

  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Projects</p>
          <h1>Built systems and demonstrated outcomes</h1>
        </div>
        <Link className="button primary" href="/projects/new">
          Add project
        </Link>
      </div>
      {query.deleted ? <div className="notice success">Project deleted.</div> : null}
      <div className="record-list">
        {projects.map((project) => (
          <Link className="record-card" href={`/projects/${project.id}`} key={project.id}>
            <div className="record-card-heading">
              <div>
                <span className="record-kicker">{project.candidateRole ?? "Project"}</span>
                <h2>{project.name}</h2>
              </div>
              <StatusBadge value={project.verificationStatus} />
            </div>
            <p>{project.shortDescription ?? "No short description yet."}</p>
            <div className="tag-row">
              {project.technologies.slice(0, 5).map((technology) => (
                <span className="tag" key={technology}>
                  {technology}
                </span>
              ))}
            </div>
            <div className="record-meta">
              <span>
                {project.relevantRoleFamilies.join(" · ") || "No role families specified"}
              </span>
              <span>{project._count.evidenceItems} evidence items</span>
            </div>
          </Link>
        ))}
        {projects.length === 0 ? <div className="empty-state">No projects yet.</div> : null}
      </div>
    </div>
  );
}
