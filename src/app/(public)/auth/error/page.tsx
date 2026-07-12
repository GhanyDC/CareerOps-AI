import Link from "next/link";

export default function AuthenticationErrorPage() {
  return (
    <main className="auth-shell">
      <section className="panel auth-panel">
        <p className="eyebrow">Authentication unavailable</p>
        <h1>CareerOps could not complete sign-in</h1>
        <p>
          The account could not be authenticated safely. No account, provider, or identity details
          are disclosed.
        </p>
        <Link className="button secondary" href="/sign-in">
          Return to sign in
        </Link>
      </section>
    </main>
  );
}
