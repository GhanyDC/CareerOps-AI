import { ClaimForm, type ClaimFormValues } from "@/components/claim-form";
import { listVerifiedEvidenceOptions } from "@/modules/evidence/use-cases";
import { getRequestContext } from "@/server/request-context";

export const dynamic = "force-dynamic";

export default async function NewClaimPage({
  searchParams,
}: {
  searchParams: Promise<{ evidenceId?: string }>;
}) {
  const [{ userId }, query] = await Promise.all([getRequestContext(), searchParams]);
  const evidenceOptions = await listVerifiedEvidenceOptions(userId);
  const selectedEvidence = evidenceOptions.find((item) => item.id === query.evidenceId);
  const initial: ClaimFormValues = {
    evidenceItemId: selectedEvidence?.id ?? "",
    claimText: selectedEvidence?.claim ?? "",
    reviewerNotes: "",
    allowedForResume: false,
    allowedForCoverLetters: false,
    allowedForInterviews: false,
    allowedForRecruiterMessages: false,
  };

  return (
    <div className="page-stack narrow-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">New draft claim</p>
          <h1>Propose language from verified evidence</h1>
        </div>
      </div>
      {evidenceOptions.length === 0 ? (
        <div className="notice error">
          Verify at least one evidence item before drafting a claim.
        </div>
      ) : (
        <section className="panel">
          <ClaimForm mode="create" initial={initial} evidenceOptions={evidenceOptions} />
        </section>
      )}
    </div>
  );
}
