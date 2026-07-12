import Link from "next/link";

export default function NotFound() {
  return (
    <section className="panel narrow-page">
      <p className="eyebrow">Not found</p>
      <h1>The requested record is unavailable</h1>
      <p>It may not exist, or it may belong to another user.</p>
      <Link className="button secondary" href="/">
        Return to dashboard
      </Link>
    </section>
  );
}
