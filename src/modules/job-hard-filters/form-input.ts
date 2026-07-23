import { readString } from "@/modules/shared/validation";

import { defaultJobFilterConfiguration, jobFilterConfigurationSchema } from "./schemas";

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

export function readJobFilterConfigurationForm(formData: FormData) {
  const configuration = defaultJobFilterConfiguration();
  const salary = configuration.rules.MINIMUM_SALARY;
  salary.enabled = checked(formData, "minimumSalaryEnabled");
  salary.minimum = readString(formData, "minimumSalary")?.trim() || null;
  salary.currency = nullable(readString(formData, "salaryCurrency"));
  salary.salaryPeriod = nullable(
    readString(formData, "salaryPeriod"),
  ) as typeof salary.salaryPeriod;
  salary.missingDataPolicy =
    readString(formData, "minimumSalaryMissingPolicy") === "FAIL" ? "FAIL" : "NEEDS_REVIEW";

  const employment = configuration.rules.ALLOWED_EMPLOYMENT_TYPES;
  employment.enabled = checked(formData, "employmentTypesEnabled");
  employment.allowedEmploymentTypes = formData
    .getAll("allowedEmploymentTypes")
    .filter(
      (value): value is string => typeof value === "string",
    ) as typeof employment.allowedEmploymentTypes;
  employment.missingDataPolicy =
    readString(formData, "employmentTypesMissingPolicy") === "FAIL" ? "FAIL" : "NEEDS_REVIEW";

  const workplace = configuration.rules.ALLOWED_WORKPLACE_ARRANGEMENTS;
  workplace.enabled = checked(formData, "workplaceArrangementsEnabled");
  workplace.allowedWorkplaceArrangements = formData
    .getAll("allowedWorkplaceArrangements")
    .filter(
      (value): value is string => typeof value === "string",
    ) as typeof workplace.allowedWorkplaceArrangements;
  workplace.missingDataPolicy =
    readString(formData, "workplaceArrangementsMissingPolicy") === "FAIL" ? "FAIL" : "NEEDS_REVIEW";

  const country = configuration.rules.COUNTRY_ALLOW_DENY;
  country.enabled = checked(formData, "countryAllowDenyEnabled");
  country.allowedCountryCodes = lines(readString(formData, "allowedCountryCodes"));
  country.excludedCountryCodes = lines(readString(formData, "excludedCountryCodes"));
  country.missingDataPolicy =
    readString(formData, "countryMissingPolicy") === "FAIL" ? "FAIL" : "NEEDS_REVIEW";

  return jobFilterConfigurationSchema.parse(configuration);
}
