import Link from "next/link";
import { notFound } from "next/navigation";

import { ConfirmSubmitButton, MutationForm } from "@/components/form-controls";
import { ProjectForm, type ProjectFormValues } from "@/components/project-form";
import { StatusBadge } from "@/components/status-badge";
import { deleteProjectAction } from "@/modules/projects/actions";
import { viewProject } from "@/modules/projects/use-cases";
import { DomainError } from "@/modules/shared/errors";
import { dateInputValue, listInputValue } from "@/modules/shared/presentation";
import { getRequestContext } from "@/server/request-context";

export const dynamic = "force-dynamic";

export default async function ProjectDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const [{ id }, query, { userId }] = await Promise.all([
    params,
    searchParams,
    getRequestContext(),
  ]);
  let project;
  try {
    project = await viewProject(userId, id);
  } catch (error) {
    if (error instanceof DomainError) notFound();
    throw error;
  }

  const initial: ProjectFormValues = {
    id: project.id,
    name: project.name,
    shortDescription: project.shortDescription ?? "",
    problemAddressed: project.problemAddressed ?? "",
    candidateRole: project.candidateRole ?? "",
    responsibilities: listInputValue(project.responsibilities),
    technologies: listInputValue(project.technologies),
    skills: listInputValue(project.skills),
    challenges: listInputValue(project.challenges),
    actionsTaken: listInputValue(project.actionsTaken),
    outcomes: listInputValue(project.outcomes),
    quantifiedResults: listInputValue(project.quantifiedResults),
    relevantRoleFamilies: listInputValue(project.relevantRoleFamilies),
    projectUrl: project.projectUrl ?? "",
    repositoryUrl: project.repositoryUrl ?? "",
    startDate: dateInputValue(project.startDate),
    endDate: dateInputValue(project.endDate),
  };

  return (
    <div className="page-stack narrow-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Project</p>
          <h1>{project.name}</h1>
        </div>
        <StatusBadge value={project.verificationStatus} />
      </div>
      {query.saved ? <div className="notice success">Project saved.</div> : null}
      <div className="button-row">
        <Link
          className="button secondary"
          href={`/evidence/new?sourceType=PROJECT&sourceId=${project.id}`}
        >
          Add evidence from this project
        </Link>
      </div>
      {project.evidenceItems.length > 0 ? (
        <div className="notice">
          This project supports verified evidence. Revoke dependent evidence verification before
          changing any authoritative project details.
        </div>
      ) : null}
      <section className="panel">
        <ProjectForm mode="update" initial={initial} />
      </section>
      <section className="panel danger-zone">
        <h2>Delete project</h2>
        {project._count.evidenceItems > 0 ? (
          <p>
            Deletion is blocked because {project._count.evidenceItems} evidence item(s) depend on
            this source.
          </p>
        ) : (
          <MutationForm action={deleteProjectAction}>
            <input type="hidden" name="id" value={project.id} />
            <ConfirmSubmitButton confirmation="Delete this project? This cannot be undone.">
              Delete project
            </ConfirmSubmitButton>
          </MutationForm>
        )}
      </section>
    </div>
  );
}
