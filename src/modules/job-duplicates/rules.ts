import type { JobCanonicalRepresentation } from "@/generated/prisma/client";
import { hashCanonicalValue } from "@/modules/job-canonicalization/public";
import { DomainError } from "@/modules/shared/errors";

import {
  DUPLICATE_EVIDENCE_SCHEMA_VERSION,
  type DuplicateConflicts,
  type DuplicateEvidence,
  type DuplicateRule,
} from "./schemas";

export type DuplicateSourceEvidence = Readonly<{
  sameLiveSource: boolean;
  sameLiveSourceHash: boolean;
}>;

export function orderDuplicatePair(leftJobId: string, rightJobId: string) {
  if (leftJobId === rightJobId) {
    throw new DomainError("A Job cannot be compared with itself.", "INVALID_DUPLICATE_PAIR");
  }
  return leftJobId < rightJobId
    ? { jobAId: leftJobId, jobBId: rightJobId }
    : { jobAId: rightJobId, jobBId: leftJobId };
}

function valueHash(field: string, value: unknown) {
  return hashCanonicalValue({ schemaVersion: 1, field, value });
}

function exact<T>(left: T | null, right: T | null): left is T {
  return left !== null && right !== null && left === right;
}

function salaryValue(value: JobCanonicalRepresentation) {
  if (value.salaryMin === null && value.salaryMax === null) return null;
  return [
    value.salaryMin?.toFixed(2) ?? null,
    value.salaryMax?.toFixed(2) ?? null,
    value.salaryCurrency,
    value.salaryPeriod,
  ];
}

function locationValue(value: JobCanonicalRepresentation) {
  const tuple = [
    value.countryCode,
    value.canonicalRegion,
    value.canonicalCity,
    value.canonicalLocationLabel,
  ];
  return tuple.some((item) => item !== null) ? tuple : null;
}

function rule(
  code: DuplicateRule["code"],
  strength: DuplicateRule["strength"],
  fields: DuplicateRule["fields"],
  values?: readonly unknown[],
  categories?: readonly string[],
): DuplicateRule {
  return {
    code,
    strength,
    fields,
    ...(values
      ? { valueHashes: values.map((value, index) => valueHash(fields[index] ?? code, value)) }
      : {}),
    ...(categories ? { categories: [...categories] } : {}),
  };
}

function dateDistanceDays(left: Date, right: Date) {
  return Math.abs(left.getTime() - right.getTime()) / 86_400_000;
}

function sameDate(left: Date | null, right: Date | null) {
  return left !== null && right !== null && left.getTime() === right.getTime();
}

export function evaluateDuplicatePair(
  left: JobCanonicalRepresentation,
  right: JobCanonicalRepresentation,
  source: DuplicateSourceEvidence = { sameLiveSource: false, sameLiveSourceHash: false },
) {
  const qualifyingRules: DuplicateRule[] = [];
  const supportingRules: DuplicateRule[] = [];
  const conflictItems: DuplicateConflicts["items"] = [];
  const companyMatch = exact(left.canonicalCompanyName, right.canonicalCompanyName);
  const titleMatch = left.canonicalTitle === right.canonicalTitle;
  const coreMatch = companyMatch && titleMatch;
  const leftLocation = locationValue(left);
  const rightLocation = locationValue(right);
  const locationMatch =
    leftLocation !== null &&
    rightLocation !== null &&
    JSON.stringify(leftLocation) === JSON.stringify(rightLocation);
  const leftSalary = salaryValue(left);
  const rightSalary = salaryValue(right);
  const salaryMatch =
    leftSalary !== null &&
    rightSalary !== null &&
    JSON.stringify(leftSalary) === JSON.stringify(rightSalary);
  const contentMatches = [
    ["description", left.descriptionFingerprint, right.descriptionFingerprint],
    ["responsibilities", left.responsibilitiesFingerprint, right.responsibilitiesFingerprint],
    ["qualifications", left.qualificationsFingerprint, right.qualificationsFingerprint],
    ["skills", left.skillsFingerprint, right.skillsFingerprint],
  ] as const;
  const matchedContent = contentMatches.filter(([, a, b]) => exact(a, b));

  if (exact(left.canonicalSourceUrl, right.canonicalSourceUrl)) {
    qualifyingRules.push(
      rule("EXACT_CANONICAL_URL", "STRONG", ["sourceUrl"], [left.canonicalSourceUrl]),
    );
  }
  if (source.sameLiveSource) {
    qualifyingRules.push(
      rule("SHARED_LIVE_SOURCE", "STRONG", ["sourceProvenance"], undefined, ["LIVE"]),
    );
  }
  if (source.sameLiveSourceHash && coreMatch) {
    qualifyingRules.push(
      rule(
        "SHARED_SOURCE_HASH_AND_CORE",
        "STRONG",
        ["sourceProvenance", "companyName", "title"],
        ["shared", left.canonicalCompanyName, left.canonicalTitle],
      ),
    );
  }
  if (coreMatch && locationMatch) {
    qualifyingRules.push(
      rule(
        "EXACT_COMPANY_TITLE_AND_LOCATION",
        "MODERATE",
        ["companyName", "title", "locationLabel"],
        [left.canonicalCompanyName, left.canonicalTitle, leftLocation],
      ),
    );
  }
  if (coreMatch && sameDate(left.postedAt, right.postedAt) && matchedContent.length > 0) {
    qualifyingRules.push(
      rule(
        "EXACT_CORE_POSTED_AND_CONTENT",
        "MODERATE",
        ["companyName", "title", "postedAt", matchedContent[0]![0]],
        [
          left.canonicalCompanyName,
          left.canonicalTitle,
          left.postedAt?.toISOString().slice(0, 10),
          matchedContent[0]![1],
        ],
      ),
    );
  }

  const corroborators = [
    exact(left.employmentType, right.employmentType),
    exact(left.workplaceArrangement, right.workplaceArrangement),
    exact(left.experienceLevel, right.experienceLevel),
    salaryMatch,
    sameDate(left.postedAt, right.postedAt) || sameDate(left.closesAt, right.closesAt),
    matchedContent.length > 0,
  ].filter(Boolean).length;
  if (coreMatch && corroborators >= 2) {
    qualifyingRules.push(
      rule(
        "EXACT_CORE_WITH_CORROBORATION",
        "MODERATE",
        ["companyName", "title"],
        [left.canonicalCompanyName, left.canonicalTitle],
        [`CORROBORATORS_${corroborators}`],
      ),
    );
  }

  if (titleMatch)
    supportingRules.push(rule("TITLE_MATCH", "WEAK", ["title"], [left.canonicalTitle]));
  if (companyMatch) {
    supportingRules.push(
      rule("COMPANY_MATCH", "WEAK", ["companyName"], [left.canonicalCompanyName]),
    );
  }
  if (exact(left.employmentType, right.employmentType)) {
    supportingRules.push(
      rule("EMPLOYMENT_TYPE_MATCH", "WEAK", ["employmentType"], undefined, [left.employmentType]),
    );
  }
  if (exact(left.workplaceArrangement, right.workplaceArrangement)) {
    supportingRules.push(
      rule("WORKPLACE_ARRANGEMENT_MATCH", "WEAK", ["workplaceArrangement"], undefined, [
        left.workplaceArrangement,
      ]),
    );
  }
  if (exact(left.experienceLevel, right.experienceLevel)) {
    supportingRules.push(
      rule("EXPERIENCE_LEVEL_MATCH", "WEAK", ["experienceLevel"], undefined, [
        left.experienceLevel,
      ]),
    );
  }
  if (salaryMatch) supportingRules.push(rule("SALARY_MATCH", "WEAK", ["salary"], [leftSalary]));
  if (sameDate(left.postedAt, right.postedAt)) {
    supportingRules.push(
      rule("POSTED_DATE_MATCH", "WEAK", ["postedAt"], [left.postedAt?.toISOString().slice(0, 10)]),
    );
  }
  if (sameDate(left.closesAt, right.closesAt)) {
    supportingRules.push(
      rule("CLOSING_DATE_MATCH", "WEAK", ["closesAt"], [left.closesAt?.toISOString().slice(0, 10)]),
    );
  }
  for (const [field, fingerprint] of matchedContent) {
    const code = {
      description: "DESCRIPTION_MATCH",
      responsibilities: "RESPONSIBILITIES_MATCH",
      qualifications: "QUALIFICATIONS_MATCH",
      skills: "SKILLS_MATCH",
    }[field] as DuplicateRule["code"];
    supportingRules.push(rule(code, "WEAK", [field], [fingerprint]));
  }

  if (
    left.canonicalCompanyName !== null &&
    right.canonicalCompanyName !== null &&
    left.canonicalCompanyName !== right.canonicalCompanyName
  ) {
    conflictItems.push({ code: "CANONICAL_COMPANY_MISMATCH", fields: ["companyName"] });
  }
  for (const [field, code, a, b] of [
    ["employmentType", "EMPLOYMENT_TYPE_MISMATCH", left.employmentType, right.employmentType],
    ["countryCode", "COUNTRY_MISMATCH", left.countryCode, right.countryCode],
    ["experienceLevel", "EXPERIENCE_LEVEL_MISMATCH", left.experienceLevel, right.experienceLevel],
    ["salary", "SALARY_CURRENCY_MISMATCH", left.salaryCurrency, right.salaryCurrency],
    ["salary", "SALARY_PERIOD_MISMATCH", left.salaryPeriod, right.salaryPeriod],
  ] as const) {
    if (a !== null && b !== null && a !== b) {
      conflictItems.push({ code, fields: [field], leftCategory: a, rightCategory: b });
    }
  }
  if (
    left.salaryMax !== null &&
    right.salaryMin !== null &&
    left.salaryCurrency === right.salaryCurrency &&
    left.salaryPeriod === right.salaryPeriod &&
    left.salaryMax.lessThan(right.salaryMin)
  ) {
    conflictItems.push({ code: "SALARY_RANGES_NON_OVERLAPPING", fields: ["salary"] });
  } else if (
    right.salaryMax !== null &&
    left.salaryMin !== null &&
    left.salaryCurrency === right.salaryCurrency &&
    left.salaryPeriod === right.salaryPeriod &&
    right.salaryMax.lessThan(left.salaryMin)
  ) {
    conflictItems.push({ code: "SALARY_RANGES_NON_OVERLAPPING", fields: ["salary"] });
  }
  if (left.postedAt && right.postedAt && dateDistanceDays(left.postedAt, right.postedAt) > 45) {
    conflictItems.push({ code: "POSTED_DATE_GAP_OVER_45_DAYS", fields: ["postedAt"] });
  }
  if (
    (left.closesAt && right.postedAt && left.closesAt < right.postedAt) ||
    (right.closesAt && left.postedAt && right.closesAt < left.postedAt)
  ) {
    conflictItems.push({
      code: "CLOSING_DATE_INCOMPATIBLE",
      fields: ["postedAt", "closesAt"],
    });
  }
  if (
    left.canonicalSourceUrl !== null &&
    right.canonicalSourceUrl !== null &&
    left.canonicalSourceUrl !== right.canonicalSourceUrl
  ) {
    conflictItems.push({ code: "CANONICAL_URL_MISMATCH", fields: ["sourceUrl"] });
  }

  qualifyingRules.sort((a, b) => a.code.localeCompare(b.code));
  supportingRules.sort((a, b) => a.code.localeCompare(b.code));
  conflictItems.sort((a, b) => a.code.localeCompare(b.code));
  const evidence = {
    schemaVersion: DUPLICATE_EVIDENCE_SCHEMA_VERSION,
    qualifyingRules,
    supportingRules,
  } satisfies DuplicateEvidence;
  const conflicts = {
    schemaVersion: DUPLICATE_EVIDENCE_SCHEMA_VERSION,
    items: conflictItems,
  } satisfies DuplicateConflicts;
  const tier = qualifyingRules.some((item) => item.strength === "STRONG")
    ? "STRONG"
    : qualifyingRules.length > 0
      ? "MODERATE"
      : null;
  return { qualifies: tier !== null, tier, evidence, conflicts } as const;
}
