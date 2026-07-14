import type { SafeActionErrorCode } from "./errors";

export type ActionState = Readonly<{
  status: "idle" | "error";
  code?: SafeActionErrorCode;
  message?: string;
  fieldErrors?: Record<string, string[]>;
}>;

export const initialActionState: ActionState = { status: "idle" };
