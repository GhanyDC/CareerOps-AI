import {
  CandidateProfileForm,
  type CandidateProfileFormValues,
} from "@/components/candidate-profile-form";
import { viewCandidateProfile } from "@/modules/candidate-profile/use-cases";
import { listInputValue } from "@/modules/shared/presentation";
import { getRequestContext } from "@/server/request-context";

export const dynamic = "force-dynamic";

export default async function CandidateProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string }>;
}) {
  const { userId } = await getRequestContext();
  const profile = await viewCandidateProfile(userId);
  const { saved } = await searchParams;
  const initial: CandidateProfileFormValues = {
    fullName: profile?.fullName ?? "",
    professionalHeadline: profile?.professionalHeadline ?? "",
    careerSummary: profile?.careerSummary ?? "",
    preferredRoleFamilies: listInputValue(profile?.preferredRoleFamilies),
    preferredLocations: listInputValue(profile?.preferredLocations),
    acceptedWorkArrangements: listInputValue(profile?.acceptedWorkArrangements),
    acceptedEmploymentTypes: listInputValue(profile?.acceptedEmploymentTypes),
    schedulePreferences: listInputValue(profile?.schedulePreferences),
    nightShiftAcceptance:
      profile?.nightShiftAcceptance === true
        ? "true"
        : profile?.nightShiftAcceptance === false
          ? "false"
          : "",
    relocationPreference: profile?.relocationPreference ?? "",
    salaryCurrency: profile?.salaryCurrency ?? "",
    salaryMinimum: profile?.salaryMinimum?.toString() ?? "",
    salaryNotes: profile?.salaryNotes ?? "",
    careerGoals: profile?.careerGoals ?? "",
    dostReturnServiceNotes: profile?.dostReturnServiceNotes ?? "",
    applicationPreferences: profile?.applicationPreferences ?? "",
    hardExclusions: listInputValue(profile?.hardExclusions),
  };

  return (
    <div className="page-stack narrow-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Candidate Profile</p>
          <h1>Authoritative candidate facts and preferences</h1>
        </div>
      </div>
      {saved ? <div className="notice success">Candidate profile saved.</div> : null}
      <section className="panel">
        <CandidateProfileForm initial={initial} />
      </section>
    </div>
  );
}
