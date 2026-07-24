"use client";

import type { JobScoringConfiguration } from "@/modules/job-scoring/public";
import { saveJobScoringProfileAction } from "@/modules/job-scoring/actions";

import { Field } from "./field";
import { MutationForm, SubmitButton } from "./form-controls";

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
const arrangements = ["ON_SITE", "HYBRID", "REMOTE", "FIELD_BASED", "OTHER"] as const;
const salaryPeriods = ["HOUR", "DAY", "WEEK", "MONTH", "YEAR", "PROJECT", "OTHER"] as const;

function label(value: string) {
  return value
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/^./u, (letter) => letter.toUpperCase());
}

function ComponentHeader({
  enabledName,
  weightName,
  enabled,
  weight,
}: {
  enabledName: string;
  weightName: string;
  enabled: boolean;
  weight: number;
}) {
  return (
    <div className="form-grid two-columns">
      <label className="checkbox-field">
        <input type="checkbox" name={enabledName} defaultChecked={enabled} />
        <span>Enable this scoring component</span>
      </label>
      <Field label="Weight" hint="Enabled weights must total exactly 100">
        <input name={weightName} type="number" min={0} max={100} step={1} defaultValue={weight} />
      </Field>
    </div>
  );
}

function tierFor(
  value: string,
  tiers: Readonly<{
    mostPreferred: readonly string[];
    acceptable: readonly string[];
    lessPreferred: readonly string[];
  }>,
) {
  if (tiers.mostPreferred.includes(value)) return "MOST_PREFERRED";
  if (tiers.acceptable.includes(value)) return "ACCEPTABLE";
  if (tiers.lessPreferred.includes(value)) return "LESS_PREFERRED";
  return "NOT_PREFERRED";
}

function TierSelects({
  prefix,
  values,
  tiers,
}: {
  prefix: string;
  values: readonly string[];
  tiers: Readonly<{
    mostPreferred: readonly string[];
    acceptable: readonly string[];
    lessPreferred: readonly string[];
  }>;
}) {
  return (
    <div className="form-grid two-columns">
      {values.map((value) => (
        <Field label={label(value)} key={value}>
          <select name={`${prefix}_${value}`} defaultValue={tierFor(value, tiers)}>
            <option value="MOST_PREFERRED">Most preferred · 100</option>
            <option value="ACCEPTABLE">Acceptable · 70</option>
            <option value="LESS_PREFERRED">Less preferred · 40</option>
            <option value="NOT_PREFERRED">Not preferred · 0</option>
          </select>
        </Field>
      ))}
    </div>
  );
}

export function JobScoringSettingsForm({
  configuration,
  version,
}: {
  configuration: JobScoringConfiguration;
  version?: number;
}) {
  const salary = configuration.components.SALARY;
  const employment = configuration.components.EMPLOYMENT_TYPE;
  const workplace = configuration.components.WORKPLACE_ARRANGEMENT;
  const country = configuration.components.COUNTRY;
  return (
    <MutationForm action={saveJobScoringProfileAction} className="form-stack">
      {version ? <input type="hidden" name="expectedVersion" value={version} /> : null}
      <fieldset className="panel form-stack">
        <legend>Salary preference</legend>
        <ComponentHeader
          enabledName="salaryEnabled"
          weightName="salaryWeight"
          enabled={salary.enabled}
          weight={salary.weight}
        />
        <div className="form-grid two-columns">
          <Field label="Preferred minimum" hint="At this amount the raw score is 60">
            <input
              name="preferredMinimum"
              inputMode="decimal"
              defaultValue={salary.preferredMinimum ?? ""}
            />
          </Field>
          <Field label="Target amount" hint="At or above this amount the raw score is 100">
            <input name="salaryTarget" inputMode="decimal" defaultValue={salary.target ?? ""} />
          </Field>
          <Field label="Currency" hint="Exact three-letter code; no conversion">
            <input
              name="scoringSalaryCurrency"
              maxLength={3}
              defaultValue={salary.currency ?? ""}
            />
          </Field>
          <Field label="Salary period">
            <select name="scoringSalaryPeriod" defaultValue={salary.salaryPeriod ?? ""}>
              <option value="">Select a period</option>
              {salaryPeriods.map((value) => (
                <option value={value} key={value}>
                  {label(value)}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </fieldset>

      <fieldset className="panel form-stack">
        <legend>Employment-type preference</legend>
        <ComponentHeader
          enabledName="employmentTypeEnabled"
          weightName="employmentTypeWeight"
          enabled={employment.enabled}
          weight={employment.weight}
        />
        <TierSelects prefix="employmentTier" values={employmentTypes} tiers={employment.tiers} />
      </fieldset>

      <fieldset className="panel form-stack">
        <legend>Workplace-arrangement preference</legend>
        <ComponentHeader
          enabledName="workplaceArrangementEnabled"
          weightName="workplaceArrangementWeight"
          enabled={workplace.enabled}
          weight={workplace.weight}
        />
        <TierSelects prefix="workplaceTier" values={arrangements} tiers={workplace.tiers} />
      </fieldset>

      <fieldset className="panel form-stack">
        <legend>Country preference</legend>
        <ComponentHeader
          enabledName="countryEnabled"
          weightName="countryWeight"
          enabled={country.enabled}
          weight={country.weight}
        />
        <div className="form-grid three-columns">
          <Field label="Most preferred · 100" hint="Two-letter codes, one per line">
            <textarea
              name="mostPreferredCountryCodes"
              rows={5}
              defaultValue={country.tiers.mostPreferred.join("\n")}
            />
          </Field>
          <Field label="Acceptable · 70" hint="Two-letter codes, one per line">
            <textarea
              name="acceptableCountryCodes"
              rows={5}
              defaultValue={country.tiers.acceptable.join("\n")}
            />
          </Field>
          <Field label="Less preferred · 40" hint="Two-letter codes, one per line">
            <textarea
              name="lessPreferredCountryCodes"
              rows={5}
              defaultValue={country.tiers.lessPreferred.join("\n")}
            />
          </Field>
        </div>
      </fieldset>

      <div className="notice">
        Missing or incomparable data is excluded from the denominator and shown through coverage.
        Preliminary score reflects Job preferences only. Candidate qualification and evidence
        matching are evaluated separately.
      </div>
      <SubmitButton>
        {version
          ? "Save scoring profile and rescore Jobs"
          : "Create scoring profile and score Jobs"}
      </SubmitButton>
    </MutationForm>
  );
}
