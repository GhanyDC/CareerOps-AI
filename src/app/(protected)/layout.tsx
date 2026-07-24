import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { SignOutForm } from "@/components/sign-out-form";
import { AccountUnavailableError, isSessionRequiredError } from "@/server/auth/errors";
import { getRequestContext } from "@/server/request-context";

export default async function ProtectedLayout({ children }: Readonly<{ children: ReactNode }>) {
  try {
    await getRequestContext();
  } catch (error) {
    if (isSessionRequiredError(error)) redirect("/sign-in");
    if (error instanceof AccountUnavailableError) redirect("/auth/error");
    throw error;
  }

  return (
    <>
      <header className="app-header">
        <Link className="brand" href="/">
          CareerOps <span>AI</span>
        </Link>
        <nav aria-label="CareerOps sections">
          <Link href="/">Dashboard</Link>
          <Link href="/candidate-profile">Candidate Profile</Link>
          <Link href="/experiences">Experiences</Link>
          <Link href="/projects">Projects</Link>
          <Link href="/evidence">Evidence Bank</Link>
          <Link href="/claims">Claims Bank</Link>
          <Link href="/discoveries">Discovery Inbox</Link>
          <Link href="/jobs">Jobs</Link>
          <Link href="/jobs/duplicates">Duplicate Review</Link>
          <Link href="/jobs/filters">Job Filters</Link>
          <Link href="/jobs/scoring">Job Scoring</Link>
        </nav>
        <SignOutForm />
      </header>
      <main className="app-main">{children}</main>
      <footer>
        CareerOps prepares evidence. Application review, approval, and submission remain manual.
      </footer>
    </>
  );
}
