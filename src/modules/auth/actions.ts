"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/server/auth/config";
import { writeAuthenticationAudit } from "@/server/auth/audit";
import { getMutationRequestContext } from "@/server/request-context";

export async function signOutAction() {
  let context;
  try {
    context = await getMutationRequestContext();
  } catch {
    redirect("/sign-in");
  }

  await auth.api.signOut({ headers: await headers() });
  await writeAuthenticationAudit({
    userId: context.userId,
    authSessionId: context.sessionId,
    action: "SIGN_OUT",
  });
  redirect("/sign-in?signedOut=1");
}
