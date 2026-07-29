"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { GroundedRetrievalPacket } from "./use-cases";
import { indexEvidenceItem, reindexEvidencePage, retrieveForUserQuery } from "./use-cases";
import { executeServerMutation, toActionError } from "@/modules/shared/action-errors.server";
import type { ActionState } from "@/modules/shared/action-state";
import { readString } from "@/modules/shared/validation";
import { getMutationRequestContext } from "@/server/request-context";

export type RetrievalSearchState = Readonly<{
  status: "idle" | "success" | "error";
  packet?: GroundedRetrievalPacket;
  message?: string;
  fieldErrors?: Record<string, string[]>;
}>;

export async function searchRetrievalAction(
  _previousState: RetrievalSearchState,
  formData: FormData,
): Promise<RetrievalSearchState> {
  try {
    const { userId } = await getMutationRequestContext();
    const packet = await retrieveForUserQuery(userId, {
      query: readString(formData, "query"),
      topK: readString(formData, "topK"),
    });
    return { status: "success", packet };
  } catch (error) {
    const safe = toActionError(error, "retrieval.user_query");
    return {
      status: "error",
      message: safe.message,
      fieldErrors: safe.fieldErrors,
    };
  }
}

export async function indexEvidenceAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const evidenceItemId = readString(formData, "evidenceItemId");
  let status: string | undefined;
  const state = await executeServerMutation("retrieval.index_evidence", async () => {
    const { userId } = await getMutationRequestContext();
    const index = await indexEvidenceItem(userId, evidenceItemId);
    status = index.status;
    revalidatePath("/retrieval");
    revalidatePath("/evidence");
    if (evidenceItemId) revalidatePath(`/evidence/${evidenceItemId}`);
  });
  if (state.status === "error") return state;
  const returnTo = readString(formData, "returnTo");
  if (returnTo === "evidence" && evidenceItemId) {
    redirect(`/evidence/${evidenceItemId}?indexed=${status}`);
  }
  redirect(`/retrieval?indexed=${status}`);
}

export async function reindexEvidencePageAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let result: Awaited<ReturnType<typeof reindexEvidencePage>> | undefined;
  const state = await executeServerMutation("retrieval.reindex_page", async () => {
    const { userId } = await getMutationRequestContext();
    result = await reindexEvidencePage(userId, {
      cursor: readString(formData, "cursor"),
      limit: readString(formData, "limit"),
    });
    revalidatePath("/retrieval");
    revalidatePath("/evidence");
  });
  if (state.status === "error") return state;
  const next = result?.nextCursor ? `&cursor=${encodeURIComponent(result.nextCursor)}` : "";
  redirect(`/retrieval?batchIndexed=${result?.outcomes.length ?? 0}${next}`);
}
