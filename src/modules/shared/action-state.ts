export type ActionState = Readonly<{
  status: "idle" | "error";
  code?: "SESSION_REQUIRED";
  message?: string;
  fieldErrors?: Record<string, string[]>;
}>;

export const initialActionState: ActionState = { status: "idle" };
