// "Ish tugadi" (work is over): when there is nothing left to do before the scheduled end, workers tick
// it while checking out. If at least N% (default 50%) of the workers who came to that branch that day
// ticked it, everyone who ticked is paid as if they left at the scheduled end.
// The tick only counts in the last part of the day (default 120 minutes before the end).

import { db, type Tx } from "../lib/db.ts";
import type { CompanySettings } from "../lib/settings.ts";

export interface WorkOverStatus {
  /** Workers who checked in at the branch that day. */
  present: number;
  /** Of them, workers who checked out with the tick. */
  ticked: number;
  /** Ticks needed for the rule to apply. */
  needed: number;
  forgiven: boolean;
}

export function neededTicks(present: number, percent: number): number {
  return Math.max(1, Math.ceil((present * percent) / 100));
}

/** Is a tick at this local minute allowed? (Before the end, and inside the window.) */
export function tickAllowed(settings: CompanySettings, endMin: number | null, minute: number): boolean {
  if (!settings.collectiveFinishEnabled || endMin === null) return false;
  return minute < endMin && minute >= endMin - settings.collectiveFinishWindowMin;
}

export async function workOverStatus(
  tx: Tx | ReturnType<typeof db>,
  branchId: number,
  date: string,
  settings: CompanySettings,
): Promise<WorkOverStatus> {
  const [checkIns, ticks] = await Promise.all([
    tx.attendanceEvent.findMany({
      where: { branchId, localDate: date, type: "CHECK_IN", status: "ACCEPTED", voided: false },
      select: { userId: true },
      distinct: ["userId"],
    }),
    tx.attendanceEvent.findMany({
      where: { branchId, localDate: date, type: "CHECK_OUT", status: "ACCEPTED", voided: false, workOver: true },
      select: { userId: true },
      distinct: ["userId"],
    }),
  ]);
  const present = checkIns.length;
  const ticked = ticks.length;
  const needed = neededTicks(present, settings.collectiveFinishPercent);
  return { present, ticked, needed, forgiven: settings.collectiveFinishEnabled && present > 0 && ticked >= needed };
}

/** User ids who ticked at this branch that day (to recalculate them when the count changes). */
export async function tickedUsers(tx: Tx | ReturnType<typeof db>, branchId: number, date: string): Promise<number[]> {
  const rows = await tx.attendanceEvent.findMany({
    where: { branchId, localDate: date, type: "CHECK_OUT", status: "ACCEPTED", voided: false, workOver: true },
    select: { userId: true },
    distinct: ["userId"],
  });
  return rows.map((r) => r.userId);
}
