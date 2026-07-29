import { createHash } from "node:crypto";

import { CHUNKING_SCHEMA_VERSION } from "./schemas";

export const MAX_CANONICAL_DOCUMENT_CHARACTERS = 12_000 as const;
export const MAX_CHUNK_CHARACTERS = 1_200 as const;
export const MAX_CHUNKS_PER_EVIDENCE = 20 as const;
export const HARD_SPLIT_OVERLAP_CHARACTERS = 80 as const;

const unsafeControls = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/gu;
const bidiControls = /[\u202A-\u202E\u2066-\u2069]/gu;

export type CanonicalEvidenceInput = Readonly<{
  id: string;
  version: number;
  claim: string;
  supportingContext: string | null;
  skillsDemonstrated: readonly string[];
  relevantRoleFamilies: readonly string[];
  sourceType: "EXPERIENCE" | "PROJECT";
  evidenceStrength: "DIRECT" | "TRANSFERABLE" | "SUPPORTING" | "WEAK";
  verificationStatus: "DRAFT" | "REQUIRES_VERIFICATION" | "VERIFIED" | "REJECTED";
}>;

type CanonicalSection = Readonly<{ label: string; text: string }>;

export type CanonicalEvidenceDocument = Readonly<{
  evidenceItemId: string;
  evidenceVersion: number;
  content: string;
  contentHash: string;
  sections: readonly CanonicalSection[];
  characterCount: number;
}>;

export type EvidenceRetrievalChunkDraft = Readonly<{
  id: string;
  evidenceItemId: string;
  evidenceVersion: number;
  chunkIndex: number;
  section: string;
  text: string;
  hash: string;
  characterCount: number;
}>;

export class RetrievalChunkingError extends Error {
  readonly code = "CHUNK_LIMIT_EXCEEDED" as const;

  constructor(readonly generatedChunkCount: number) {
    super("Canonical Evidence document exceeds the deterministic chunk bound.");
    this.name = "RetrievalChunkingError";
  }
}

export function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function codePoints(value: string) {
  return Array.from(value);
}

function takeCharacters(value: string, maximum: number) {
  const points = codePoints(value);
  if (points.length <= maximum) return value;
  return points.slice(0, maximum).join("").trimEnd();
}

export function normalizeRetrievalPlainText(value: string) {
  return value
    .normalize("NFC")
    .replace(/\r\n?/gu, "\n")
    .replace(unsafeControls, "")
    .replace(bidiControls, "")
    .split("\n")
    .map((line) => line.trim().replace(/[ \t]+/gu, " "))
    .join("\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

function normalizeList(values: readonly string[]) {
  return values.map(normalizeRetrievalPlainText).filter(Boolean);
}

function candidateSections(evidence: CanonicalEvidenceInput): CanonicalSection[] {
  const sections: CanonicalSection[] = [
    { label: "Evidence statement", text: normalizeRetrievalPlainText(evidence.claim) },
    { label: "Evidence source type", text: evidence.sourceType },
    { label: "Evidence strength", text: evidence.evidenceStrength },
    { label: "Verification status", text: evidence.verificationStatus },
  ];
  const context = evidence.supportingContext
    ? normalizeRetrievalPlainText(evidence.supportingContext)
    : "";
  if (context) sections.push({ label: "Supporting context", text: context });
  const skills = normalizeList(evidence.skillsDemonstrated);
  if (skills.length > 0) {
    sections.push({
      label: "Skills demonstrated",
      text: skills.map((item) => `- ${item}`).join("\n"),
    });
  }
  const roles = normalizeList(evidence.relevantRoleFamilies);
  if (roles.length > 0) {
    sections.push({
      label: "Relevant role families",
      text: roles.map((item) => `- ${item}`).join("\n"),
    });
  }
  return sections;
}

export function buildCanonicalEvidenceDocument(
  evidence: CanonicalEvidenceInput,
): CanonicalEvidenceDocument {
  const included: CanonicalSection[] = [];
  let content = "";

  for (const section of candidateSections(evidence)) {
    if (!section.text) continue;
    const separator = content ? "\n\n" : "";
    const header = `[${section.label}]\n`;
    const remaining =
      MAX_CANONICAL_DOCUMENT_CHARACTERS -
      codePoints(content).length -
      codePoints(separator).length -
      codePoints(header).length;
    if (remaining <= 0) break;
    const text = takeCharacters(section.text, remaining);
    if (!text) break;
    included.push({ label: section.label, text });
    content += `${separator}${header}${text}`;
  }

  return {
    evidenceItemId: evidence.id,
    evidenceVersion: evidence.version,
    content,
    contentHash: sha256(content),
    sections: included,
    characterCount: codePoints(content).length,
  };
}

function hardSplit(text: string, maximum: number, overlap: number) {
  const points = codePoints(text);
  const chunks: string[] = [];
  let start = 0;
  while (start < points.length) {
    const end = Math.min(start + maximum, points.length);
    chunks.push(points.slice(start, end).join("").trim());
    if (end === points.length) break;
    start = Math.max(start + 1, end - overlap);
  }
  return chunks.filter(Boolean);
}

function splitLongParagraph(paragraph: string) {
  if (codePoints(paragraph).length <= MAX_CHUNK_CHARACTERS) return [paragraph];
  const sentences = paragraph.split(/(?<=[.!?])\s+/u).filter(Boolean);
  if (sentences.length <= 1) {
    return hardSplit(paragraph, MAX_CHUNK_CHARACTERS, HARD_SPLIT_OVERLAP_CHARACTERS);
  }

  const parts: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if (codePoints(sentence).length > MAX_CHUNK_CHARACTERS) {
      if (current) parts.push(current);
      parts.push(...hardSplit(sentence, MAX_CHUNK_CHARACTERS, HARD_SPLIT_OVERLAP_CHARACTERS));
      current = "";
      continue;
    }
    const candidate = current ? `${current} ${sentence}` : sentence;
    if (codePoints(candidate).length <= MAX_CHUNK_CHARACTERS) {
      current = candidate;
    } else {
      parts.push(current);
      current = sentence;
    }
  }
  if (current) parts.push(current);
  return parts;
}

function splitSection(section: CanonicalSection) {
  const prefix = `[${section.label}]\n`;
  const available = MAX_CHUNK_CHARACTERS - codePoints(prefix).length;
  const paragraphs = section.text.split(/\n{2,}/u).filter(Boolean);
  const bodies: string[] = [];
  let current = "";

  for (const paragraph of paragraphs.flatMap((item) => splitLongParagraph(item))) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (codePoints(candidate).length <= available) {
      current = candidate;
    } else {
      if (current) bodies.push(current);
      if (codePoints(paragraph).length <= available) {
        current = paragraph;
      } else {
        bodies.push(...hardSplit(paragraph, available, HARD_SPLIT_OVERLAP_CHARACTERS));
        current = "";
      }
    }
  }
  if (current) bodies.push(current);
  return bodies.map((body) => `${prefix}${body}`);
}

export function chunkCanonicalEvidenceDocument(
  document: CanonicalEvidenceDocument,
): readonly EvidenceRetrievalChunkDraft[] {
  const texts = document.sections.flatMap((section) =>
    splitSection(section).map((text) => ({ section: section.label, text })),
  );
  if (texts.length > MAX_CHUNKS_PER_EVIDENCE) {
    throw new RetrievalChunkingError(texts.length);
  }

  return texts.map(({ section, text }, chunkIndex) => {
    const hash = sha256(
      [
        `chunking-schema:${CHUNKING_SCHEMA_VERSION}`,
        `evidence:${document.evidenceItemId}`,
        `version:${document.evidenceVersion}`,
        `index:${chunkIndex}`,
        `section:${section}`,
        text,
      ].join("\n"),
    );
    return {
      id: `erc_${hash.slice(0, 32)}`,
      evidenceItemId: document.evidenceItemId,
      evidenceVersion: document.evidenceVersion,
      chunkIndex,
      section,
      text,
      hash,
      characterCount: codePoints(text).length,
    };
  });
}
