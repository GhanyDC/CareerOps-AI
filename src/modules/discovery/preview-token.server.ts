import "server-only";

import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";

import { env } from "@/config/env.server";
import type { RequestContext } from "@/server/request-context";
import { DiscoveryError } from "./errors";
import {
  DISCOVERY_VALIDATOR_VERSION,
  signedImportPayloadSchema,
  type DiscoveryDraftV1,
  type SignedImportPayloadV1,
} from "./schemas";

const MAX_TOKEN_LENGTH = 400_000;
const MAX_PAYLOAD_SEGMENT_LENGTH = 399_900;
const SIGNATURE_SEGMENT_LENGTH = 43;
const TOKEN_LIFETIME_SECONDS = 15 * 60;
const FUTURE_SKEW_SECONDS = 60;
const base64Url = /^[A-Za-z0-9_-]+$/;

const envelopeSchema = z
  .object({
    envelopeVersion: z.literal(1),
    validatorVersion: z.literal(DISCOVERY_VALIDATOR_VERSION),
    contractVersion: z.literal(1),
    userId: z.string().min(1).max(100),
    sessionBinding: z.string().regex(/^[0-9a-f]{64}$/),
    issuedAt: z.number().int(),
    expiresAt: z.number().int(),
    importPayload: z.unknown(),
  })
  .strict();

function derivedKey() {
  return createHmac("sha256", Buffer.from(env.BETTER_AUTH_SECRET, "utf8"))
    .update("careerops:discovery-preview:v1", "utf8")
    .digest();
}

export function discoverySessionBinding(sessionId: string) {
  return createHash("sha256")
    .update(`careerops:discovery-session-binding:v1\0${sessionId}`, "utf8")
    .digest("hex");
}

function signSegment(payloadSegment: string) {
  return createHmac("sha256", derivedKey()).update(payloadSegment, "ascii").digest();
}

export function createDiscoveryPreviewToken(
  context: RequestContext,
  draft: DiscoveryDraftV1,
  now = new Date(),
) {
  const importPayload: SignedImportPayloadV1 = { idempotencyKey: randomUUID(), draft };
  const issuedAt = Math.floor(now.getTime() / 1000);
  const envelope = {
    envelopeVersion: 1,
    validatorVersion: DISCOVERY_VALIDATOR_VERSION,
    contractVersion: 1,
    userId: context.userId,
    sessionBinding: discoverySessionBinding(context.sessionId),
    issuedAt,
    expiresAt: issuedAt + TOKEN_LIFETIME_SECONDS,
    importPayload,
  } as const;
  const payloadSegment = Buffer.from(JSON.stringify(envelope), "utf8").toString("base64url");
  const token = `${payloadSegment}.${signSegment(payloadSegment).toString("base64url")}`;
  if (token.length > MAX_TOKEN_LENGTH) {
    throw new DiscoveryError("PAYLOAD_TOO_LARGE", "The preview payload is too large.");
  }
  return token;
}

function invalidToken(): never {
  throw new DiscoveryError(
    "INVALID_PREVIEW_TOKEN",
    "The import preview is invalid. Preview it again.",
  );
}

export function verifyDiscoveryPreviewToken(
  context: RequestContext,
  token: string,
  now = new Date(),
) {
  if (!token || token.length > MAX_TOKEN_LENGTH) invalidToken();
  const segments = token.split(".");
  if (segments.length !== 2) invalidToken();
  const [payloadSegment, signatureSegment] = segments as [string, string];
  if (
    !payloadSegment ||
    payloadSegment.length > MAX_PAYLOAD_SEGMENT_LENGTH ||
    !base64Url.test(payloadSegment) ||
    signatureSegment.length !== SIGNATURE_SEGMENT_LENGTH ||
    !base64Url.test(signatureSegment)
  ) {
    invalidToken();
  }

  let payloadBytes: Buffer;
  let suppliedSignature: Buffer;
  try {
    payloadBytes = Buffer.from(payloadSegment, "base64url");
    suppliedSignature = Buffer.from(signatureSegment, "base64url");
  } catch {
    invalidToken();
  }
  const expectedSignature = signSegment(payloadSegment);
  if (
    suppliedSignature.length !== expectedSignature.length ||
    !timingSafeEqual(suppliedSignature, expectedSignature)
  ) {
    invalidToken();
  }

  let envelope: z.infer<typeof envelopeSchema>;
  try {
    envelope = envelopeSchema.parse(JSON.parse(payloadBytes.toString("utf8")));
  } catch {
    invalidToken();
  }
  if (
    envelope.userId !== context.userId ||
    envelope.sessionBinding !== discoverySessionBinding(context.sessionId)
  ) {
    invalidToken();
  }
  const nowSeconds = Math.floor(now.getTime() / 1000);
  if (
    envelope.expiresAt <= envelope.issuedAt ||
    envelope.expiresAt - envelope.issuedAt > TOKEN_LIFETIME_SECONDS ||
    envelope.issuedAt > nowSeconds + FUTURE_SKEW_SECONDS
  ) {
    invalidToken();
  }
  if (nowSeconds > envelope.expiresAt) {
    throw new DiscoveryError("PREVIEW_EXPIRED", "The import preview expired. Preview it again.");
  }
  try {
    return signedImportPayloadSchema.parse(envelope.importPayload);
  } catch {
    invalidToken();
  }
}
