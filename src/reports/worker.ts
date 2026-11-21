// What a worker sees about themselves: today, streak, month calendar, history, one day.

import { db } from "../lib/db.ts";
import { notFound } from "../lib/errors.ts";
import { parseSettings } from "../lib/settings.ts";
import { nextActions, stateAfter } from "../shared/attendance.ts";
import { addDays, daysInMonth, minuteToHHMM, monthOf, toLocal, weekdayOf } from "../shared/time.ts";
import { finalEarned, recalcDay } from "../pay/recalc.ts";
import { loadScheduleRows, pickDay, resolveDay } from "../schedule/resolve.ts";
import { videoLink } from "../video/service.ts";
import type { AttendanceEvent, Branch, DailyResult } from "../generated/prisma/client.ts";

export function resultJson(r: DailyResult) {
  return {
    date: r.date,
    branchId: r.branchId,
    status: r.status,
    startMin: r.startMin,
    endMin: r.endMin,
    scheduledMin: r.scheduledMin,
    lateMin: r.lateMin,
    earlyMin: r.earlyMin,
    breakMin: r.breakMin,
    overageMin: r.overageMin,
    overtimeMin: r.overtimeMin,
    workedMin: r.workedMin,
    amount: r.amount,
    earned: finalEarned(r),
    computedEarned: r.earned,
    manualEarned: r.manualEarned,
    autoClosed: r.autoClosed,
    flags: r.flags,
    needsReview: r.needsReview,
    reviewedAt: r.reviewedAt,
  };
}

type EventWithVideo = AttendanceEvent & { videoNote?: { chatId: bigint; messageId: number; threadId: number | null } | null; branch?: { name: string } | null };

export function eventJson(e: EventWithVideo, tz: string) {
  return {
    id: e.id,
    type: e.type,
    time: e.serverTime.toISOString(),
    localTime: minuteToHHMM(toLocal(e.serverTime, tz).minute),
    distanceM: e.distanceM,
    accuracy: e.accuracy === null ? null : Math.round(e.accuracy),
    source: e.source,
    status: e.status,
    rejectReason: e.rejectReason,
    voided: e.voided,
    flags: e.flags,
    videoUrl: e.videoNote ? videoLink(e.videoNote.chatId, e.videoNote.messageId, e.videoNote.threadId) : null,
    branchName: e.branch?.name ?? null,
  };
}

/** The worker's active branches, only inside the given company branches (one company at a time). */
async function memberBranches(userId: number, branchIds: number[]) {
  const rows = await db().branchMember.findMany({
    where: { userId, active: true, branchId: { in: branchIds }, branch: { active: true } },
    include: { branch: true },
    orderBy: { joinedAt: "asc" },
  });
  return rows;
}

/** Sum of the daily amounts over the working days of a month (the most a worker can earn). */
export async function monthMax(userId: number, branch: Branch, month: string, defaultAmount: number | null): Promise<number> {
  const dates = daysInMonth(month);
  const [rows, amounts] = await Promise.all([
    loadScheduleRows(db(), branch.id, dates, [userId]),
    db().dailyAmount.findMany({ where: { userId, branchId: branch.id, date: { in: dates } } }),
  ]);
  const byDate = new Map(amounts.map((a) => [a.date, a.amount]));
  let total = 0;
  for (const date of dates) {
    const day = pickDay(rows, userId, date);
    if (day.schedule) total += byDate.get(date) ?? defaultAmount ?? 0;
    else if (byDate.has(date)) total += byDate.get(date)!;
  }
  return total;
}

function isOnTime(r: DailyResult): boolean {
  return (r.status === "ON_TIME" || r.status === "IN_PROGRESS") && r.checkInAt !== null && r.lateMin === 0;
}

/** On-time streak: consecutive working days on time, days off do not break it. */
export function streakOf(results: DailyResult[], today: string): number {
  let streak = 0;
  for (const r of [...results].sort((a, b) => (a.date < b.date ? 1 : -1))) {
    if (r.status === "DAY_OFF" || r.status === "EXTRA_DAY") continue;
    if (r.date === today && r.status === "NOT_STARTED") continue;
    if (isOnTime(r)) streak++;
    else break;
  }
  return streak;
}

export async function workerToday(userId: number, branchIds: number[], preferredBranchId?: number) {
  const members = await memberBranches(userId, branchIds);
  if (!members.length) throw notFound();
  // The branch of today's check-in wins; else the chosen one; else the first.
  let chosen = members.find((m) => m.branchId === preferredBranchId) ?? members[0];
  for (const m of members) {
    const date = toLocal(new Date(), m.branch.timezone).date;
    const inHere = await db().attendanceEvent.findFirst({
      where: { userId, localDate: date, status: "ACCEPTED", voided: false, branchId: m.branchId, type: "CHECK_IN" },
    });
    if (inHere) chosen = m;
  }
  const branch = chosen.branch;
  const now = new Date();
  const local = toLocal(now, branch.timezone);
  const company = await db().company.findUniqueOrThrow({ where: { id: branch.companyId } });
  const settings = parseSettings(company.settings);

  const events = await db().attendanceEvent.findMany({
    where: { userId, localDate: local.date, status: "ACCEPTED", voided: false },
    orderBy: [{ serverTime: "asc" }, { id: "asc" }],
    include: { videoNote: true, branch: { select: { name: true } } },
  });
  const state = stateAfter(events.map((e) => e.type));
  const resolved = await resolveDay(db(), branch.id, userId, local.date);
  const today = await recalcDay(db(), userId, local.date, now);

  const month = monthOf(local.date);
  const history = await db().dailyResult.findMany({
    where: { userId, branchId: { in: branchIds }, date: { gte: addDays(local.date, -120), lte: local.date } },
    orderBy: { date: "desc" },
  });
  const monday = addDays(local.date, 1 - weekdayOf(local.date));
  const week = history.filter((r) => r.date >= monday && r.scheduledMin > 0 && r.status !== "NOT_STARTED");
  const monthRows = history.filter((r) => r.date.startsWith(month));

  return {
    date: local.date,
    branch: { id: branch.id, name: branch.name, timezone: branch.timezone },
    branches: members.map((m) => ({ id: m.branchId, name: m.branch.name })),
    schedule: resolved.schedule,
    earliestCheckInMin: resolved.schedule ? Math.max(0, resolved.schedule.startMin - settings.earliestCheckInMin) : null,
    // From this minute a check-out can carry the "Ish tugadi" tick (null = not today).
    workOverFromMin:
      settings.collectiveFinishEnabled && resolved.schedule ? Math.max(0, resolved.schedule.endMin - settings.collectiveFinishWindowMin) : null,
    workOverPercent: settings.collectiveFinishPercent,
    state,
    actions: nextActions(state),
    events: events.map((e) => eventJson(e, branch.timezone)),
    result: today ? resultJson(today) : null,
    breakAllowanceMin: branch.breakAllowanceMin,
    streak: streakOf(history, local.date),
    week: { onTime: week.filter(isOnTime).length, workDays: week.length },
    month: {
      earned: monthRows.reduce((s, r) => s + finalEarned(r), 0),
      max: await monthMax(userId, branch, month, chosen.defaultDailyAmount),
      timesLate: monthRows.filter((r) => r.lateMin > 0).length,
    },
    currency: company.currency,
  };
}

/** branchIds: the company branches that may be shown (one company at a time). */
export async function workerMonth(userId: number, month: string, branchIds: number[]) {
  const members = await memberBranches(userId, branchIds);
  const allRows = await db().dailyResult.findMany({ where: { userId, branchId: { in: branchIds }, date: { startsWith: month } } });
  const main = members[0];
  const byDate = new Map(allRows.map((r) => [r.date, r]));
  const dates = daysInMonth(month);
  const rows = main ? await loadScheduleRows(db(), main.branchId, dates, [userId]) : null;
  const today = main ? toLocal(new Date(), main.branch.timezone).date : new Date().toISOString().slice(0, 10);
  const days = dates.map((date) => {
    const r = byDate.get(date);
    if (r) return resultJson(r);
    const planned = rows ? pickDay(rows, userId, date) : null;
    return {
      date,
      status: planned?.schedule ? (date > today ? "FUTURE" : "NOT_STARTED") : "DAY_OFF",
      startMin: planned?.schedule?.startMin ?? null,
      endMin: planned?.schedule?.endMin ?? null,
      needsReview: false,
      reviewedAt: null,
      lateMin: 0,
      earned: 0,
    };
  });
  const company = main ? await db().company.findUniqueOrThrow({ where: { id: main.branch.companyId } }) : null;
  return {
    month,
    today,
    days,
    totals: {
      timesLate: allRows.filter((r) => r.lateMin > 0).length,
      lateMin: allRows.reduce((s, r) => s + r.lateMin, 0),
      earned: allRows.reduce((s, r) => s + finalEarned(r), 0),
      max: main ? await monthMax(userId, main.branch, month, main.defaultDailyAmount) : 0,
      workedDays: allRows.filter((r) => r.checkInAt !== null).length,
      absentDays: allRows.filter((r) => r.status === "ABSENT").length,
    },
    currency: company?.currency ?? "UZS",
  };
}

export async function workerHistory(userId: number, branchIds: number[], before?: string) {
  const rows = await db().dailyResult.findMany({
    where: { userId, branchId: { in: branchIds }, ...(before ? { date: { lt: before } } : {}), NOT: { status: "NOT_STARTED" } },
    orderBy: { date: "desc" },
    take: 30,
    include: { branch: { select: { name: true, timezone: true } } },
  });
  return rows.map((r) => ({
    ...resultJson(r),
    branchName: r.branch.name,
    checkIn: r.checkInAt ? minuteToHHMM(toLocal(r.checkInAt, r.branch.timezone).minute) : null,
    checkOut: r.checkOutAt ? minuteToHHMM(toLocal(r.checkOutAt, r.branch.timezone).minute) : null,
  }));
}

/**
 * One day: events (and for admins also rejected attempts and the audit trail).
 * Only data from `branchIds` is shown, so a person in two companies never leaks the other one.
 */
export async function dayDetail(userId: number, date: string, opts: { admin: boolean; branchIds: number[] }) {
  const found = await db().dailyResult.findUnique({ where: { userId_date: { userId, date } }, include: { branch: true } });
  const result = found && opts.branchIds.includes(found.branchId) ? found : null;
  const events = await db().attendanceEvent.findMany({
    where: { userId, localDate: date, branchId: { in: opts.branchIds }, ...(opts.admin ? {} : { status: "ACCEPTED", voided: false }) },
    orderBy: [{ serverTime: "asc" }, { id: "asc" }],
    include: { videoNote: true, branch: { select: { name: true, timezone: true } } },
  });
  const tz = result?.branch.timezone ?? events.find((e) => e.branch)?.branch?.timezone ?? "Asia/Tashkent";
  const audit = opts.admin
    ? await db().auditLog.findMany({
        where: { entity: "day", entityId: `${userId}:${date}` },
        orderBy: { at: "desc" },
        take: 30,
      })
    : [];
  const actors = await db().user.findMany({
    where: { id: { in: audit.map((a) => a.actorUserId).filter((x): x is number => x !== null) } },
    select: { id: true, fullName: true, firstName: true },
  });
  const user = await db().user.findUniqueOrThrow({ where: { id: userId }, select: { fullName: true, firstName: true, lastName: true } });
  return {
    date,
    userName: user.fullName || `${user.firstName} ${user.lastName}`.trim(),
    branchName: result?.branch.name ?? null,
    branchId: result?.branchId ?? null,
    timezone: tz,
    result: result ? resultJson(result) : null,
    events: events.map((e) => eventJson(e, tz)),
    audit: audit.map((a) => ({
      id: a.id,
      action: a.action,
      comment: a.comment,
      at: a.at,
      actor: actors.find((u) => u.id === a.actorUserId)?.fullName ?? actors.find((u) => u.id === a.actorUserId)?.firstName ?? "—",
      before: a.before,
      after: a.after,
    })),
  };
}
