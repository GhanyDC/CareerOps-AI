"use client";

import { useState } from "react";

import { authClient } from "@/auth-client";

export function SignInButton({ callbackURL }: { callbackURL: string }) {
  const [pending, setPending] = useState(false);

  return (
    <button
      className="button primary"
      type="button"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        const result = await authClient.signIn.social({
          provider: "google",
          callbackURL,
          errorCallbackURL: "/auth/error",
        });
        if (result.error) window.location.assign("/auth/error");
      }}
    >
      {pending ? "Redirecting…" : "Sign in with Google"}
    </button>
  );
}
