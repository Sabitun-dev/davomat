// Time-zone helpers that work the same on the server and in the browser (only Intl is used).
// A "date" is a plain "YYYY-MM-DD" string in a branch's local time.
// A "minute" is minutes from local midnight (0..1439). Seconds are always ignored.

export interface LocalParts {
  date: string;
  minute: number;
  second: number;
  /** ISO weekday: 1 = Monday ... 7 = Sunday */
  weekday: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(tz, f);
  }
  return f;
}

export function isValidTimeZone(tz: string): boolean {
  try {
    formatter(tz);
    return true;
  } catch {
    return false;
  }
}

export function toLocal(instant: Date, tz: string): LocalParts {
  const parts: Record<string, string> = {};
  for (const p of formatter(tz).formatToParts(instant)) parts[p.type] = p.value;
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const hour = Number(parts.hour) % 24;
  return {
    date,
    minute: hour * 60 + Number(parts.minute),
    second: Number(parts.second),
    weekday: weekdayOf(date),
  };
}

/** Local time minus UTC, in minutes, at that instant. */
export function offsetMinutes(instant: Date, tz: string): number {
  const l = toLocal(instant, tz);
  const [y, m, d] = l.date.split("-").map(Number);
  const asUtc = Date.UTC(y, m - 1, d, Math.floor(l.minute / 60), l.minute % 60, l.second);
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60000);
}

/** The UTC instant of a local date + minute in a time zone. */
export function localToUtc(date: string, minute: number, tz: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d) + minute * 60000;
  const off1 = offsetMinutes(new Date(guess), tz);
  let result = guess - off1 * 60000;
  const off2 = offsetMinutes(new Date(result), tz);
  if (off2 !== off1) result = guess - off2 * 60000;
  return new Date(result);
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function weekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return js === 0 ? 7 : js;
}

export function monthOf(date: string): string {
  return date.slice(0, 7);
}

export function isValidDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

export function isValidMonth(month: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(month);
}

export function daysInMonth(month: string): string[] {
  const [y, m] = month.split("-").map(Number);
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: count }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
}

export function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  return t.toISOString().slice(0, 7);
}

export function minuteToHHMM(minute: number): string {
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** "09:30" -> 570. Returns null when the text is not a valid time. */
export function parseHHMM(text: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}

/** Local minute of an instant with seconds dropped (09:00:59 -> 540). */
export function localMinute(instant: Date, tz: string): number {
  return toLocal(instant, tz).minute;
}

/** Local "HH:MM" of an instant. */
export function localHHMM(instant: Date | string, tz: string): string {
  return minuteToHHMM(localMinute(new Date(instant), tz));
}
