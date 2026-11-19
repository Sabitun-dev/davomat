// Daily amount grid (spec 6.2): rows = workers, columns = days of a month.

import { audit } from "../audit/audit.ts";
import type { Actor } from "../auth/permissions.ts";
import { getBranchFor } from "../branches/service.ts";
import { db, transaction } from "../lib/db.ts";
import { AppError, badRequest } from "../lib/errors.ts";
import { daysInMonth, isValidDate, isValidMonth, monthOf } from "../shared/time.ts";
import { displayName } from "../users/service.ts";
import { loadScheduleRows, pickDay } from "../schedule/resolve.ts";
import { recalcBranchDays } from "./recalc.ts";
import { isMonthLocked } from "./recalc.ts";

const MAX_AMOUNT = 2_000_000_000;

export async function amountGrid(actor: Actor, branchId: number, month: string) {
  const branch = await getBranchFor(actor, branchId);
  if (!isValidMonth(month)) throw badRequest();
  const dates = daysInMonth(month);
  const members = await db().branchMember.findMany({
    where: { branchId, active: true },
    include: { user: { select: { id: true, fullName: true, firstName: true, lastName: true } } },
    orderBy: { joinedAt: "asc" },
  });
  const userIds = members.map((m) => m.userId);
  const [rows, amounts] = await Promise.all([
    loadScheduleRows(db(), branchId, dates, userIds),
    db().dailyAmount.findMany({ where: { branchId, date: { in: dates }, userId: { in: userIds } } }),
  ]);
  const company = await db().company.findUniqueOrThrow({ where: { id: branch.companyId } });
  let missing = 0;
  const workers = members.map((m) => {
    const cells = dates.map((date) => {
      const working = Boolean(pickDay(rows, m.userId, date).schedule);
      const set = amounts.find((a) => a.userId === m.userId && a.date === date);
      const effective = set?.amount ?? (working ? m.defaultDailyAmount : null);
      if (working && effective === null) missing++;
      return { date, working, amount: set?.amount ?? null, effective };
    });
    return { userId: m.userId, name: displayName(m.user), position: m.position, defaultDailyAmount: m.defaultDailyAmount, cells };
  });
  return {
    branch: { id: branch.id, name: branch.name },
    month,
    currency: company.currency,
    locked: await isMonthLocked(db(), branch.companyId, month),
    dates,
    workers,
    missing,
  };
}

function cleanAmount(v: unknown): number | null {
  if (v === null) return null;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > MAX_AMOUNT) throw badRequest("bad_amount");
  return v;
}

/** Sets or clears single cells. */
export async function setAmounts(actor: Actor, branchId: number, rawCells: unknown) {
  const branch = await getBranchFor(actor, branchId);
  if (!Array.isArray(rawCells) || rawCells.length === 0 || rawCells.length > 2000) throw badRequest();
  const cells = rawCells.map((c) => {
    const r = (c ?? {}) as Record<string, unknown>;
    if (!Number.isInteger(r.userId) || typeof r.date !== "string" || !isValidDate(r.date)) throw badRequest();
    return { userId: r.userId as number, date: r.date, amount: cleanAmount(r.amount) };
  });
  for (const m of new Set(cells.map((c) => monthOf(c.date)))) {
    if (await isMonthLocked(db(), branch.companyId, m)) throw new AppError("month_locked", 400);
  }
  const members = await db().branchMember.findMany({ where: { branchId, userId: { in: cells.map((c) => c.userId) } } });
  if (cells.some((c) => !members.some((m) => m.userId === c.userId))) throw badRequest();

  await transaction(async (tx) => {
    for (const c of cells) {
      const key = { userId_branchId_date: { userId: c.userId, branchId, date: c.date } };
      const before = await tx.dailyAmount.findUnique({ where: key });
      if (c.amount === null) {
        if (before) await tx.dailyAmount.delete({ where: key });
      } else {
        await tx.dailyAmount.upsert({ where: key, create: { userId: c.userId, branchId, date: c.date, amount: c.amount }, update: { amount: c.amount } });
      }
      if ((before?.amount ?? null) !== c.amount) {
        await audit(tx, {
          companyId: branch.companyId,
          actorUserId: actor.userId,
          action: "amount.set",
          entity: "day",
          entityId: `${c.userId}:${c.date}`,
          before: { amount: before?.amount ?? null },
          after: { amount: c.amount },
        });
      }
    }
    const byUser = new Map<number, string[]>();
    for (const c of cells) byUser.set(c.userId, [...(byUser.get(c.userId) ?? []), c.date]);
    for (const [userId, dates] of byUser) await recalcBranchDays(tx, branchId, dates, [userId]);
  });
}

/** "Set X for every working day this month for the selected workers". */
export async function bulkFill(actor: Actor, branchId: number, month: string, userIds: unknown, amount: unknown) {
  await getBranchFor(actor, branchId);
  if (!isValidMonth(month) || !Array.isArray(userIds) || userIds.some((u) => !Number.isInteger(u))) throw badRequest();
  const value = cleanAmount(amount);
  if (value === null) throw badRequest("bad_amount");
  const dates = daysInMonth(month);
  const rows = await loadScheduleRows(db(), branchId, dates, userIds as number[]);
  const cells = (userIds as number[]).flatMap((userId) =>
    dates.filter((date) => pickDay(rows, userId, date).schedule).map((date) => ({ userId, date, amount: value })),
  );
  if (cells.length) await setAmounts(actor, branchId, cells);
  return { filled: cells.length };
}
