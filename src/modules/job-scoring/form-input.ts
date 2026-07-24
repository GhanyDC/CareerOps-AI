import { readString } from "@/modules/shared/validation";

import { defaultJobScoringConfiguration, jobScoringConfigurationSchema } from "./schemas";

const employmentTypes = [
  "FULL_TIME",
  "PART_TIME",
  "CONTRACT",
  "TEMPORARY",
  "INTERNSHIP",
  "APPRENTICESHIP",
  "VOLUNTEER",
  "OTHER",
] as const;
const workplaceArrangements = ["ON_SITE", "HYBRID", "REMOTE", "FIELD_BASED", "OTHER"] as const;

function checked(formData: FormData, name: string) {
  return readString(formData, name) === "on";
}

function nullable(value: string | undefined) {
  const normalized = value?.trim().toUpperCase();
  return normalized ? normalized : null;
}

function lines(value: string | undefined) {
  return [
    ...new Set(
      (value ?? "")
        .split(/\r?\n|,/u)
        .map((item) => item.trim().toUpperCase())
        .filter(Boolean),
    ),
  ];
}

function weight(formData: FormData, name: string, enabled: boolean) {
  return enabled ? Number(readString(formData, name) ?? "0") : 0;
}

function tieredEnum<T extends string>(
  formData: FormData,
  namePrefix: string,
  values: readonly T[],
) {
  const tiers = {
    mostPreferred: [] as T[],
    acceptable: [] as T[],
    lessPreferred: [] as T[],
  };
  for (const value of values) {
    const tier = readString(formData, `${namePrefix}_${value}`);
    if (tier === "MOST_PREFERRED") tiers.mostPreferred.push(value);
    if (tier === "ACCEPTABLE") tiers.acceptable.push(value);
    if (tier === "LESS_PREFERRED") tiers.lessPreferred.push(value);
  }
  return tiers;
}

export function readJobScoringConfigurationForm(formData: FormData) {
  const configuration = defaultJobScoringConfiguration();

  const salary = configuration.components.SALARY;
  salary.enabled = checked(formData, "salaryEnabled");
  salary.weight = weight(formData, "salaryWeight", salary.enabled);
  salary.preferredMinimum = readString(formData, "preferredMinimum")?.trim() || null;
  salary.target = readString(formData, "salaryTarget")?.trim() || null;
  salary.currency = nullable(readString(formData, "scoringSalaryCurrency"));
  salary.salaryPeriod = nullable(
    readString(formData, "scoringSalaryPeriod"),
  ) as typeof salary.salaryPeriod;

  const employment = configuration.components.EMPLOYMENT_TYPE;
  employment.enabled = checked(formData, "employmentTypeEnabled");
  employment.weight = weight(formData, "employmentTypeWeight", employment.enabled);
  employment.tiers = tieredEnum(formData, "employmentTier", employmentTypes);

  const workplace = configuration.components.WORKPLACE_ARRANGEMENT;
  workplace.enabled = checked(formData, "workplaceArrangementEnabled");
  workplace.weight = weight(formData, "workplaceArrangementWeight", workplace.enabled);
  workplace.tiers = tieredEnum(formData, "workplaceTier", workplaceArrangements);

  const country = configuration.components.COUNTRY;
  country.enabled = checked(formData, "countryEnabled");
  country.weight = weight(formData, "countryWeight", country.enabled);
  country.tiers = {
    mostPreferred: lines(readString(formData, "mostPreferredCountryCodes")),
    acceptable: lines(readString(formData, "acceptableCountryCodes")),
    lessPreferred: lines(readString(formData, "lessPreferredCountryCodes")),
  };

  return jobScoringConfigurationSchema.parse(configuration);
}
