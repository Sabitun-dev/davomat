// The pay formula (spec section 6.3, plus optional overtime). Pure function: no database, no clock.
// All times are whole local minutes from midnight; seconds are already dropped.

import type { EventType } from "../shared/attendance.ts";

export type GraceMode = "FULL" | "AFTER_GRACE";

export type DayStatus =
  | "NOT_STARTED"
  | "IN_PROGRESS"
  | "ON_TIME"
  | "LATE"
  | "ABSENT"
  | "DAY_OFF"
  | "EXTRA_DAY";

export interface DayInput {
  /** null = day off (or holiday). */
  schedule: { startMin: number; endMin: number } | null;
  graceMin: number;
  graceMode: GraceMode;
  breakAllowanceMin: number;
  /** The daily amount for this day; null = not filled in. */
  amount: number | null;
  /** Accepted, not-voided events of the day, sorted by time. `auto` = added by the system (auto-close). */
  events: { type: EventType; minute: number; auto?: boolean }[];
  /** Current local minute when the date is today; null when the date is already over. */
  nowMinute: number | null;
  /** Minutes after scheduled end when an open day is closed automatically (default 120). */
  autoCloseAfterMin: number;
  /**
   * Overtime: time worked outside the scheduled hours is paid at the same per-minute rate.
   * Missing = off (the original spec rule: early arrival and late leaving add nothing).
   */
  overtime?: { enabled: boolean; includeEarly: boolean };
}

export interface DayOutput {
  status: DayStatus;
  scheduledMin: number;
  lateMin: number;
  earlyMin: number;
  breakMin: number;
  overageMin: number;
  /** Paid minutes outside the scheduled hours (0 when overtime is off). */
  overtimeMin: number;
  workedMin: number;
  earned: number;
  checkInMin: number | null;
  /** Real check-out, or the scheduled end when auto-closed. */
  checkOutMin: number | null;
  autoClosed: boolean;
  /** "no_checkout", "missing_amount" */
  flags: string[];
  needsReview: boolean;
  /** True when nothing about this day can change any more without a correction. */
  final: boolean;
}

/** round(amount × worked / scheduled), half up, exact integer maths. */
export function proportionalPay(amount: number, worked: number, scheduled: number): number {
  if (scheduled <= 0 || worked <= 0 || amount <= 0) return 0;
  const num = BigInt(amount) * BigInt(worked) * 2n + BigInt(scheduled);
  return Number(num / (BigInt(scheduled) * 2n));
}

export function lateMinutes(checkIn: number, start: number, grace: number, mode: GraceMode): number {
  if (checkIn <= start + grace) return 0;
  return mode === "FULL" ? checkIn - start : checkIn - start - grace;
}

interface Span {
  from: number;
  to: number;
}

/** Break spans from the event list. An open break ends at `openEnd`. */
function breakSpans(events: DayInput["events"], openEnd: number): Span[] {
  const spans: Span[] = [];
  let open: number | null = null;
  for (const e of events) {
    if (e.type === "BREAK_START" && open === null) open = e.minute;
    else if ((e.type === "BREAK_END" || e.type === "CHECK_OUT") && open !== null) {
      spans.push({ from: open, to: e.minute });
      open = null;
    }
  }
  if (open !== null) spans.push({ from: open, to: Math.max(open, openEnd) });
  return spans;
}

function clippedTotal(spans: Span[], from: number, to: number): number {
  let total = 0;
  for (const s of spans) total += Math.max(0, Math.min(s.to, to) - Math.max(s.from, from));
  return total;
}

function empty(status: DayStatus, scheduledMin: number, final: boolean): DayOutput {
  return {
    status,
    scheduledMin,
    lateMin: 0,
    earlyMin: 0,
    breakMin: 0,
    overageMin: 0,
    overtimeMin: 0,
    workedMin: 0,
    earned: 0,
    checkInMin: null,
    checkOutMin: null,
    autoClosed: false,
    flags: [],
    needsReview: false,
    final,
  };
}

export function computeDay(input: DayInput): DayOutput {
  const { schedule, events, nowMinute } = input;
  const dayOver = nowMinute === null;
  const checkIn = events.find((e) => e.type === "CHECK_IN")?.minute ?? null;
  const checkOutEvents = events.filter((e) => e.type === "CHECK_OUT");
  const realOut = checkOutEvents.length ? checkOutEvents[checkOutEvents.length - 1].minute : null;

  // Day off or holiday.
  if (!schedule) {
    if (checkIn === null) return empty("DAY_OFF", 0, dayOver);
    const out = realOut ?? (dayOver ? null : nowMinute);
    const out2 = out ?? checkIn;
    const breaks = clippedTotal(breakSpans(events, out2), checkIn, out2);
    const flags: string[] = [];
    if (realOut === null && dayOver) flags.push("no_checkout");
    return {
      ...empty("EXTRA_DAY", 0, dayOver),
      breakMin: breaks,
      workedMin: Math.max(0, out2 - checkIn - breaks),
      earned: input.amount ?? 0,
      checkInMin: checkIn,
      checkOutMin: realOut,
      autoClosed: realOut === null && dayOver,
      flags,
      needsReview: flags.length > 0,
    };
  }

  const { startMin: start, endMin: end } = schedule;
  const scheduled = Math.max(0, end - start);

  if (checkIn === null) {
    const absent = dayOver || (nowMinute !== null && nowMinute >= end);
    if (!absent) return empty("NOT_STARTED", scheduled, false);
    const result = empty("ABSENT", scheduled, dayOver || nowMinute! >= end + input.autoCloseAfterMin);
    if (input.amount === null) result.flags.push("missing_amount");
    return result;
  }

  const autoCloseAt = end + input.autoCloseAfterMin;
  const closedBySystem = checkOutEvents.length > 0 && checkOutEvents[checkOutEvents.length - 1].auto === true;
  const autoClosed = closedBySystem || (realOut === null && (dayOver || nowMinute! >= autoCloseAt));
  const inProgress = realOut === null && !autoClosed;

  // Inside the scheduled hours: late, early leaving and break overage are taken off.
  // With no check-out the day closes at the scheduled end.
  // While still working, an open break counts until now (and never past the end).
  const openBreakEnd = realOut ?? (inProgress ? Math.min(nowMinute!, end) : end);

  const late = lateMinutes(checkIn, start, input.graceMin, input.graceMode);
  const early = realOut === null || closedBySystem ? 0 : Math.max(0, end - realOut);
  const breakMin = clippedTotal(breakSpans(events, openBreakEnd), start, end);
  const overage = Math.max(0, breakMin - input.breakAllowanceMin);
  const inside = Math.min(scheduled, Math.max(0, scheduled - late - early - overage));
  // Overtime: minutes before start (optional) and after a real check-out past the end,
  // minus breaks taken in those minutes. Auto-closed days never earn overtime.
  let overtime = 0;
  if (input.overtime?.enabled) {
    const spans = breakSpans(events, openBreakEnd);
    if (input.overtime.includeEarly && checkIn < start) overtime += start - checkIn - clippedTotal(spans, checkIn, start);
    if (realOut !== null && !closedBySystem && realOut > end) overtime += realOut - end - clippedTotal(spans, end, realOut);
    overtime = Math.max(0, overtime);
  }
  const worked = inside + overtime;
  const earned = input.amount === null ? 0 : proportionalPay(input.amount, worked, scheduled);

  const flags: string[] = [];
  if (autoClosed) flags.push("no_checkout");
  if (input.amount === null) flags.push("missing_amount");

  return {
    status: inProgress ? "IN_PROGRESS" : late > 0 ? "LATE" : "ON_TIME",
    scheduledMin: scheduled,
    lateMin: late,
    earlyMin: early,
    breakMin,
    overageMin: overage,
    overtimeMin: overtime,
    workedMin: worked,
    earned,
    checkInMin: checkIn,
    checkOutMin: realOut ?? (autoClosed ? end : null),
    autoClosed,
    flags,
    needsReview: autoClosed,
    final: !inProgress,
  };
}
