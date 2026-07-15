import { z } from "zod";

export const JOB_CONTRACT_VERSION = 1 as const;
export const JOB_PARSER_VERSION = "job-parser-v1" as const;
export const JOB_SOURCE_SERIALIZER_VERSION = "job-discovery-source-v1" as const;
export const JOB_FIELD_NAMES = [
  "title",
  "companyName",
  "employmentType",
  "workplaceArrangement",
  "countryCode",
  "region",
  "city",
  "locationLabel",
  "salaryMin",
  "salaryMax",
  "salaryCurrency",
  "salaryPeriod",
  "experienceLevel",
  "postedDate",
  "closingDate",
  "sourceUrl",
  "description",
  "responsibilities",
  "qualifications",
  "preferredQualifications",
  "benefits",
  "skills",
  "applicationInstructions",
  "contactDetails",
  "notes",
] as const;

export type JobFieldName = (typeof JOB_FIELD_NAMES)[number];

const bidiControls = /[\u202A-\u202E\u2066-\u2069]/u;
const singleLineControls = /[\u0000-\u001F\u007F-\u009F]/u;
const multilineControls = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u;
const isoDate = /^\d{4}-\d{2}-\d{2}$/;
const decimal = /^\d{1,12}(?:\.\d{1,2})?$/;

function scalarLength(value: string) {
  return [...value].length;
}

function validUnicode(value: string) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return !bidiControls.test(value);
}

export function normalizeJobSingleLine(value: string) {
  return value.trim().replace(/\s+/gu, " ");
}

export function normalizeJobMultiline(value: string) {
  return value.replace(/\r\n?/gu, "\n").trim();
}

function nullableSingleLine(label: string, maximum: number) {
  return z
    .string()
    .refine((value) => scalarLength(value) <= maximum, `${label} is too long`)
    .refine((value) => value.length > 0, `${label} cannot be blank`)
    .refine(validUnicode, `${label} contains unsupported Unicode`)
    .refine((value) => !singleLineControls.test(value), `${label} contains control characters`)
    .nullable();
}

function nullableMultiline(label: string, maximumBytes: number) {
  return z
    .string()
    .refine((value) => value.length > 0, `${label} cannot be blank`)
    .refine(validUnicode, `${label} contains unsupported Unicode`)
    .refine((value) => !multilineControls.test(value), `${label} contains control characters`)
    .refine((value) => Buffer.byteLength(value, "utf8") <= maximumBytes, `${label} is too long`)
    .nullable();
}

function stringArray(label: string, itemMaximum: number) {
  return z
    .array(
      z
        .string()
        .min(1, `${label} entries cannot be blank`)
        .refine((value) => scalarLength(value) <= itemMaximum, `${label} entry is too long`)
        .refine(validUnicode, `${label} contains unsupported Unicode`)
        .refine((value) => !singleLineControls.test(value), `${label} contains control characters`),
    )
    .max(100)
    .superRefine((values, context) => {
      const seen = new Set<string>();
      for (const [index, value] of values.entries()) {
        const key = value.toLocaleLowerCase("en-US");
        if (seen.has(key)) {
          context.addIssue({
            code: "custom",
            path: [index],
            message: `${label} contains a duplicate entry`,
          });
        }
        seen.add(key);
      }
    });
}

function validCalendarDate(value: string) {
  if (!isoDate.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

const sourceUrlSchema = z
  .string()
  .max(2048)
  .refine((value) => value === value.trim(), "Source URL cannot have surrounding whitespace")
  .refine(validUnicode, "Source URL contains unsupported Unicode")
  .refine((value) => !singleLineControls.test(value), "Source URL contains control characters")
  .superRefine((value, context) => {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      context.addIssue({ code: "custom", message: "Source URL is invalid" });
      return;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      context.addIssue({ code: "custom", message: "Source URL must use http:// or https://" });
    }
    if (parsed.username || parsed.password) {
      context.addIssue({ code: "custom", message: "Source URL cannot contain credentials" });
    }
  })
  .nullable();

export const jobValuesSchema = z
  .object({
    title: nullableSingleLine("Title", 200),
    companyName: nullableSingleLine("Company name", 200),
    employmentType: z
      .enum([
        "FULL_TIME",
        "PART_TIME",
        "CONTRACT",
        "TEMPORARY",
        "INTERNSHIP",
        "APPRENTICESHIP",
        "VOLUNTEER",
        "OTHER",
      ])
      .nullable(),
    workplaceArrangement: z
      .enum(["ON_SITE", "HYBRID", "REMOTE", "FIELD_BASED", "OTHER"])
      .nullable(),
    countryCode: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .nullable(),
    region: nullableSingleLine("Region", 160),
    city: nullableSingleLine("City", 160),
    locationLabel: nullableSingleLine("Location label", 300),
    salaryMin: z.string().regex(decimal, "Salary minimum is invalid").nullable(),
    salaryMax: z.string().regex(decimal, "Salary maximum is invalid").nullable(),
    salaryCurrency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .nullable(),
    salaryPeriod: z.enum(["HOUR", "DAY", "WEEK", "MONTH", "YEAR", "PROJECT", "OTHER"]).nullable(),
    experienceLevel: z
      .enum([
        "INTERNSHIP",
        "ENTRY_LEVEL",
        "MID_LEVEL",
        "SENIOR",
        "LEAD",
        "MANAGER",
        "DIRECTOR",
        "EXECUTIVE",
        "OTHER",
      ])
      .nullable(),
    postedDate: z.string().refine(validCalendarDate, "Posted date is invalid").nullable(),
    closingDate: z.string().refine(validCalendarDate, "Closing date is invalid").nullable(),
    sourceUrl: sourceUrlSchema,
    description: nullableMultiline("Description", 50_000),
    responsibilities: stringArray("Responsibilities", 1000),
    qualifications: stringArray("Qualifications", 1000),
    preferredQualifications: stringArray("Preferred qualifications", 1000),
    benefits: stringArray("Benefits", 1000),
    skills: stringArray("Skills", 160),
    applicationInstructions: nullableMultiline("Application instructions", 20_000),
    contactDetails: nullableMultiline("Contact details", 5_000),
    notes: nullableMultiline("Notes", 20_000),
  })
  .strict()
  .superRefine((value, context) => {
    const hasSalary = value.salaryMin !== null || value.salaryMax !== null;
    if (hasSalary && (!value.salaryCurrency || !value.salaryPeriod)) {
      context.addIssue({
        code: "custom",
        path: ["salaryCurrency"],
        message: "Currency and period are required with salary amounts",
      });
    }
    if (!hasSalary && (value.salaryCurrency || value.salaryPeriod)) {
      context.addIssue({
        code: "custom",
        path: ["salaryCurrency"],
        message: "Currency and period require a salary amount",
      });
    }
    if (
      value.salaryMin !== null &&
      value.salaryMax !== null &&
      Number(value.salaryMax) < Number(value.salaryMin)
    ) {
      context.addIssue({
        code: "custom",
        path: ["salaryMax"],
        message: "Salary maximum must be at least the minimum",
      });
    }
    if (value.postedDate && value.closingDate && value.closingDate < value.postedDate) {
      context.addIssue({
        code: "custom",
        path: ["closingDate"],
        message: "Closing date cannot precede the posted date",
      });
    }
  });

export const structuredJobContractSchema = z
  .object({ contractVersion: z.literal(JOB_CONTRACT_VERSION), job: jobValuesSchema })
  .strict();

export type JobValues = z.infer<typeof jobValuesSchema>;

export const confirmedJobValuesSchema = jobValuesSchema.refine((value) => value.title !== null, {
  path: ["title"],
  message: "Title is required before confirmation",
});

export function emptyJobValues(): JobValues {
  return {
    title: null,
    companyName: null,
    employmentType: null,
    workplaceArrangement: null,
    countryCode: null,
    region: null,
    city: null,
    locationLabel: null,
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    salaryPeriod: null,
    experienceLevel: null,
    postedDate: null,
    closingDate: null,
    sourceUrl: null,
    description: null,
    responsibilities: [],
    qualifications: [],
    preferredQualifications: [],
    benefits: [],
    skills: [],
    applicationInstructions: null,
    contactDetails: null,
    notes: null,
  };
}

export const jobTransitionSchema = z
  .object({
    targetStatus: z.enum(["ACTIVE", "ARCHIVED"]),
    expectedVersion: z.coerce.number().int().positive(),
  })
  .strict();

export function jobValuesToPersistence(values: JobValues) {
  return {
    title: values.title!,
    companyName: values.companyName,
    employmentType: values.employmentType,
    workplaceArrangement: values.workplaceArrangement,
    experienceLevel: values.experienceLevel,
    countryCode: values.countryCode,
    region: values.region,
    city: values.city,
    locationLabel: values.locationLabel,
    salaryMin: values.salaryMin,
    salaryMax: values.salaryMax,
    salaryCurrency: values.salaryCurrency,
    salaryPeriod: values.salaryPeriod,
    postedAt: values.postedDate ? new Date(`${values.postedDate}T00:00:00.000Z`) : null,
    closesAt: values.closingDate ? new Date(`${values.closingDate}T00:00:00.000Z`) : null,
    sourceUrl: values.sourceUrl,
    description: values.description,
    responsibilities: values.responsibilities,
    qualifications: values.qualifications,
    preferredQualifications: values.preferredQualifications,
    benefits: values.benefits,
    skills: values.skills,
    applicationInstructions: values.applicationInstructions,
    contactDetails: values.contactDetails,
    notes: values.notes,
  };
}

export function persistedJobToValues(job: {
  title: string;
  companyName: string | null;
  employmentType: JobValues["employmentType"];
  workplaceArrangement: JobValues["workplaceArrangement"];
  experienceLevel: JobValues["experienceLevel"];
  countryCode: string | null;
  region: string | null;
  city: string | null;
  locationLabel: string | null;
  salaryMin: { toString(): string } | null;
  salaryMax: { toString(): string } | null;
  salaryCurrency: string | null;
  salaryPeriod: JobValues["salaryPeriod"];
  postedAt: Date | null;
  closesAt: Date | null;
  sourceUrl: string | null;
  description: string | null;
  responsibilities: string[];
  qualifications: string[];
  preferredQualifications: string[];
  benefits: string[];
  skills: string[];
  applicationInstructions: string | null;
  contactDetails: string | null;
  notes: string | null;
}): JobValues {
  return {
    title: job.title,
    companyName: job.companyName,
    employmentType: job.employmentType,
    workplaceArrangement: job.workplaceArrangement,
    experienceLevel: job.experienceLevel,
    countryCode: job.countryCode,
    region: job.region,
    city: job.city,
    locationLabel: job.locationLabel,
    salaryMin: job.salaryMin?.toString() ?? null,
    salaryMax: job.salaryMax?.toString() ?? null,
    salaryCurrency: job.salaryCurrency,
    salaryPeriod: job.salaryPeriod,
    postedDate: job.postedAt?.toISOString().slice(0, 10) ?? null,
    closingDate: job.closesAt?.toISOString().slice(0, 10) ?? null,
    sourceUrl: job.sourceUrl,
    description: job.description,
    responsibilities: job.responsibilities,
    qualifications: job.qualifications,
    preferredQualifications: job.preferredQualifications,
    benefits: job.benefits,
    skills: job.skills,
    applicationInstructions: job.applicationInstructions,
    contactDetails: job.contactDetails,
    notes: job.notes,
  };
}

export function mergeSelectedJobFields(
  current: JobValues,
  proposed: JobValues,
  selected: readonly (keyof JobValues)[],
) {
  const merged = { ...current };
  for (const field of selected) Object.assign(merged, { [field]: proposed[field] });
  return confirmedJobValuesSchema.parse(merged);
}
