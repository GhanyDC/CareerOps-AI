import { signOutAction } from "@/modules/auth/actions";

export function SignOutForm() {
  return (
    <form action={signOutAction}>
      <button className="button secondary" type="submit">
        Sign out
      </button>
    </form>
  );
}
