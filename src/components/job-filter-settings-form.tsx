"use client";

import { MutationForm, SubmitButton } from "./form-controls";
import { Field } from "./field";
import { saveJobFilterProfileAction } from "@/modules/job-hard-filters/actions";
import type { JobFilterConfiguration } from "@/modules/job-hard-filters/public";

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

function MissingPolicy({ name, value }: { name: string; value: "NEEDS_REVIEW" | "FAIL" }) {
  return (
    <Field label="When required data is missing">
      <select name={name} defaultValue={value}>
        <option value="NEEDS_REVIEW">Needs review</option>
        <option value="FAIL">Fail disclosure requirement</option>
      </select>
    </Field>
  );
}

function RuleToggle({ name, checked }: { name: string; checked: boolean }) {
  return (
    <label className="checkbox-field">
      <input type="checkbox" name={name} defaultChecked={checked} />
      <span>Enable this hard constraint</span>
    </label>
  );
}

export function JobFilterSettingsForm({
  configuration,
  version,
}: {
  configuration: JobFilterConfiguration;
  version?: number;
}) {
  const salary = configuration.rules.MINIMUM_SALARY;
  const employment = configuration.rules.ALLOWED_EMPLOYMENT_TYPES;
  const workplace = configuration.rules.ALLOWED_WORKPLACE_ARRANGEMENTS;
  const country = configuration.rules.COUNTRY_ALLOW_DENY;
  return (
    <MutationForm action={saveJobFilterProfileAction} className="form-stack">
      {version ? <input type="hidden" name="expectedVersion" value={version} /> : null}
      <fieldset className="panel form-stack">
        <legend>Minimum salary</legend>
        <RuleToggle name="minimumSalaryEnabled" checked={salary.enabled} />
        <div className="form-grid two-columns">
          <Field label="Minimum amount" hint="No conversion or benchmarking">
            <input name="minimumSalary" inputMode="decimal" defaultValue={salary.minimum ?? ""} />
          </Field>
          <Field label="Currency" hint="Three-letter uppercase code">
            <input name="salaryCurrency" maxLength={3} defaultValue={salary.currency ?? ""} />
          </Field>
          <Field label="Salary period">
            <select name="salaryPeriod" defaultValue={salary.salaryPeriod ?? ""}>
              <option value="">Select a period</option>
              {salaryPeriods.map((value) => (
                <option value={value} key={value}>
                  {label(value)}
                </option>
              ))}
            </select>
          </Field>
          <MissingPolicy name="minimumSalaryMissingPolicy" value={salary.missingDataPolicy} />
        </div>
      </fieldset>

      <fieldset className="panel form-stack">
        <legend>Allowed employment types</legend>
        <RuleToggle name="employmentTypesEnabled" checked={employment.enabled} />
        <div className="checkbox-grid">
          {employmentTypes.map((value) => (
            <label className="checkbox-field" key={value}>
              <input
                type="checkbox"
                name="allowedEmploymentTypes"
                value={value}
                defaultChecked={employment.allowedEmploymentTypes.includes(value)}
              />
              <span>{label(value)}</span>
            </label>
          ))}
        </div>
        <MissingPolicy name="employmentTypesMissingPolicy" value={employment.missingDataPolicy} />
      </fieldset>

      <fieldset className="panel form-stack">
        <legend>Allowed workplace arrangements</legend>
        <RuleToggle name="workplaceArrangementsEnabled" checked={workplace.enabled} />
        <div className="checkbox-grid">
          {arrangements.map((value) => (
            <label className="checkbox-field" key={value}>
              <input
                type="checkbox"
                name="allowedWorkplaceArrangements"
                value={value}
                defaultChecked={workplace.allowedWorkplaceArrangements.includes(value)}
              />
              <span>{label(value)}</span>
            </label>
          ))}
        </div>
        <MissingPolicy
          name="workplaceArrangementsMissingPolicy"
          value={workplace.missingDataPolicy}
        />
      </fieldset>

      <fieldset className="panel form-stack">
        <legend>Country allow/deny</legend>
        <RuleToggle name="countryAllowDenyEnabled" checked={country.enabled} />
        <div className="form-grid two-columns">
          <Field
            label="Allowed country codes"
            hint="Two-letter codes, one per line or comma-separated"
          >
            <textarea
              name="allowedCountryCodes"
              rows={5}
              defaultValue={country.allowedCountryCodes.join("\n")}
            />
          </Field>
          <Field label="Excluded country codes" hint="Denylist takes precedence">
            <textarea
              name="excludedCountryCodes"
              rows={5}
              defaultValue={country.excludedCountryCodes.join("\n")}
            />
          </Field>
        </div>
        <MissingPolicy name="countryMissingPolicy" value={country.missingDataPolicy} />
      </fieldset>

      <div className="notice">
        A FAIL result is informational. It never archives, rejects, deletes, hides, or submits a
        Job.
      </div>
      <SubmitButton>
        {version ? "Save filters and reevaluate Jobs" : "Create filters and evaluate Jobs"}
      </SubmitButton>
    </MutationForm>
  );
}
