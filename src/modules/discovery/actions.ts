"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ZodError } from "zod";

import { toActionError } from "@/modules/shared/action-errors.server";
import type { ActionState } from "@/modules/shared/action-state";
import { readString } from "@/modules/shared/validation";
import { getMutationRequestContext } from "@/server/request-context";

import {
  confirmDiscoveryImport,
  parseStructuredImportText,
  previewDiscoveryImport,
  purgeDiscoveryImportBatch,
  transitionJobDiscovery,
} from "./use-cases";

export type DiscoveryPreviewItem = Readonly<{
  sourceLabel?: string;
  submittedUrl?: string;
  titleHint?: string;
  companyHint?: string;
  locationHint?: string;
  discoveredAt?: string;
  rawContent: string;
}>;

export type DiscoveryImportActionState =
  | ActionState
  | Readonly<{
      status: "preview";
      token: string;
      producerLabel: string;
      method: "MANUAL_ENTRY" | "PASTED_TEXT" | "STRUCTURED_JSON";
      items: readonly DiscoveryPreviewItem[];
      formValues: Readonly<Record<string, string>>;
    }>;

function toDiscoveryActionError(error: unknown, operation: string): ActionState {
  const state = toActionError(error, operation);
  if (
    error instanceof ZodError &&
    error.issues.some((issue) => issue.path.some((segment) => segment === "sourceUrl"))
  ) {
    return { ...state, code: "INVALID_URL" };
  }
  return state;
}

function readSingleDraft(formData: FormData, importMethod: "MANUAL_ENTRY" | "PASTED_TEXT") {
  return {
    contractVersion: 1,
    importMethod,
    sourceLabel: readString(formData, "sourceLabel"),
    sourceUrl: readString(formData, "sourceUrl"),
    titleHint: readString(formData, "titleHint"),
    companyHint: readString(formData, "companyHint"),
    locationHint: readString(formData, "locationHint"),
    discoveredAt: readString(formData, "discoveredAt"),
    rawText: readString(formData, "rawText"),
  };
}

export async function previewDiscoveryImportAction(
  _previousState: DiscoveryImportActionState,
  formData: FormData,
): Promise<DiscoveryImportActionState> {
  try {
    const context = await getMutationRequestContext();
    const method = readString(formData, "importMethod");
    const formValues = Object.fromEntries(
      [
        "sourceLabel",
        "sourceUrl",
        "titleHint",
        "companyHint",
        "locationHint",
        "discoveredAt",
        "rawText",
        "structuredJson",
      ].map((name) => [name, readString(formData, name) ?? ""]),
    );
    const draft =
      method === "STRUCTURED_JSON"
        ? parseStructuredImportText(readString(formData, "structuredJson") ?? "")
        : readSingleDraft(formData, method === "PASTED_TEXT" ? "PASTED_TEXT" : "MANUAL_ENTRY");
    const result = previewDiscoveryImport(context, draft);
    return {
      status: "preview",
      token: result.token,
      producerLabel: result.preview.producerLabel,
      method: result.preview.importMethod,
      formValues,
      items: result.preview.discoveries.map((item) => ({
        ...item,
        discoveredAt: item.discoveredAt?.toISOString(),
        validationSummary: undefined,
      })),
    };
  } catch (error) {
    return toDiscoveryActionError(error, "discovery.preview");
  }
}

export async function confirmDiscoveryImportAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let batchId: string;
  try {
    const context = await getMutationRequestContext();
    const token = readString(formData, "previewToken");
    if (!token) throw new Error("Missing preview token");
    const batch = await confirmDiscoveryImport(context, token);
    batchId = batch.id;
    revalidatePath("/");
    revalidatePath("/discoveries");
  } catch (error) {
    return toDiscoveryActionError(error, "discovery.confirm");
  }
  redirect(`/discoveries/batches/${batchId}?confirmed=1`);
}

export async function transitionDiscoveryAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = readString(formData, "id");
  try {
    const { userId } = await getMutationRequestContext();
    if (!id) throw new Error("Missing discovery identifier");
    await transitionJobDiscovery(userId, id, {
      targetStatus: readString(formData, "targetStatus"),
      expectedVersion: readString(formData, "expectedVersion"),
    });
    revalidatePath("/");
    revalidatePath("/discoveries");
    revalidatePath(`/discoveries/${id}`);
  } catch (error) {
    return toDiscoveryActionError(error, "discovery.transition");
  }
  redirect(`/discoveries/${id}?transitioned=1`);
}

export async function purgeDiscoveryImportBatchAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const batchId = readString(formData, "batchId");
  try {
    const { userId } = await getMutationRequestContext();
    if (!batchId) throw new Error("Missing import batch identifier");
    await purgeDiscoveryImportBatch(userId, batchId, {
      confirmation: readString(formData, "confirmation"),
    });
    revalidatePath("/");
    revalidatePath("/discoveries");
  } catch (error) {
    return toDiscoveryActionError(error, "discovery.purge");
  }
  redirect("/discoveries?purged=1");
}
