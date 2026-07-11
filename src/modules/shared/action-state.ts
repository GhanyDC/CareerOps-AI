export type ActionState = Readonly<{
  status: "idle" | "error";
  message?: string;
  fieldErrors?: Record<string, string[]>;
}>;

export const initialActionState: ActionState = { status: "idle" };
