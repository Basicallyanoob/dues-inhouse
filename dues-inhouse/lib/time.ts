/** Club time zone: logs are named in Irish time, and pages show Irish time. */
export const TIME_ZONE = process.env.CLUB_TIME_ZONE || "Europe/Dublin";

/** The UTC instant for a wall-clock time in the club's time zone. */
export function zonedToUtc(y: number, mo: number, d: number, h: number, mi: number, s: number, tz = TIME_ZONE): Date {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  const offset = (at: number) => {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(new Date(at));
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")) - at;
  };
  // Two passes settle daylight-saving changes.
  let utc = guess - offset(guess);
  utc = guess - offset(utc);
  return new Date(utc);
}

/** Parts of a date as the club sees it. */
export function local(date: Date, tz = TIME_ZONE) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", weekday: "short",
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute"), weekday: get("weekday") };
}

/** "2026-10-14": the club night a game belongs to. Games before 5am count towards the night before. */
export function nightKey(date: Date): string {
  const p = local(new Date(date.getTime() - 5 * 3600 * 1000));
  return `${p.year}-${p.month}-${p.day}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function dayLabel(date: Date): string {
  const p = local(date);
  return `${p.weekday} ${Number(p.day)} ${MONTHS[Number(p.month) - 1]} ${p.year}`;
}

export function shortDay(date: Date): string {
  const p = local(date);
  return `${Number(p.day)} ${MONTHS[Number(p.month) - 1]}`;
}

export function clock(date: Date): string {
  const p = local(date);
  return `${p.hour}:${p.minute}`;
}

export function nightLabel(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return dayLabel(zonedToUtc(y, m, d, 12, 0, 0));
}
