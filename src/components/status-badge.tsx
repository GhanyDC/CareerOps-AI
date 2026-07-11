import { humanizeEnum } from "@/modules/shared/presentation";

export function StatusBadge({ value }: { value: string }) {
  return <span className={`status status-${value.toLowerCase()}`}>{humanizeEnum(value)}</span>;
}
