import { ExperienceForm, type ExperienceFormValues } from "@/components/experience-form";

export default function NewExperiencePage() {
  const initial: ExperienceFormValues = {
    title: "",
    organization: "",
    experienceType: "EMPLOYMENT",
    location: "",
    workSetup: "",
    startDate: "",
    endDate: "",
    currentlyActive: false,
    summary: "",
    responsibilities: "",
    technologies: "",
    skills: "",
    outcomes: "",
    sourceNotes: "",
  };

  return (
    <div className="page-stack narrow-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">New experience</p>
          <h1>Add an authoritative experience source</h1>
        </div>
      </div>
      <section className="panel">
        <ExperienceForm mode="create" initial={initial} />
      </section>
    </div>
  );
}
