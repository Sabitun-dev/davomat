// Month lock, month recalculation, and monthly bonus/fine lines (spec 6.3).

import { audit } from "../audit/audit.ts";
import { canLockMonth, canManageWorker, canUnlockMonth, ensure, visibleBranchIds, type Actor } from "../auth/permissions.ts";
import { db, transaction } from "../lib/db.ts";
import { AppError, badRequest, notFound } from "../lib/errors.ts";
import { daysInMonth, isValidMonth } from "../shared/time.ts";
import { recalcBranchDays } from "./recalc.ts";
import { isMonthLocked } from "./recalc.ts";

export async function monthStatus(actor: Actor, month: string) {
  if (!isValidMonth(month)) throw badRequest();
  const lock = await db().monthLock.findUnique({ where: { companyId_month: { companyId: actor.companyId!, month } } });
  return { month, locked: Boolean(lock), lockedAt: lock?.lockedAt ?? null };
}

export async function lockMonth(actor: Actor, month: string) {
  ensure(canLockMonth(actor));
  if (!isValidMonth(month)) throw badRequest();
  await transaction(async (tx) => {
    const existing = await tx.monthLock.findUnique({ where: { companyId_month: { companyId: actor.companyId!, month } } });
    if (existing) return;
    await tx.monthLock.create({ data: { companyId: actor.companyId!, month, lockedById: actor.userId } });
    await audit(tx, { companyId: actor.companyId!, actorUserId: actor.userId, action: "month.lock", entity: "month", entityId: month });
  });
}

export async function unlockMonth(actor: Actor, month: string, rawComment: unknown) {
  ensure(canUnlockMonth(actor));
  if (!isValidMonth(month)) throw badRequest();
  const note = typeof rawComment === "string" ? rawComment.trim() : "";
  if (note.length < 2) throw new AppError("comment_required", 400);
  await transaction(async (tx) => {
    const existing = await tx.monthLock.findUnique({ where: { companyId_month: { companyId: actor.companyId!, month } } });
    if (!existing) return;
    await tx.monthLock.delete({ where: { id: existing.id } });
    await audit(tx, {
      companyId: actor.companyId!,
      actorUserId: actor.userId,
      action: "month.unlock",
      entity: "month",
      entityId: month,
      before: { lockedAt: existing.lockedAt, lockedById: existing.lockedById },
      comment: note,
    });
  });
}

/** "Recalculate month": rebuilds every worker-day of the visible branches. */
export async function recalcMonth(actor: Actor, month: string, branchId?: number) {
  if (!isValidMonth(month)) throw badRequest();
  if (await isMonthLocked(db(), actor.companyId!, month)) throw new AppError("month_locked", 400);
  const all = await db().branch.findMany({ where: { companyId: actor.companyId! }, select: { id: true } });
  const ids = visibleBranchIds(actor, all.map((b) => b.id)).filter((id) => !branchId || id === branchId);
  const dates = daysInMonth(month);
  for (const id of ids) await transaction((tx) => recalcBranchDays(tx, id, dates));
  await audit(db(), {
    companyId: actor.companyId!,
    actorUserId: actor.userId,
    action: "month.recalc",
    entity: "month",
    entityId: month,
    after: { branchIds: ids },
  });
}

// ---- Bonus / fine lines ----

async function workerGuard(actor: Actor, userId: number) {
  const rows = await db().branchMember.findMany({ where: { userId }, select: { branchId: true } });
  ensure(canManageWorker(actor, rows.map((r) => r.branchId)));
}

export async function listAdjustments(actor: Actor, month: string, userId?: number) {
  if (!isValidMonth(month)) throw badRequest();
  if (userId) await workerGuard(actor, userId);
  const rows = await db().adjustment.findMany({
    where: { companyId: actor.companyId!, month, voided: false, ...(userId ? { userId } : {}) },
    orderBy: { createdAt: "asc" },
  });
  if (actor.role === "OWNER" || userId) return rows;
  // Admins only see lines of workers in their branches.
  const visible = await db().branchMember.findMany({
    where: { branchId: { in: actor.adminBranchIds } },
    select: { userId: true },
  });
  const ids = new Set(visible.map((v) => v.userId));
  return rows.filter((r) => ids.has(r.userId));
}

export async function addAdjustment(actor: Actor, raw: { userId?: unknown; month?: unknown; kind?: unknown; amount?: unknown; comment?: unknown }) {
  const userId = Number(raw.userId);
  const month = String(raw.month ?? "");
  if (!Number.isInteger(userId) || !isValidMonth(month)) throw badRequest();
  if (raw.kind !== "BONUS" && raw.kind !== "FINE") throw badRequest();
  if (typeof raw.amount !== "number" || !Number.isInteger(raw.amount) || raw.amount <= 0) throw badRequest("bad_amount");
  const note = typeof raw.comment === "string" ? raw.comment.trim() : "";
  if (note.length < 2) throw new AppError("comment_required", 400);
  await workerGuard(actor, userId);
  if (await isMonthLocked(db(), actor.companyId!, month)) throw new AppError("month_locked", 400);
  return transaction(async (tx) => {
    const row = await tx.adjustment.create({
      data: { companyId: actor.companyId!, userId, month, kind: raw.kind as "BONUS" | "FINE", amount: raw.amount as number, comment: note.slice(0, 300), createdById: actor.userId },
    });
    await audit(tx, { companyId: actor.companyId!, actorUserId: actor.userId, action: "adjustment.add", entity: "adjustment", entityId: row.id, after: row, comment: note });
    return row;
  });
}

export async function voidAdjustment(actor: Actor, id: number) {
  const row = await db().adjustment.findUnique({ where: { id } });
  if (!row || row.companyId !== actor.companyId || row.voided) throw notFound();
  await workerGuard(actor, row.userId);
  if (await isMonthLocked(db(), actor.companyId!, row.month)) throw new AppError("month_locked", 400);
  await transaction(async (tx) => {
    await tx.adjustment.update({ where: { id }, data: { voided: true } });
    await audit(tx, { companyId: actor.companyId!, actorUserId: actor.userId, action: "adjustment.void", entity: "adjustment", entityId: id, before: row });
  });
}
