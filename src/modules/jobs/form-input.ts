import { jobValuesSchema, normalizeJobMultiline, normalizeJobSingleLine } from "./schemas";
import { readString } from "@/modules/shared/validation";

const singleLineFields = [
  "title",
  "companyName",
  "region",
  "city",
  "locationLabel",
  "salaryMin",
  "salaryMax",
  "postedDate",
  "closingDate",
  "sourceUrl",
] as const;
const multilineFields = [
  "description",
  "applicationInstructions",
  "contactDetails",
  "notes",
] as const;
const arrayFields = [
  "responsibilities",
  "qualifications",
  "preferredQualifications",
  "benefits",
  "skills",
] as const;

function nullableNormalized(value: string | undefined, multiline = false) {
  if (value === undefined || value.trim().length === 0) return null;
  return multiline ? normalizeJobMultiline(value) : normalizeJobSingleLine(value);
}

function readArray(value: string | undefined) {
  if (!value) return [];
  return value
    .replace(/\r\n?/gu, "\n")
    .split("\n")
    .map((item) => normalizeJobSingleLine(item))
    .filter(Boolean);
}

export function readJobCorrectionForm(formData: FormData) {
  const rawInput: Record<string, string | string[]> = {};
  for (const field of [...singleLineFields, ...multilineFields, ...arrayFields]) {
    rawInput[field] = readString(formData, field) ?? "";
  }
  for (const field of [
    "employmentType",
    "workplaceArrangement",
    "countryCode",
    "salaryCurrency",
    "salaryPeriod",
    "experienceLevel",
  ]) {
    rawInput[field] = readString(formData, field) ?? "";
  }

  const values = jobValuesSchema.parse({
    title: nullableNormalized(readString(formData, "title")),
    companyName: nullableNormalized(readString(formData, "companyName")),
    employmentType: nullableNormalized(readString(formData, "employmentType")),
    workplaceArrangement: nullableNormalized(readString(formData, "workplaceArrangement")),
    countryCode: nullableNormalized(readString(formData, "countryCode"))?.toUpperCase() ?? null,
    region: nullableNormalized(readString(formData, "region")),
    city: nullableNormalized(readString(formData, "city")),
    locationLabel: nullableNormalized(readString(formData, "locationLabel")),
    salaryMin: nullableNormalized(readString(formData, "salaryMin")),
    salaryMax: nullableNormalized(readString(formData, "salaryMax")),
    salaryCurrency:
      nullableNormalized(readString(formData, "salaryCurrency"))?.toUpperCase() ?? null,
    salaryPeriod: nullableNormalized(readString(formData, "salaryPeriod")),
    experienceLevel: nullableNormalized(readString(formData, "experienceLevel")),
    postedDate: nullableNormalized(readString(formData, "postedDate")),
    closingDate: nullableNormalized(readString(formData, "closingDate")),
    sourceUrl: nullableNormalized(readString(formData, "sourceUrl")),
    description: nullableNormalized(readString(formData, "description"), true),
    responsibilities: readArray(readString(formData, "responsibilities")),
    qualifications: readArray(readString(formData, "qualifications")),
    preferredQualifications: readArray(readString(formData, "preferredQualifications")),
    benefits: readArray(readString(formData, "benefits")),
    skills: readArray(readString(formData, "skills")),
    applicationInstructions: nullableNormalized(
      readString(formData, "applicationInstructions"),
      true,
    ),
    contactDetails: nullableNormalized(readString(formData, "contactDetails"), true),
    notes: nullableNormalized(readString(formData, "notes"), true),
  });

  return { schemaVersion: 1 as const, rawInput, values };
}
