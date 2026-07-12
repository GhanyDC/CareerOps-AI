"use client";

import type { ReactNode } from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { initialActionState, type ActionState } from "@/modules/shared/action-state";

type MutationAction = (previousState: ActionState, formData: FormData) => Promise<ActionState>;

export function MutationForm({
  action,
  children,
  className,
}: {
  action: MutationAction;
  children: ReactNode;
  className?: string;
}) {
  const [state, formAction] = useActionState(action, initialActionState);
  return (
    <form action={formAction} className={className}>
      <ActionFeedback state={state} />
      {children}
    </form>
  );
}

export function SubmitButton({ children = "Save" }: { children?: string }) {
  const { pending } = useFormStatus();
  return (
    <button className="button primary" type="submit" disabled={pending}>
      {pending ? "Saving…" : children}
    </button>
  );
}

export function ConfirmSubmitButton({
  children,
  confirmation,
  tone = "danger",
}: {
  children: string;
  confirmation: string;
  tone?: "danger" | "primary" | "secondary";
}) {
  const { pending } = useFormStatus();
  return (
    <button
      className={`button ${tone}`}
      type="submit"
      disabled={pending}
      onClick={(event) => {
        if (!window.confirm(confirmation)) event.preventDefault();
      }}
    >
      {pending ? "Working…" : children}
    </button>
  );
}

export function ActionFeedback({ state }: { state: ActionState }) {
  if (state.status !== "error") return null;
  const errors = Object.entries(state.fieldErrors ?? {}).flatMap(([field, messages]) =>
    messages.map((message) => `${field}: ${message}`),
  );

  return (
    <div className="notice error" role="alert">
      <strong>{state.message ?? "The form could not be saved."}</strong>
      {errors.length > 0 ? (
        <ul>
          {errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
