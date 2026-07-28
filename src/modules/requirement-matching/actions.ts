"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { toActionError } from "@/modules/shared/action-errors.server";
import type { ActionState } from "@/modules/shared/action-state";
import { readString } from "@/modules/shared/validation";
import { getMutationRequestContext } from "@/server/request-context";

import {
  completeRequirementReview,
  createJobRequirement,
  createRequirementEvidenceLink,
  deleteRequirementEvidenceLink,
  moveJobRequirement,
  transitionJobRequirementState,
  updateJobRequirement,
  updateRequirementEvidenceLink,
} from "./use-cases";

function revalidateRequirementPaths(jobId: string, requirementId?: string) {
  revalidatePath("/");
  revalidatePath("/jobs");
  revalidatePath("/jobs/requirements");
  revalidatePath(`/jobs/${jobId}`);
  if (requirementId) revalidatePath(`/jobs/${jobId}/requirements/${requirementId}`);
}

function readRequirementValues(formData: FormData) {
  return {
    statement: readString(formData, "statement"),
    category: readString(formData, "category"),
    importance: readString(formData, "importance"),
    source: readString(formData, "source"),
  };
}

export async function createJobRequirementAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const jobId = readString(formData, "jobId");
  try {
    if (!jobId) throw new Error("Missing Job identifier");
    const { userId } = await getMutationRequestContext();
    const requirement = await createJobRequirement(userId, jobId, readRequirementValues(formData));
    revalidateRequirementPaths(jobId, requirement.id);
  } catch (error) {
    return toActionError(error, "requirement.create");
  }
  redirect(`/jobs/${jobId}?requirementCreated=1#requirement-matching`);
}

export async function updateJobRequirementAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const requirementId = readString(formData, "requirementId");
  let jobId: string | undefined;
  let updatedVersion: number | undefined;
  try {
    if (!requirementId) throw new Error("Missing requirement identifier");
    const { userId } = await getMutationRequestContext();
    const requirement = await updateJobRequirement(userId, requirementId, {
      ...readRequirementValues(formData),
      expectedVersion: readString(formData, "expectedVersion"),
    });
    jobId = requirement.jobId;
    updatedVersion = requirement.version;
    revalidateRequirementPaths(requirement.jobId, requirementId);
  } catch (error) {
    return toActionError(error, "requirement.update");
  }
  redirect(`/jobs/${jobId}/requirements/${requirementId}?saved=${updatedVersion}`);
}

export async function transitionJobRequirementAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const requirementId = readString(formData, "requirementId");
  let jobId: string | undefined;
  try {
    if (!requirementId) throw new Error("Missing requirement identifier");
    const { userId } = await getMutationRequestContext();
    const requirement = await transitionJobRequirementState(userId, requirementId, {
      targetState: readString(formData, "targetState"),
      expectedVersion: readString(formData, "expectedVersion"),
    });
    jobId = requirement.jobId;
    revalidateRequirementPaths(jobId, requirementId);
  } catch (error) {
    return toActionError(error, "requirement.transition");
  }
  redirect(`/jobs/${jobId}?requirementTransitioned=1#requirement-matching`);
}

export async function moveJobRequirementAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const requirementId = readString(formData, "requirementId");
  let jobId: string | undefined;
  try {
    if (!requirementId) throw new Error("Missing requirement identifier");
    const { userId } = await getMutationRequestContext();
    const requirement = await moveJobRequirement(userId, requirementId, {
      direction: readString(formData, "direction"),
      expectedOrderHash: readString(formData, "expectedOrderHash"),
    });
    jobId = requirement.jobId;
    revalidateRequirementPaths(jobId, requirementId);
  } catch (error) {
    return toActionError(error, "requirement.move");
  }
  redirect(`/jobs/${jobId}?requirementMoved=1#requirement-matching`);
}

export async function createRequirementEvidenceLinkAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const requirementId = readString(formData, "requirementId");
  let jobId: string | undefined;
  let createdLinkId: string | undefined;
  try {
    if (!requirementId) throw new Error("Missing requirement identifier");
    const { userId } = await getMutationRequestContext();
    const link = await createRequirementEvidenceLink(userId, requirementId, {
      evidenceItemId: readString(formData, "evidenceItemId"),
      expectedEvidenceVersion: readString(formData, "expectedEvidenceVersion"),
      expectedRequirementVersion: readString(formData, "expectedRequirementVersion"),
      expectedMatchSetVersion: readString(formData, "expectedMatchSetVersion"),
      supportLevel: readString(formData, "supportLevel"),
      rationale: readString(formData, "rationale"),
    });
    jobId = link.jobId;
    createdLinkId = link.id;
    revalidateRequirementPaths(jobId, requirementId);
  } catch (error) {
    return toActionError(error, "requirement.link.create");
  }
  redirect(`/jobs/${jobId}/requirements/${requirementId}?linked=${createdLinkId}`);
}

export async function updateRequirementEvidenceLinkAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const requirementId = readString(formData, "requirementId");
  const linkId = readString(formData, "linkId");
  let jobId: string | undefined;
  let updatedVersion: number | undefined;
  try {
    if (!requirementId || !linkId) throw new Error("Missing evidence link identifier");
    const { userId } = await getMutationRequestContext();
    const link = await updateRequirementEvidenceLink(userId, requirementId, linkId, {
      expectedLinkVersion: readString(formData, "expectedLinkVersion"),
      expectedRequirementVersion: readString(formData, "expectedRequirementVersion"),
      expectedMatchSetVersion: readString(formData, "expectedMatchSetVersion"),
      supportLevel: readString(formData, "supportLevel"),
      rationale: readString(formData, "rationale"),
    });
    jobId = link.jobId;
    updatedVersion = link.version;
    revalidateRequirementPaths(jobId, requirementId);
  } catch (error) {
    return toActionError(error, "requirement.link.update");
  }
  redirect(`/jobs/${jobId}/requirements/${requirementId}?linkUpdated=${updatedVersion}`);
}

export async function deleteRequirementEvidenceLinkAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const requirementId = readString(formData, "requirementId");
  const linkId = readString(formData, "linkId");
  let jobId: string | undefined;
  try {
    if (!requirementId || !linkId) throw new Error("Missing evidence link identifier");
    const { userId } = await getMutationRequestContext();
    const link = await deleteRequirementEvidenceLink(userId, requirementId, linkId, {
      expectedLinkVersion: readString(formData, "expectedLinkVersion"),
      expectedRequirementVersion: readString(formData, "expectedRequirementVersion"),
      expectedMatchSetVersion: readString(formData, "expectedMatchSetVersion"),
    });
    jobId = link.jobId;
    revalidateRequirementPaths(jobId, requirementId);
  } catch (error) {
    return toActionError(error, "requirement.link.delete");
  }
  redirect(`/jobs/${jobId}/requirements/${requirementId}?unlinked=${linkId}`);
}

export async function completeRequirementReviewAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const requirementId = readString(formData, "requirementId");
  let jobId: string | undefined;
  let reviewVersion: number | undefined;
  try {
    if (!requirementId) throw new Error("Missing requirement identifier");
    const coordinatesText = readString(formData, "evidenceCoordinates") ?? "[]";
    const { userId } = await getMutationRequestContext();
    const review = await completeRequirementReview(userId, requirementId, {
      expectedRequirementVersion: readString(formData, "expectedRequirementVersion"),
      expectedMatchSetVersion: readString(formData, "expectedMatchSetVersion"),
      expectedReviewVersion: readString(formData, "expectedReviewVersion"),
      evidenceCoordinates: JSON.parse(coordinatesText) as unknown,
    });
    jobId = review.jobId;
    reviewVersion = review.version;
    revalidateRequirementPaths(jobId, requirementId);
  } catch (error) {
    return toActionError(error, "requirement.review.complete");
  }
  redirect(`/jobs/${jobId}/requirements/${requirementId}?reviewed=${reviewVersion}`);
}
