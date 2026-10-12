/**
 * The weekly session window: only custom games that start inside it are
 * imported from the API. Default Saturday 18:30 to Sunday 03:30, Irish time
 * (a little either side of the 19:00-03:00 session). Times are wall-clock in
 * the club's time zone, so daylight-saving changes need no attention.
 */
import { TIME_ZONE, local, zonedToUtc } from "../time";

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export interface WeeklySpec { day: number; start: [number, number]; end: [number, number] }
export interface Window { start: Date; end: Date }

/** "sat 18:30-03:30" -> spec; "off" -> null (any time counts). An end at or before the start is the next day. */
export function parseWindow(text = process.env.VAL_WINDOW ?? "sat 18:30-03:30"): WeeklySpec | null {
  const t = text.trim().toLowerCase();
  if (t === "off" || t === "") return null;
  const m = /^([a-z]{3})\w*\s+(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/.exec(t);
  if (!m || !DAYS.includes(m[1])) throw new Error(`VAL_WINDOW should look like "sat 18:30-03:30" or "off", not "${text}"`);
  return { day: DAYS.indexOf(m[1]), start: [Number(m[2]), Number(m[3])], end: [Number(m[4]), Number(m[5])] };
}

const dayOfWeek = (y: number, mo: number, d: number) => new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
const addDays = (y: number, mo: number, d: number, n: number): [number, number, number] => {
  const x = new Date(Date.UTC(y, mo - 1, d + n));
  return [x.getUTCFullYear(), x.getUTCMonth() + 1, x.getUTCDate()];
};

/** The window that starts on a given local date (which must be the window's day). */
function windowOn(spec: WeeklySpec, y: number, mo: number, d: number, tz: string): Window {
  const start = zonedToUtc(y, mo, d, spec.start[0], spec.start[1], 0, tz);
  const overnight = spec.end[0] * 60 + spec.end[1] <= spec.start[0] * 60 + spec.start[1];
  const [ey, emo, ed] = overnight ? addDays(y, mo, d, 1) : [y, mo, d];
  return { start, end: zonedToUtc(ey, emo, ed, spec.end[0], spec.end[1], 0, tz) };
}

/** The window containing `at`, or else the next one to start. */
export function weeklyWindow(at: Date, spec: WeeklySpec, tz = TIME_ZONE): Window {
  const p = local(at, tz);
  const [y, mo, d] = [Number(p.year), Number(p.month), Number(p.day)];
  for (let back = 1; back >= 0; back--) {
    const [wy, wmo, wd] = addDays(y, mo, d, -back);
    if (dayOfWeek(wy, wmo, wd) !== spec.day) continue;
    const w = windowOn(spec, wy, wmo, wd, tz);
    if (at < w.end) return w;
  }
  for (let ahead = 1; ahead <= 7; ahead++) {
    const [wy, wmo, wd] = addDays(y, mo, d, ahead);
    if (dayOfWeek(wy, wmo, wd) === spec.day) return windowOn(spec, wy, wmo, wd, tz);
  }
  throw new Error("unreachable");
}

export function inWeeklyWindow(at: Date, spec = parseWindow(), tz = TIME_ZONE): boolean {
  if (!spec) return true;
  const w = weeklyWindow(at, spec, tz);
  return w.start <= at && at < w.end;
}

/** A wall-clock time on the window's day, e.g. sign-ups opening at "12:00". */
export function timeOnWindowDay(w: Window, hhmm: string, tz = TIME_ZONE): Date {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) throw new Error(`expected a time like 18:45, not "${hhmm}"`);
  const p = local(w.start, tz);
  return zonedToUtc(Number(p.year), Number(p.month), Number(p.day), Number(m[1]), Number(m[2]), 0, tz);
}
