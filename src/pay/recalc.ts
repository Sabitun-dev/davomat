// Rebuilds daily_results from events, schedule, amounts and settings.
// Called in the same transaction as every change to those inputs. Works in batches
// (one worker, many dates) so a whole month needs only a handful of queries.

import { db, type Tx } from "../lib/db.ts";
import { parseSettings, type CompanySettings } from "../lib/settings.ts";
import { localMinute, localToUtc, monthOf, toLocal } from "../shared/time.ts";
import { loadScheduleRows, pickDay, type ScheduleRows } from "../schedule/resolve.ts";
import { computeDay } from "./engine.ts";
import { workOverStatus } from "../attendance/workOver.ts";
import type { Branch, DailyResult } from "../generated/prisma/client.ts";

type DbLike = Tx | ReturnType<typeof db>;

/** Flags that do not need a day review (they are payroll warnings). */
const NON_REVIEW_FLAGS = new Set(["missing_amount", "work_over"]);

export async function isMonthLocked(tx: DbLike, companyId: number, month: string): Promise<boolean> {
  return Boolean(await tx.monthLock.findUnique({ where: { companyId_month: { companyId, month } } }));
}

/** The amount that counts for pay: an admin's manual value, else the formula. */
export function finalEarned(r: Pick<DailyResult, "earned" | "manualEarned">): number {
  return r.manualEarned ?? r.earned;
}

const COMPARED: (keyof DailyResult)[] = [
  "branchId", "status", "startMin", "endMin", "scheduledMin", "lateMin", "earlyMin", "breakMin",
  "overageMin", "overtimeMin", "workedMin", "amount", "earned", "autoClosed", "needsReview", "finalized",
];

function same(a: DailyResult, b: Record<string, unknown>): boolean {
  for (const k of COMPARED) if (a[k] !== b[k]) return false;
  const t = (d: unknown) => (d instanceof Date ? d.getTime() : d);
  return t(a.checkInAt) === t(b.checkInAt) && t(a.checkOutAt) === t(b.checkOutAt) && a.flags.join() === (b.flags as string[]).join();
}

/** Recalculates many dates of one worker. Returns the rows by date (null = no row). */
export async function recalcUserDays(
  tx: DbLike,
  userId: number,
  dates: string[],
  now = new Date(),
): Promise<Map<string, DailyResult | null>> {
  const out = new Map<string, DailyResult | null>();
  if (!dates.length) return out;
  const [events, existing, members, amounts] = await Promise.all([
    tx.attendanceEvent.findMany({
      where: { userId, localDate: { in: dates }, status: "ACCEPTED", voided: false },
      orderBy: [{ serverTime: "asc" }, { id: "asc" }],
      include: { videoNote: { select: { id: true } } },
    }),
    tx.dailyResult.findMany({ where: { userId, date: { in: dates } } }),
    tx.branchMember.findMany({ where: { userId }, include: { branch: true }, orderBy: { joinedAt: "asc" } }),
    tx.dailyAmount.findMany({ where: { userId, date: { in: dates } } }),
  ]);
  const existingBy = new Map(existing.map((r) => [r.date, r]));
  const branches = new Map<number, Branch>(members.map((m) => [m.branchId, m.branch]));
  for (const id of new Set(events.map((e) => e.branchId).filter((x): x is number => x !== null))) {
    if (!branches.has(id)) {
      const b = await tx.branch.findUnique({ where: { id } });
      if (b) branches.set(id, b);
    }
  }

  // Per-company settings and locks, per-branch schedules, loaded once.
  const companyCache = new Map<number, { settings: CompanySettings; locked: Set<string> }>();
  const companyOf = async (companyId: number) => {
    let c = companyCache.get(companyId);
    if (!c) {
      const [company, locks] = await Promise.all([
        tx.company.findUniqueOrThrow({ where: { id: companyId } }),
        tx.monthLock.findMany({ where: { companyId }, select: { month: true } }),
      ]);
      c = { settings: parseSettings(company.settings), locked: new Set(locks.map((l) => l.month)) };
      companyCache.set(companyId, c);
    }
    return c;
  };
  const scheduleCache = new Map<number, ScheduleRows>();
  const scheduleOf = async (branchId: number) => {
    let s = scheduleCache.get(branchId);
    if (!s) {
      s = await loadScheduleRows(tx, branchId, dates, [userId]);
      scheduleCache.set(branchId, s);
    }
    return s;
  };

  // Videos of this worker that were never linked (for "video without scan").
  const sorted = [...dates].sort();
  // One day of margin on each side covers every time zone.
  const videos = await tx.videoNote.findMany({
    where: {
      userId,
      linkedEventId: null,
      sentAt: {
        gte: new Date(Date.parse(`${sorted[0]}T00:00:00Z`) - 86400_000),
        lt: new Date(Date.parse(`${sorted[sorted.length - 1]}T00:00:00Z`) + 2 * 86400_000),
      },
    },
    select: { sentAt: true },
  });

  for (const date of dates) {
    const dayEvents = events.filter((e) => e.localDate === date);
    const checkIn = dayEvents.find((e) => e.type === "CHECK_IN");
    const prev = existingBy.get(date) ?? null;

    // Which branch: the check-in branch, else where an amount is set, else the oldest active membership.
    const eventBranchId = checkIn?.branchId ?? dayEvents[0]?.branchId ?? null;
    const amountBranchId = amounts.find((a) => a.date === date)?.branchId ?? null;
    const branch =
      (eventBranchId && branches.get(eventBranchId)) ||
      (amountBranchId && branches.get(amountBranchId)) ||
      members.find((m) => m.active && m.branch.active)?.branch ||
      null;
    if (!branch) {
      out.set(date, prev);
      continue;
    }
    const company = await companyOf(branch.companyId);
    if (company.locked.has(monthOf(date))) {
      out.set(date, prev);
      continue;
    }
    const settings = company.settings;
    const local = toLocal(now, branch.timezone);
    if (date > local.date) {
      out.set(date, prev);
      continue;
    }

    const member = members.find((m) => m.branchId === branch.id) ?? null;
    if (!dayEvents.length) {
      // Before the worker joined (or after they left) there is nothing to judge.
      const joined = member ? toLocal(member.joinedAt, branch.timezone).date : null;
      const left = member?.leftAt ? toLocal(member.leftAt, branch.timezone).date : null;
      if (!member || (joined && date < joined) || (left && date > left)) {
        if (prev) await tx.dailyResult.delete({ where: { id: prev.id } });
        out.set(date, null);
        continue;
      }
    }

    const resolved = pickDay(await scheduleOf(branch.id), userId, date);
    const amountRow = amounts.find((a) => a.date === date && a.branchId === branch.id);
    // A filled-in cell wins; otherwise the worker's default amount counts for working days.
    const amount = amountRow?.amount ?? (resolved.schedule ? (member?.defaultDailyAmount ?? null) : null);

    // "Ish tugadi": did this worker tick it, and did enough of the branch tick it too?
    const lastCheckOut = [...dayEvents].reverse().find((e) => e.type === "CHECK_OUT");
    const forgiven =
      lastCheckOut?.workOver === true && (await workOverStatus(tx, branch.id, date, settings)).forgiven;

    const res = computeDay({
      schedule: resolved.schedule,
      graceMin: branch.graceMin,
      graceMode: branch.graceMode,
      breakAllowanceMin: branch.breakAllowanceMin,
      amount,
      events: dayEvents.map((e) => ({ type: e.type, minute: localMinute(e.serverTime, branch.timezone), auto: e.source === "AUTO" })),
      nowMinute: date === local.date ? local.minute : null,
      autoCloseAfterMin: settings.autoCloseAfterMin,
      overtime: { enabled: settings.overtimeEnabled, includeEarly: settings.overtimeIncludeEarly },
      earlyLeaveForgiven: forgiven,
    });

    // Flags from anti-cheat checks, corrections and the group-video link.
    const flags = new Set(res.flags);
    if (forgiven) flags.add("work_over");
    for (const e of dayEvents) for (const f of e.flags) flags.add(f);
    if (dayEvents.some((e) => e.source === "ADMIN")) flags.add("corrected");
    if (settings.flagMissingVideo) {
      const afterMs = settings.videoAfterMin * 60_000;
      if (dayEvents.some((e) => e.source === "APP" && !e.videoNote && now.getTime() - e.serverTime.getTime() > afterMs)) flags.add("no_video");
      const waitMs = settings.videoBeforeMin * 60_000;
      if (videos.some((v) => toLocal(v.sentAt, branch.timezone).date === date && now.getTime() - v.sentAt.getTime() > waitMs)) {
        flags.add("video_without_scan");
      }
    }
    const flagList = [...flags].sort();
    const lastOut = [...dayEvents].reverse().find((e) => e.type === "CHECK_OUT");

    const data = {
      branchId: branch.id,
      status: res.status,
      startMin: resolved.schedule?.startMin ?? null,
      endMin: resolved.schedule?.endMin ?? null,
      scheduledMin: res.scheduledMin,
      lateMin: res.lateMin,
      earlyMin: res.earlyMin,
      breakMin: res.breakMin,
      overageMin: res.overageMin,
      overtimeMin: res.overtimeMin,
      workedMin: res.workedMin,
      amount,
      earned: res.earned,
      checkInAt: checkIn?.serverTime ?? null,
      checkOutAt:
        lastOut?.serverTime ??
        (res.autoClosed && resolved.schedule ? localToUtc(date, resolved.schedule.endMin, branch.timezone) : null),
      autoClosed: res.autoClosed,
      flags: flagList,
      needsReview: flagList.some((f) => !NON_REVIEW_FLAGS.has(f)),
      finalized: res.final && (date < local.date || res.status !== "NOT_STARTED"),
    };
    if (prev && same(prev, data)) {
      out.set(date, prev);
      continue;
    }
    const row = await tx.dailyResult.upsert({
      where: { userId_date: { userId, date } },
      create: { userId, date, ...data },
      update: data,
    });
    out.set(date, row);
  }
  return out;
}

/** Recalculates days that already started for the given workers (or all active branch workers). */
export async function recalcBranchDays(tx: DbLike, branchId: number, dates: string[], userIds?: number[], now = new Date()) {
  const branch = await tx.branch.findUniqueOrThrow({ where: { id: branchId } });
  const today = toLocal(now, branch.timezone).date;
  const past = dates.filter((d) => d <= today);
  if (!past.length) return;
  const ids =
    userIds ??
    (await tx.branchMember.findMany({ where: { branchId, active: true }, select: { userId: true } })).map((m) => m.userId);
  for (const id of ids) await recalcUserDays(tx, id, past, now);
}

/** After branch rules or a default amount change: the current open month follows. */
export async function recalcCurrentMonth(tx: DbLike, branchId: number, userIds?: number[], now = new Date()) {
  const branch = await tx.branch.findUniqueOrThrow({ where: { id: branchId } });
  const month = monthOf(toLocal(now, branch.timezone).date);
  if (await isMonthLocked(tx, branch.companyId, month)) return;
  const [y, m] = month.split("-").map(Number);
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const dates = Array.from({ length: count }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
  await recalcBranchDays(tx, branchId, dates, userIds, now);
}

export async function recalcDay(tx: DbLike, userId: number, date: string, now = new Date()): Promise<DailyResult | null> {
  return (await recalcUserDays(tx, userId, [date], now)).get(date) ?? null;
}
