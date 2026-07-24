"use client";

import { scanJobScoringAction } from "@/modules/job-scoring/actions";

import { MutationForm, SubmitButton } from "./form-controls";

export function JobScoringScanForm({ cursor }: { cursor: string }) {
  return (
    <MutationForm action={scanJobScoringAction}>
      <input type="hidden" name="cursor" value={cursor} />
      <SubmitButton>Continue bounded scoring</SubmitButton>
    </MutationForm>
  );
}
