import Link from "next/link";
import { notFound } from "next/navigation";

import { ExperienceForm, type ExperienceFormValues } from "@/components/experience-form";
import { ConfirmSubmitButton, MutationForm } from "@/components/form-controls";
import { StatusBadge } from "@/components/status-badge";
import { deleteExperienceAction } from "@/modules/experiences/actions";
import { viewExperience } from "@/modules/experiences/use-cases";
import { DomainError } from "@/modules/shared/errors";
import { dateInputValue, listInputValue } from "@/modules/shared/presentation";
import { getRequestContext } from "@/server/request-context";

export const dynamic = "force-dynamic";

export default async function ExperienceDetailPage({
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
  let experience;
  try {
    experience = await viewExperience(userId, id);
  } catch (error) {
    if (error instanceof DomainError) notFound();
    throw error;
  }

  const initial: ExperienceFormValues = {
    id: experience.id,
    title: experience.title,
    organization: experience.organization ?? "",
    experienceType: experience.experienceType,
    location: experience.location ?? "",
    workSetup: experience.workSetup ?? "",
    startDate: dateInputValue(experience.startDate),
    endDate: dateInputValue(experience.endDate),
    currentlyActive: experience.currentlyActive,
    summary: experience.summary ?? "",
    responsibilities: listInputValue(experience.responsibilities),
    technologies: listInputValue(experience.technologies),
    skills: listInputValue(experience.skills),
    outcomes: listInputValue(experience.outcomes),
    sourceNotes: experience.sourceNotes ?? "",
  };

  return (
    <div className="page-stack narrow-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Experience</p>
          <h1>{experience.title}</h1>
        </div>
        <StatusBadge value={experience.verificationStatus} />
      </div>
      {query.saved ? <div className="notice success">Experience saved.</div> : null}
      <div className="button-row">
        <Link
          className="button secondary"
          href={`/evidence/new?sourceType=EXPERIENCE&sourceId=${experience.id}`}
        >
          Add evidence from this experience
        </Link>
      </div>
      {experience.evidenceItems.length > 0 ? (
        <div className="notice">
          This experience supports verified evidence. Authoritative details are locked until that
          evidence verification is revoked; source notes that do not change the facts may still be
          updated.
        </div>
      ) : null}
      <section className="panel">
        <ExperienceForm mode="update" initial={initial} />
      </section>
      <section className="panel danger-zone">
        <h2>Delete experience</h2>
        {experience._count.evidenceItems > 0 ? (
          <p>
            Deletion is blocked because {experience._count.evidenceItems} evidence item(s) depend on
            this source.
          </p>
        ) : (
          <MutationForm action={deleteExperienceAction}>
            <input type="hidden" name="id" value={experience.id} />
            <ConfirmSubmitButton confirmation="Delete this experience? This cannot be undone.">
              Delete experience
            </ConfirmSubmitButton>
          </MutationForm>
        )}
      </section>
    </div>
  );
}
