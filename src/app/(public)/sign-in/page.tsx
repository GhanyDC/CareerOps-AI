import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { SignInButton } from "@/components/sign-in-button";
import { safeReturnPath } from "@/server/auth/redirects";
import { resolveRequestContext } from "@/server/request-context";

export const dynamic = "force-dynamic";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string; signedOut?: string }>;
}) {
  const query = await searchParams;
  const callbackURL = safeReturnPath(query.returnTo);

  try {
    await resolveRequestContext(await headers());
    redirect(callbackURL);
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
  }

  return (
    <main className="auth-shell">
      <section className="panel auth-panel">
        <p className="eyebrow">CareerOps AI</p>
        <h1>Sign in to your evidence workspace</h1>
        <p>
          Authentication establishes your internal CareerOps identity. Candidate evidence remains
          private and scoped to that identity.
        </p>
        {query.signedOut ? <div className="notice success">You have signed out.</div> : null}
        <SignInButton callbackURL={callbackURL} />
        <p className="auth-note">CareerOps requests only your basic Google identity.</p>
      </section>
    </main>
  );
}
