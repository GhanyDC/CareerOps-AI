"use client";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <section className="panel">
      <p className="eyebrow">Safe error</p>
      <h1>CareerOps could not load this view</h1>
      <p>
        No database or environment details were exposed. Retry, or verify the local database and
        seed.
      </p>
      <button className="button primary" type="button" onClick={reset}>
        Retry
      </button>
    </section>
  );
}
