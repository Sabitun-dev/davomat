// Admin statistics (spec 8): live dashboard, month report, day-by-day table, year view, review list.
// Every function only returns branches the actor may see.

import { visibleBranchIds, type Actor } from "../auth/permissions.ts";
import { db } from "../lib/db.ts";
import { badRequest, forbidden } from "../lib/errors.ts";
import { stateAfter } from "../shared/attendance.ts";
import { addDays, daysInMonth, isValidMonth, minuteToHHMM, toLocal } from "../shared/time.ts";
import { finalEarned } from "../pay/recalc.ts";
import { loadScheduleRows, pickDay } from "../schedule/resolve.ts";
import { displayName } from "../users/service.ts";
import { monthMax } from "./worker.ts";
import type { DailyResult } from "../generated/prisma/client.ts";

async function branchesFor(actor: Actor, branchId?: number) {
  const all = await db().branch.findMany({ where: { companyId: actor.companyId ?? -1 }, orderBy: { name: "asc" } });
  const visible = new Set(visibleBranchIds(actor, all.map((b) => b.id)));
  if (branchId && !visible.has(branchId)) throw forbidden();
  return all.filter((b) => visible.has(b.id) && (!branchId || b.id === branchId));
}

export async function dashboard(actor: Actor, branchId?: number) {
  const branches = (await branchesFor(actor, branchId)).filter((b) => b.active);
  const now = new Date();
  const out = {
    working: [] as { userId: number; name: string; branch: string; since: string }[],
    onBreak: [] as { userId: number; name: string; branch: string; since: string }[],
    late: [] as { userId: number; name: string; branch: string; lateMin: number; time: string }[],
    notArrived: [] as { userId: number; name: string; branch: string; start: string }[],
    reviewCount: 0,
    dates: {} as Record<number, string>,
  };
  for (const b of branches) {
    const local = toLocal(now, b.timezone);
    out.dates[b.id] = local.date;
    const members = await db().branchMember.findMany({
      where: { branchId: b.id, active: true },
      include: { user: { select: { fullName: true, firstName: true, lastName: true } } },
    });
    if (!members.length) continue;
    const userIds = members.map((m) => m.userId);
    const [events, rows] = await Promise.all([
      db().attendanceEvent.findMany({
        where: { userId: { in: userIds }, localDate: local.date, status: "ACCEPTED", voided: false },
        orderBy: [{ serverTime: "asc" }, { id: "asc" }],
      }),
      loadScheduleRows(db(), b.id, [local.date], userIds),
    ]);
    for (const m of members) {
      const name = displayName(m.user);
      const mine = events.filter((e) => e.userId === m.userId);
      const here = mine.length === 0 || mine[0].branchId === b.id;
      if (!here) continue;
      const state = stateAfter(mine.map((e) => e.type));
      const time = (d: Date) => minuteToHHMM(toLocal(d, b.timezone).minute);
      const day = pickDay(rows, m.userId, local.date);
      if (state === "WORKING") out.working.push({ userId: m.userId, name, branch: b.name, since: time(mine[0].serverTime) });
      if (state === "ON_BREAK") {
        const start = [...mine].reverse().find((e) => e.type === "BREAK_START")!;
        out.onBreak.push({ userId: m.userId, name, branch: b.name, since: time(start.serverTime) });
      }
      const checkIn = mine.find((e) => e.type === "CHECK_IN");
      if (checkIn && day.schedule) {
        const minute = toLocal(checkIn.serverTime, b.timezone).minute;
        const lateMin = minute > day.schedule.startMin + b.graceMin ? minute - day.schedule.startMin - (b.graceMode === "AFTER_GRACE" ? b.graceMin : 0) : 0;
        if (lateMin > 0) out.late.push({ userId: m.userId, name, branch: b.name, lateMin, time: time(checkIn.serverTime) });
      }
      if (!checkIn && day.schedule && local.minute >= day.schedule.startMin) {
        out.notArrived.push({ userId: m.userId, name, branch: b.name, start: minuteToHHMM(day.schedule.startMin) });
      }
    }
  }
  out.reviewCount = await db().dailyResult.count({
    where: {
      branchId: { in: branches.map((b) => b.id) },
      needsReview: true,
      reviewedAt: null,
      date: { gte: addDays(new Date().toISOString().slice(0, 10), -62) },
    },
  });
  return out;
}

export interface WorkerMonthRow {
  userId: number;
  name: string;
  branchId: number;
  branchName: string;
  position: string;
  daysWorked: number;
  absent: number;
  timesLate: number;
  lateMin: number;
  earlyMin: number;
  overageMin: number;
  workedMin: number;
  onTimeDays: number;
  earned: number;
  max: number;
  bonus: number;
  fine: number;
  salary: number;
  missingAmounts: number;
  reviewDays: number;
}

function sumRows(results: DailyResult[]) {
  return {
    daysWorked: results.filter((r) => r.checkInAt !== null).length,
    absent: results.filter((r) => r.status === "ABSENT").length,
    timesLate: results.filter((r) => r.lateMin > 0).length,
    lateMin: results.reduce((s, r) => s + r.lateMin, 0),
    earlyMin: results.reduce((s, r) => s + r.earlyMin, 0),
    overageMin: results.reduce((s, r) => s + r.overageMin, 0),
    workedMin: results.reduce((s, r) => s + r.workedMin, 0),
    onTimeDays: results.filter((r) => r.checkInAt !== null && r.lateMin === 0 && r.scheduledMin > 0).length,
    earned: results.reduce((s, r) => s + finalEarned(r), 0),
    missingAmounts: results.filter((r) => r.flags.includes("missing_amount")).length,
    reviewDays: results.filter((r) => r.needsReview && !r.reviewedAt).length,
  };
}

/** Per worker per month, plus branch totals and the lateness ranking. */
export async function monthReport(actor: Actor, month: string, branchId?: number, userId?: number) {
  if (!isValidMonth(month)) throw badRequest();
  const branches = await branchesFor(actor, branchId);
  const ids = branches.map((b) => b.id);
  const results = await db().dailyResult.findMany({
    where: { branchId: { in: ids }, date: { startsWith: month }, ...(userId ? { userId } : {}) },
  });
  const members = await db().branchMember.findMany({
    where: { branchId: { in: ids }, ...(userId ? { userId } : {}), OR: [{ active: true }, { userId: { in: [...new Set(results.map((r) => r.userId))] } }] },
    include: { user: { select: { id: true, fullName: true, firstName: true, lastName: true } }, branch: true },
    orderBy: { joinedAt: "asc" },
  });
  const adjustments = await db().adjustment.findMany({
    where: { companyId: actor.companyId!, month, voided: false, ...(userId ? { userId } : {}) },
  });

  const rows: WorkerMonthRow[] = [];
  const seen = new Set<string>();
  for (const m of members) {
    const key = `${m.userId}:${m.branchId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const mine = results.filter((r) => r.userId === m.userId && r.branchId === m.branchId);
    if (!m.active && mine.length === 0) continue;
    // Bonuses and fines belong to the worker, so they are counted once (on the first row).
    const firstRow = !rows.some((r) => r.userId === m.userId);
    const adj = firstRow ? adjustments.filter((a) => a.userId === m.userId) : [];
    const bonus = adj.filter((a) => a.kind === "BONUS").reduce((s, a) => s + a.amount, 0);
    const fine = adj.filter((a) => a.kind === "FINE").reduce((s, a) => s + a.amount, 0);
    const sums = sumRows(mine);
    rows.push({
      userId: m.userId,
      name: displayName(m.user),
      branchId: m.branchId,
      branchName: m.branch.name,
      position: m.position,
      ...sums,
      max: await monthMax(m.userId, m.branch, month, m.defaultDailyAmount),
      bonus,
      fine,
      salary: sums.earned + bonus - fine,
    });
  }
  rows.sort((a, b) => a.name.localeCompare(b.name));

  const total = (list: WorkerMonthRow[]) => {
    const t = {
      workers: new Set(list.map((r) => r.userId)).size,
      daysWorked: 0, absent: 0, timesLate: 0, lateMin: 0, earlyMin: 0, overageMin: 0, workedMin: 0,
      onTimeDays: 0, earned: 0, max: 0, bonus: 0, fine: 0, salary: 0, missingAmounts: 0, reviewDays: 0,
    };
    for (const r of list) {
      for (const k of Object.keys(t) as (keyof typeof t)[]) if (k !== "workers") t[k] += r[k as keyof WorkerMonthRow] as number;
    }
    return { ...t, punctuality: t.daysWorked ? Math.round((t.onTimeDays / t.daysWorked) * 100) : null };
  };

  const lock = await db().monthLock.findUnique({ where: { companyId_month: { companyId: actor.companyId!, month } } });
  const company = await db().company.findUniqueOrThrow({ where: { id: actor.companyId! } });
  return {
    month,
    currency: company.currency,
    locked: Boolean(lock),
    rows,
    branches: branches.map((b) => ({ id: b.id, name: b.name, ...total(rows.filter((r) => r.branchId === b.id)) })),
    company: total(rows),
    ranking: [...rows]
      .filter((r) => r.timesLate > 0)
      .sort((a, b) => b.lateMin - a.lateMin || b.timesLate - a.timesLate)
      .slice(0, 10)
      .map((r) => ({ userId: r.userId, name: r.name, branchName: r.branchName, timesLate: r.timesLate, lateMin: r.lateMin })),
  };
}

/** Day by day for a branch: rows = workers, columns = days. */
export async function monthTable(actor: Actor, month: string, branchId: number) {
  if (!isValidMonth(month)) throw badRequest();
  const [branch] = await branchesFor(actor, branchId);
  const dates = daysInMonth(month);
  const members = await db().branchMember.findMany({
    where: { branchId },
    include: { user: { select: { id: true, fullName: true, firstName: true, lastName: true } } },
    orderBy: { joinedAt: "asc" },
  });
  const results = await db().dailyResult.findMany({ where: { branchId, date: { in: dates } } });
  const rows = await loadScheduleRows(db(), branchId, dates, members.map((m) => m.userId));
  const today = toLocal(new Date(), branch.timezone).date;
  return {
    month,
    dates,
    today,
    workers: members
      .filter((m) => m.active || results.some((r) => r.userId === m.userId))
      .map((m) => ({
        userId: m.userId,
        name: displayName(m.user),
        days: dates.map((date) => {
          const r = results.find((x) => x.userId === m.userId && x.date === date);
          if (r) return { date, status: r.status, lateMin: r.lateMin, needsReview: r.needsReview, reviewedAt: r.reviewedAt };
          const planned = pickDay(rows, m.userId, date).schedule;
          return { date, status: planned ? (date > today ? "FUTURE" : "NOT_STARTED") : "DAY_OFF", lateMin: 0, needsReview: false, reviewedAt: null };
        }),
      })),
  };
}

/** 12 months: totals per month and per worker. */
export async function yearReport(actor: Actor, year: number, branchId?: number, userId?: number) {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw badRequest();
  const branches = await branchesFor(actor, branchId);
  const ids = branches.map((b) => b.id);
  const results = await db().dailyResult.findMany({
    where: { branchId: { in: ids }, date: { startsWith: `${year}-` }, ...(userId ? { userId } : {}) },
  });
  const adjustments = await db().adjustment.findMany({
    where: { companyId: actor.companyId!, month: { startsWith: `${year}-` }, voided: false, ...(userId ? { userId } : {}) },
  });
  const allowedUsers = new Set(results.map((r) => r.userId));
  const adj = adjustments.filter((a) => allowedUsers.has(a.userId));
  const months = Array.from({ length: 12 }, (_, i) => {
    const m = `${year}-${String(i + 1).padStart(2, "0")}`;
    const mine = results.filter((r) => r.date.startsWith(m));
    const s = sumRows(mine);
    const bonus = adj.filter((a) => a.month === m && a.kind === "BONUS").reduce((x, a) => x + a.amount, 0);
    const fine = adj.filter((a) => a.month === m && a.kind === "FINE").reduce((x, a) => x + a.amount, 0);
    return { month: m, ...s, bonus, fine, salary: s.earned + bonus - fine };
  });
  const users = await db().user.findMany({
    where: { id: { in: [...allowedUsers] } },
    select: { id: true, fullName: true, firstName: true, lastName: true },
  });
  const workers = users
    .map((u) => {
      const s = sumRows(results.filter((r) => r.userId === u.id));
      const bonus = adj.filter((a) => a.userId === u.id && a.kind === "BONUS").reduce((x, a) => x + a.amount, 0);
      const fine = adj.filter((a) => a.userId === u.id && a.kind === "FINE").reduce((x, a) => x + a.amount, 0);
      return { userId: u.id, name: displayName(u), ...s, bonus, fine, salary: s.earned + bonus - fine };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  const company = await db().company.findUniqueOrThrow({ where: { id: actor.companyId! } });
  return { year, currency: company.currency, months, workers };
}

/** Days that need an admin's look, newest first. */
export async function reviewList(actor: Actor) {
  const branches = await branchesFor(actor);
  const rows = await db().dailyResult.findMany({
    where: { branchId: { in: branches.map((b) => b.id) }, needsReview: true, reviewedAt: null },
    orderBy: { date: "desc" },
    take: 100,
    include: { user: { select: { fullName: true, firstName: true, lastName: true } }, branch: { select: { name: true } } },
  });
  return rows.map((r) => ({ userId: r.userId, name: displayName(r.user), branchName: r.branch.name, date: r.date, flags: r.flags, status: r.status }));
}
