import { ProjectForm, type ProjectFormValues } from "@/components/project-form";

export default function NewProjectPage() {
  const initial: ProjectFormValues = {
    name: "",
    shortDescription: "",
    problemAddressed: "",
    candidateRole: "",
    responsibilities: "",
    technologies: "",
    skills: "",
    challenges: "",
    actionsTaken: "",
    outcomes: "",
    quantifiedResults: "",
    relevantRoleFamilies: "",
    projectUrl: "",
    repositoryUrl: "",
    startDate: "",
    endDate: "",
  };

  return (
    <div className="page-stack narrow-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">New project</p>
          <h1>Add a project source</h1>
        </div>
      </div>
      <section className="panel">
        <ProjectForm mode="create" initial={initial} />
      </section>
    </div>
  );
}
