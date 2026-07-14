"use client";

import { ConfirmSubmitButton, MutationForm } from "./form-controls";
import { transitionDiscoveryAction } from "@/modules/discovery/actions";

export function DiscoveryStatusActions({
  id,
  status,
  version,
}: {
  id: string;
  status: "INBOX" | "REJECTED" | "ARCHIVED";
  version: number;
}) {
  const action = (targetStatus: string, label: string, confirmation?: string) => (
    <MutationForm action={transitionDiscoveryAction}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="targetStatus" value={targetStatus} />
      <input type="hidden" name="expectedVersion" value={version} />
      {confirmation ? (
        <ConfirmSubmitButton confirmation={confirmation}>{label}</ConfirmSubmitButton>
      ) : (
        <button className="button primary" type="submit">
          {label}
        </button>
      )}
    </MutationForm>
  );

  return (
    <div className="button-row">
      {status === "INBOX"
        ? action("REJECTED", "Reject discovery", "Reject this raw discovery?")
        : null}
      {status === "INBOX" || status === "REJECTED"
        ? action("ARCHIVED", "Archive discovery", "Archive this raw discovery?")
        : null}
      {status === "REJECTED" || status === "ARCHIVED" ? action("INBOX", "Restore to inbox") : null}
    </div>
  );
}
