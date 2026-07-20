import { createHash } from "node:crypto";

import type { Job } from "@/generated/prisma/client";

export const JOB_CANONICALIZATION_VERSION = 1 as const;
export const JOB_URL_CANONICALIZATION_VERSION = 1 as const;

const trackingParameter = /^(?:utm_[a-z0-9_]+|gclid|dclid|fbclid|msclkid)$/i;
const percentEscape = /%[0-9a-fA-F]{2}/g;
const unreserved = /^[A-Za-z0-9\-._~]$/;

export function hashCanonicalValue(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

export function canonicalizeComparisonText(value: string) {
  return value.normalize("NFKC").toLowerCase().trim().replace(/\s+/gu, " ");
}

function normalizePercentEscapes(value: string) {
  return value.replace(percentEscape, (escape) => {
    const decoded = String.fromCharCode(Number.parseInt(escape.slice(1), 16));
    return unreserved.test(decoded) ? decoded : escape.toUpperCase();
  });
}

export function canonicalizeSourceUrl(value: string) {
  const parsed = new URL(value);
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error("Canonical source URLs must be credential-free HTTP(S) URLs.");
  }

  parsed.hash = "";
  if (
    (parsed.protocol === "http:" && parsed.port === "80") ||
    (parsed.protocol === "https:" && parsed.port === "443")
  ) {
    parsed.port = "";
  }
  parsed.pathname = normalizePercentEscapes(parsed.pathname);

  const retained = new URLSearchParams();
  for (const [name, parameterValue] of parsed.searchParams.entries()) {
    if (!trackingParameter.test(name)) retained.append(name, parameterValue);
  }
  parsed.search = retained.toString();
  return parsed.toString();
}

function fingerprintText(value: string | null) {
  if (value === null) return null;
  return hashCanonicalValue({ version: 1, value: canonicalizeComparisonText(value) });
}

function fingerprintItems(values: readonly string[]) {
  if (values.length === 0) return null;
  const canonical = values.map(canonicalizeComparisonText).sort();
  return hashCanonicalValue({ version: 1, values: canonical });
}

function nullableText(value: string | null) {
  return value === null ? null : canonicalizeComparisonText(value);
}

export function canonicalizeJob(job: Job) {
  const canonicalTitle = canonicalizeComparisonText(job.title);
  const canonicalCompanyName = nullableText(job.companyName);
  const canonicalRegion = nullableText(job.region);
  const canonicalCity = nullableText(job.city);
  const canonicalLocationLabel = nullableText(job.locationLabel);
  const canonicalSourceUrl = job.sourceUrl ? canonicalizeSourceUrl(job.sourceUrl) : null;
  const descriptionFingerprint = fingerprintText(job.description);
  const responsibilitiesFingerprint = fingerprintItems(job.responsibilities);
  const qualificationsFingerprint = fingerprintItems(job.qualifications);
  const skillsFingerprint = fingerprintItems(job.skills);
  const structuredParts = [
    descriptionFingerprint,
    responsibilitiesFingerprint,
    qualificationsFingerprint,
    skillsFingerprint,
  ].filter((value): value is string => value !== null);
  const structuredContentFingerprint =
    structuredParts.length > 0
      ? hashCanonicalValue({ version: 1, fingerprints: structuredParts })
      : null;
  const locationTuple = [job.countryCode, canonicalRegion, canonicalCity, canonicalLocationLabel];
  const hasLocation = locationTuple.some((value) => value !== null);
  const companyTitleHash = canonicalCompanyName
    ? hashCanonicalValue({ version: 1, company: canonicalCompanyName, title: canonicalTitle })
    : null;
  const companyTitleLocationHash =
    canonicalCompanyName && hasLocation
      ? hashCanonicalValue({
          version: 1,
          company: canonicalCompanyName,
          title: canonicalTitle,
          location: locationTuple,
        })
      : null;
  const comparisonPayload = {
    version: JOB_CANONICALIZATION_VERSION,
    canonicalTitle,
    canonicalCompanyName,
    employmentType: job.employmentType,
    workplaceArrangement: job.workplaceArrangement,
    experienceLevel: job.experienceLevel,
    countryCode: job.countryCode,
    canonicalRegion,
    canonicalCity,
    canonicalLocationLabel,
    salaryMin: job.salaryMin?.toFixed(2) ?? null,
    salaryMax: job.salaryMax?.toFixed(2) ?? null,
    salaryCurrency: job.salaryCurrency,
    salaryPeriod: job.salaryPeriod,
    postedAt: job.postedAt?.toISOString().slice(0, 10) ?? null,
    closesAt: job.closesAt?.toISOString().slice(0, 10) ?? null,
    canonicalSourceUrl,
    descriptionFingerprint,
    responsibilitiesFingerprint,
    qualificationsFingerprint,
    skillsFingerprint,
    structuredContentFingerprint,
  };

  return {
    canonicalizationVersion: JOB_CANONICALIZATION_VERSION,
    urlCanonicalizationVersion: JOB_URL_CANONICALIZATION_VERSION,
    sourceJobVersion: job.version,
    canonicalTitle,
    canonicalCompanyName,
    employmentType: job.employmentType,
    workplaceArrangement: job.workplaceArrangement,
    experienceLevel: job.experienceLevel,
    countryCode: job.countryCode,
    canonicalRegion,
    canonicalCity,
    canonicalLocationLabel,
    salaryMin: job.salaryMin,
    salaryMax: job.salaryMax,
    salaryCurrency: job.salaryCurrency,
    salaryPeriod: job.salaryPeriod,
    postedAt: job.postedAt,
    closesAt: job.closesAt,
    canonicalSourceUrl,
    canonicalSourceUrlHash: canonicalSourceUrl ? hashCanonicalValue(canonicalSourceUrl) : null,
    companyTitleHash,
    companyTitleLocationHash,
    descriptionFingerprint,
    responsibilitiesFingerprint,
    qualificationsFingerprint,
    skillsFingerprint,
    structuredContentFingerprint,
    comparisonHash: hashCanonicalValue(comparisonPayload),
  };
}
