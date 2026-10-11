import { local } from "./time";

/** A date as a datetime-local input value, in Irish time. */
export function toInputValue(d: Date | null | undefined): string {
  if (!d) return "";
  const p = local(new Date(d));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
