"use client";

import { useActionState, useState } from "react";

import { Field } from "./field";
import { ActionFeedback, MutationForm, SubmitButton } from "./form-controls";
import {
  confirmDiscoveryImportAction,
  previewDiscoveryImportAction,
  type DiscoveryImportActionState,
} from "@/modules/discovery/actions";

const initialDiscoveryImportState: DiscoveryImportActionState = { status: "idle" };

export function DiscoveryImportForm() {
  const [method, setMethod] = useState<"MANUAL_ENTRY" | "PASTED_TEXT" | "STRUCTURED_JSON">(
    "MANUAL_ENTRY",
  );
  const [editingPreviewToken, setEditingPreviewToken] = useState<string>();
  const [state, formAction] = useActionState(
    previewDiscoveryImportAction,
    initialDiscoveryImportState,
  );
  const preview = state.status === "preview" ? state : null;
  const activePreview = preview && editingPreviewToken !== preview.token ? preview : null;

  return (
    <div className="page-stack">
      <form className="form-stack panel" action={formAction} hidden={Boolean(activePreview)}>
        {state.status === "error" ? <ActionFeedback state={state} /> : null}
        <Field label="Import method">
          <select
            name="importMethod"
            value={method}
            onChange={(event) => setMethod(event.target.value as typeof method)}
          >
            <option value="MANUAL_ENTRY">Manual single entry</option>
            <option value="PASTED_TEXT">Pasted text (one discovery)</option>
            <option value="STRUCTURED_JSON">Structured JSON v1</option>
          </select>
        </Field>

        {method === "STRUCTURED_JSON" ? (
          <Field label="Structured JSON v1" hint="Strict schema; 1 to 20 discoveries">
            <textarea
              name="structuredJson"
              rows={18}
              defaultValue={preview?.formValues.structuredJson ?? ""}
              required
            />
          </Field>
        ) : (
          <>
            <div className="form-grid two-columns">
              <Field label="Opportunity source" hint="For example LinkedIn or Company Careers">
                <input
                  name="sourceLabel"
                  maxLength={160}
                  defaultValue={preview?.formValues.sourceLabel ?? ""}
                />
              </Field>
              <Field label="Source URL">
                <input
                  name="sourceUrl"
                  type="url"
                  maxLength={2048}
                  defaultValue={preview?.formValues.sourceUrl ?? ""}
                />
              </Field>
              <Field label="Job title hint" hint="User-provided and unverified">
                <input
                  name="titleHint"
                  maxLength={200}
                  defaultValue={preview?.formValues.titleHint ?? ""}
                />
              </Field>
              <Field label="Company hint" hint="User-provided and unverified">
                <input
                  name="companyHint"
                  maxLength={200}
                  defaultValue={preview?.formValues.companyHint ?? ""}
                />
              </Field>
              <Field label="Location hint" hint="User-provided and unverified">
                <input
                  name="locationHint"
                  maxLength={200}
                  defaultValue={preview?.formValues.locationHint ?? ""}
                />
              </Field>
              <Field label="Discovered at" hint="Optional RFC 3339 timestamp with timezone">
                <input
                  name="discoveredAt"
                  placeholder="2026-07-13T08:00:00Z"
                  maxLength={35}
                  defaultValue={preview?.formValues.discoveredAt ?? ""}
                />
              </Field>
            </div>
            <Field
              label={
                method === "PASTED_TEXT" ? "Pasted discovery text" : "Raw job description or notes"
              }
              hint="Stored as untrusted plain text; one discovery only"
            >
              <textarea
                name="rawText"
                rows={16}
                defaultValue={preview?.formValues.rawText ?? ""}
                required
              />
            </Field>
          </>
        )}
        <div className="notice">
          Review for accidentally pasted secrets or private information. Nothing is stored until you
          explicitly confirm the preview.
        </div>
        <div className="form-actions">
          <SubmitButton>Preview import</SubmitButton>
        </div>
      </form>

      {activePreview ? (
        <section className="panel page-stack" aria-live="polite">
          <div>
            <p className="eyebrow">Validated preview</p>
            <h2>{activePreview.items.length} raw discovery record(s)</h2>
            <p>
              Producer: {activePreview.producerLabel}. These values are not parsed, inferred, or
              verified.
            </p>
          </div>
          {activePreview.items.map((item, index) => (
            <article className="preview-card" key={index}>
              <h3>Discovery {index + 1}</h3>
              <dl className="details-list">
                <div>
                  <dt>Title hint</dt>
                  <dd>{item.titleHint ?? "Not provided"} (unverified)</dd>
                </div>
                <div>
                  <dt>Company hint</dt>
                  <dd>{item.companyHint ?? "Not provided"} (unverified)</dd>
                </div>
                <div>
                  <dt>Source</dt>
                  <dd>{item.sourceLabel ?? "Not provided"}</dd>
                </div>
                <div>
                  <dt>URL</dt>
                  <dd>{item.submittedUrl ?? "Not provided"}</dd>
                </div>
              </dl>
              <pre className="raw-content">{item.rawContent}</pre>
            </article>
          ))}
          <div className="button-row">
            <button
              className="button secondary"
              type="button"
              onClick={() => setEditingPreviewToken(activePreview.token)}
            >
              Return to edit
            </button>
            <MutationForm action={confirmDiscoveryImportAction}>
              <input type="hidden" name="previewToken" value={activePreview.token} />
              <SubmitButton>Confirm import</SubmitButton>
            </MutationForm>
          </div>
        </section>
      ) : null}
    </div>
  );
}
