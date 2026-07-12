import {
  EvidenceForm,
  type EvidenceFormValues,
  type EvidenceSourceOption,
} from "@/components/evidence-form";
import { listExperienceOptions } from "@/modules/experiences/use-cases";
import { listProjectOptions } from "@/modules/projects/use-cases";
import { getRequestContext } from "@/server/request-context";

export const dynamic = "force-dynamic";

export default async function NewEvidencePage({
  searchParams,
}: {
  searchParams: Promise<{ sourceType?: string; sourceId?: string }>;
}) {
  const [{ userId }, query] = await Promise.all([getRequestContext(), searchParams]);
  const [experiences, projects] = await Promise.all([
    listExperienceOptions(userId),
    listProjectOptions(userId),
  ]);
  const sources: EvidenceSourceOption[] = [
    ...experiences.map((experience) => ({
      value: `EXPERIENCE:${experience.id}`,
      label: `Experience · ${experience.title}${experience.organization ? ` · ${experience.organization}` : ""}`,
    })),
    ...projects.map((project) => ({
      value: `PROJECT:${project.id}`,
      label: `Project · ${project.name}`,
    })),
  ];
  const requestedSource = `${query.sourceType ?? ""}:${query.sourceId ?? ""}`;
  const sourceReference = sources.some((source) => source.value === requestedSource)
    ? requestedSource
    : "";
  const initial: EvidenceFormValues = {
    sourceReference,
    claim: "",
    supportingContext: "",
    skillsDemonstrated: "",
    relevantRoleFamilies: "",
    evidenceStrength: "DIRECT",
    allowedForResume: false,
    allowedForCoverLetters: false,
    allowedForInterviews: false,
    allowedForRecruiterMessages: false,
    sourceNotes: "",
  };

  return (
    <div className="page-stack narrow-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">New evidence</p>
          <h1>Record one atomic, reusable fact</h1>
        </div>
      </div>
      <section className="panel">
        <EvidenceForm mode="create" initial={initial} sources={sources} />
      </section>
    </div>
  );
}
