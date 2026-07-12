import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: "CareerOps AI",
  description: "Evidence-grounded career operations",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>
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
          </nav>
          <span className="development-identity">Development identity</span>
        </header>
        <main className="app-main">{children}</main>
        <footer>
          CareerOps prepares evidence. Application review, approval, and submission remain manual.
        </footer>
      </body>
    </html>
  );
}
