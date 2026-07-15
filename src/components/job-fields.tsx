import { Field } from "./field";
import type { JobValues } from "@/modules/jobs/schemas";

function options(values: readonly string[]) {
  return values.map((value) => (
    <option key={value} value={value}>
      {value
        .replaceAll("_", " ")
        .toLowerCase()
        .replace(/^./, (letter) => letter.toUpperCase())}
    </option>
  ));
}

function list(value: readonly string[]) {
  return value.join("\n");
}

export function JobFields({ values }: { values: JobValues }) {
  return (
    <div className="page-stack">
      <div className="form-grid two-columns">
        <Field label="Job title" hint="Required before confirmation">
          <input name="title" maxLength={200} defaultValue={values.title ?? ""} required />
        </Field>
        <Field label="Company name">
          <input name="companyName" maxLength={200} defaultValue={values.companyName ?? ""} />
        </Field>
        <Field label="Employment type">
          <select name="employmentType" defaultValue={values.employmentType ?? ""}>
            <option value="">Unknown</option>
            {options([
              "FULL_TIME",
              "PART_TIME",
              "CONTRACT",
              "TEMPORARY",
              "INTERNSHIP",
              "APPRENTICESHIP",
              "VOLUNTEER",
              "OTHER",
            ])}
          </select>
        </Field>
        <Field label="Workplace arrangement">
          <select name="workplaceArrangement" defaultValue={values.workplaceArrangement ?? ""}>
            <option value="">Unknown</option>
            {options(["ON_SITE", "HYBRID", "REMOTE", "FIELD_BASED", "OTHER"])}
          </select>
        </Field>
        <Field label="Experience level">
          <select name="experienceLevel" defaultValue={values.experienceLevel ?? ""}>
            <option value="">Unknown</option>
            {options([
              "INTERNSHIP",
              "ENTRY_LEVEL",
              "MID_LEVEL",
              "SENIOR",
              "LEAD",
              "MANAGER",
              "DIRECTOR",
              "EXECUTIVE",
              "OTHER",
            ])}
          </select>
        </Field>
        <Field label="Raw location label" hint="Preserved without automatic splitting">
          <input name="locationLabel" maxLength={300} defaultValue={values.locationLabel ?? ""} />
        </Field>
        <Field label="Country code" hint="Two-letter code">
          <input name="countryCode" maxLength={2} defaultValue={values.countryCode ?? ""} />
        </Field>
        <Field label="Region">
          <input name="region" maxLength={160} defaultValue={values.region ?? ""} />
        </Field>
        <Field label="City">
          <input name="city" maxLength={160} defaultValue={values.city ?? ""} />
        </Field>
        <Field label="Source URL" hint="Validated but never fetched">
          <input
            name="sourceUrl"
            type="url"
            maxLength={2048}
            defaultValue={values.sourceUrl ?? ""}
          />
        </Field>
        <Field label="Salary minimum">
          <input name="salaryMin" inputMode="decimal" defaultValue={values.salaryMin ?? ""} />
        </Field>
        <Field label="Salary maximum">
          <input name="salaryMax" inputMode="decimal" defaultValue={values.salaryMax ?? ""} />
        </Field>
        <Field label="Salary currency" hint="Three-letter code">
          <input name="salaryCurrency" maxLength={3} defaultValue={values.salaryCurrency ?? ""} />
        </Field>
        <Field label="Salary period">
          <select name="salaryPeriod" defaultValue={values.salaryPeriod ?? ""}>
            <option value="">Unknown</option>
            {options(["HOUR", "DAY", "WEEK", "MONTH", "YEAR", "PROJECT", "OTHER"])}
          </select>
        </Field>
        <Field label="Posted date">
          <input name="postedDate" type="date" defaultValue={values.postedDate ?? ""} />
        </Field>
        <Field label="Closing date">
          <input name="closingDate" type="date" defaultValue={values.closingDate ?? ""} />
        </Field>
      </div>
      <Field label="Description" hint="Plain text only">
        <textarea name="description" rows={12} defaultValue={values.description ?? ""} />
      </Field>
      <div className="form-grid two-columns">
        <Field label="Responsibilities" hint="One item per line">
          <textarea name="responsibilities" rows={8} defaultValue={list(values.responsibilities)} />
        </Field>
        <Field label="Qualifications" hint="One item per line">
          <textarea name="qualifications" rows={8} defaultValue={list(values.qualifications)} />
        </Field>
        <Field label="Preferred qualifications" hint="One item per line">
          <textarea
            name="preferredQualifications"
            rows={8}
            defaultValue={list(values.preferredQualifications)}
          />
        </Field>
        <Field label="Benefits" hint="One item per line">
          <textarea name="benefits" rows={8} defaultValue={list(values.benefits)} />
        </Field>
        <Field label="Skills explicitly mentioned" hint="One item per line">
          <textarea name="skills" rows={8} defaultValue={list(values.skills)} />
        </Field>
        <Field label="Application instructions">
          <textarea
            name="applicationInstructions"
            rows={8}
            defaultValue={values.applicationInstructions ?? ""}
          />
        </Field>
        <Field label="Contact details" hint="Sensitive: excluded from logs and audits">
          <textarea name="contactDetails" rows={6} defaultValue={values.contactDetails ?? ""} />
        </Field>
        <Field label="Notes">
          <textarea name="notes" rows={6} defaultValue={values.notes ?? ""} />
        </Field>
      </div>
    </div>
  );
}
