// Which hours apply to a worker on a date (spec 6.1). Most specific wins:
//   1. the worker's own override for that date
//   2. the branch override for that date (holiday, short day)
//   3. the worker's own weekly template
//   4. the branch weekly template
// No row at all = day off.

import { db, type Tx } from "../lib/db.ts";
import { daysInMonth, weekdayOf } from "../shared/time.ts";

export interface Slot {
  startMin: number | null;
  endMin: number | null;
  dayOff: boolean;
}

export interface ResolvedDay {
  /** null = day off or holiday. */
  schedule: { startMin: number; endMin: number } | null;
  holiday: boolean;
  source: "user_override" | "branch_override" | "user_template" | "branch_template" | "none";
}

function toResolved(slot: Slot & { holiday?: boolean }, source: ResolvedDay["source"]): ResolvedDay {
  const working = !slot.dayOff && !slot.holiday && slot.startMin !== null && slot.endMin !== null && slot.endMin > slot.startMin;
  return {
    schedule: working ? { startMin: slot.startMin!, endMin: slot.endMin! } : null,
    holiday: Boolean(slot.holiday),
    source,
  };
}

export interface ScheduleRows {
  templates: (Slot & { userId: number | null; weekday: number })[];
  overrides: (Slot & { userId: number | null; date: string; holiday: boolean })[];
}

/** Pure resolver over pre-loaded rows. */
export function pickDay(rows: ScheduleRows, userId: number, date: string): ResolvedDay {
  const userOverride = rows.overrides.find((o) => o.userId === userId && o.date === date);
  if (userOverride) return toResolved(userOverride, "user_override");
  const branchOverride = rows.overrides.find((o) => o.userId === null && o.date === date);
  if (branchOverride) return toResolved(branchOverride, "branch_override");
  const weekday = weekdayOf(date);
  const hasOwnWeek = rows.templates.some((t) => t.userId === userId);
  if (hasOwnWeek) {
    const own = rows.templates.find((t) => t.userId === userId && t.weekday === weekday);
    return own ? toResolved(own, "user_template") : { schedule: null, holiday: false, source: "user_template" };
  }
  const base = rows.templates.find((t) => t.userId === null && t.weekday === weekday);
  return base ? toResolved(base, "branch_template") : { schedule: null, holiday: false, source: "none" };
}

/** Loads the rows for a branch for a set of dates (and optionally some users). */
export async function loadScheduleRows(
  tx: Tx | ReturnType<typeof db>,
  branchId: number,
  dates: string[],
  userIds?: number[],
): Promise<ScheduleRows> {
  const userFilter = userIds ? { OR: [{ userId: null }, { userId: { in: userIds } }] } : {};
  const [templates, overrides] = await Promise.all([
    tx.scheduleTemplate.findMany({ where: { branchId, ...userFilter } }),
    tx.scheduleOverride.findMany({ where: { branchId, date: { in: dates }, ...userFilter } }),
  ]);
  return { templates, overrides };
}

export async function resolveDay(tx: Tx | ReturnType<typeof db>, branchId: number, userId: number, date: string): Promise<ResolvedDay> {
  return pickDay(await loadScheduleRows(tx, branchId, [date], [userId]), userId, date);
}

export async function resolveMonth(tx: Tx | ReturnType<typeof db>, branchId: number, userId: number, month: string) {
  const dates = daysInMonth(month);
  const rows = await loadScheduleRows(tx, branchId, dates, [userId]);
  return dates.map((date) => ({ date, ...pickDay(rows, userId, date) }));
}
