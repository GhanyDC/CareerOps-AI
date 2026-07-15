"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import { ActionFeedback } from "./form-controls";
import { purgeDiscoveryImportBatchAction } from "@/modules/discovery/actions";
import { initialActionState } from "@/modules/shared/action-state";

function PurgeButton({ enabled }: { enabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button className="button danger" type="submit" disabled={!enabled || pending}>
      {pending ? "Purging…" : "Permanently purge import"}
    </button>
  );
}

export function DiscoveryPurgeForm({
  batchId,
  expectedPhrase,
}: {
  batchId: string;
  expectedPhrase: string;
}) {
  const [confirmation, setConfirmation] = useState("");
  const [state, formAction] = useActionState(purgeDiscoveryImportBatchAction, initialActionState);
  return (
    <form className="form-stack" action={formAction}>
      <ActionFeedback state={state} />
      <input type="hidden" name="batchId" value={batchId} />
      <p>
        This is only for accidental sensitive data. It permanently removes the batch, raw
        discoveries, and processing events while retaining one metadata-only audit.
      </p>
      <label className="field">
        <span>
          Type <strong>{expectedPhrase}</strong>
        </span>
        <input
          name="confirmation"
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
          autoComplete="off"
        />
      </label>
      <PurgeButton enabled={confirmation === expectedPhrase} />
    </form>
  );
}
