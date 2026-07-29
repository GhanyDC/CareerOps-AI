"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { GroundedRetrievalResults } from "./grounded-retrieval-results";
import { searchRetrievalAction, type RetrievalSearchState } from "@/modules/retrieval/actions";
import {
  DEFAULT_RETRIEVAL_TOP_K,
  MAX_RETRIEVAL_QUERY_LENGTH,
  MAX_RETRIEVAL_TOP_K,
} from "@/modules/retrieval/public";

function SearchButton() {
  const { pending } = useFormStatus();
  return (
    <button className="button primary" disabled={pending} type="submit">
      {pending ? "Searching…" : "Search Candidate Evidence"}
    </button>
  );
}

export function RetrievalSearchForm() {
  const initialState: RetrievalSearchState = { status: "idle" };
  const [state, action] = useActionState(searchRetrievalAction, initialState);
  return (
    <div className="page-stack">
      <form action={action} className="panel form-stack">
        <div>
          <h2>User-authored grounded search</h2>
          <p>
            Query text is bounded retrieval data. It is not executed as an instruction and is not
            persisted; only its SHA-256 hash enters compact diagnostics.
          </p>
        </div>
        {state.status === "error" ? (
          <div className="notice error" role="alert">
            <strong>{state.message ?? "Search could not be completed."}</strong>
            {Object.entries(state.fieldErrors ?? {}).flatMap(([field, messages]) =>
              messages.map((message) => <div key={`${field}-${message}`}>{message}</div>),
            )}
          </div>
        ) : null}
        <label className="field">
          <span>Search query</span>
          <textarea
            name="query"
            maxLength={MAX_RETRIEVAL_QUERY_LENGTH}
            placeholder="What evidence demonstrates Odoo automation experience?"
            required
            rows={3}
          />
        </label>
        <label className="field">
          <span>Maximum retrieved records</span>
          <input
            type="number"
            name="topK"
            min={1}
            max={MAX_RETRIEVAL_TOP_K}
            defaultValue={DEFAULT_RETRIEVAL_TOP_K}
          />
        </label>
        <SearchButton />
      </form>
      {state.status === "success" && state.packet ? (
        <GroundedRetrievalResults packet={state.packet} />
      ) : null}
    </div>
  );
}
