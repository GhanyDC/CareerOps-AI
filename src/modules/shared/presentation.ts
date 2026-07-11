export function humanizeEnum(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function formatDate(value: Date | null | undefined) {
  if (!value) return "Not specified";
  return new Intl.DateTimeFormat("en", { year: "numeric", month: "short" }).format(value);
}

export function dateInputValue(value: Date | null | undefined) {
  return value ? value.toISOString().slice(0, 10) : "";
}

export function listInputValue(values: readonly string[] | undefined) {
  return values?.join(", ") ?? "";
}
