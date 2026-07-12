export function sameOptionalValue(left: unknown, right: unknown) {
  const normalize = (value: unknown) =>
    value === undefined || value === null || value === "" ? null : value;
  return normalize(left) === normalize(right);
}

export function sameOptionalDate(
  left: Date | string | null | undefined,
  right: Date | string | null | undefined,
) {
  const normalize = (value: Date | string | null | undefined) => {
    if (value === undefined || value === null || value === "") return null;
    return (value instanceof Date ? value : new Date(value)).toISOString();
  };
  return normalize(left) === normalize(right);
}

export function sameOrderedValues(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
