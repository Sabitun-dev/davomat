// Admin corrections (spec 6.3): any event or day can be corrected, a comment is required,
// and everything goes to the audit log with before/after.

import { audit } from "../audit/audit.ts";
import { canManageWorker, ensure, type Actor } from "../auth/permissions.ts";
import { randomToken } from "../lib/crypto.ts";
import { db, transaction, type Tx } from "../lib/db.ts";
import { AppError, badRequest, notFound } from "../lib/errors.ts";
import { EVENT_TYPES, transition, type DayState, type EventType } from "../shared/attendance.ts";
import { isValidDate, localToUtc, monthOf, parseHHMM } from "../shared/time.ts";
import { isMonthLocked, recalcDay } from "./recalc.ts";

function comment(raw: unknown): string {
  const c = typeof raw === "string" ? raw.trim() : "";
  if (c.length < 2) throw new AppError("comment_required", 400);
  return c.slice(0, 500);
}

async function workerBranchIds(userId: number): Promise<number[]> {
  const rows = await db().branchMember.findMany({ where: { userId }, select: { branchId: true } });
  return rows.map((r) => r.branchId);
}

async function guard(actor: Actor, userId: number, date: string) {
  if (!isValidDate(date)) throw badRequest();
  ensure(canManageWorker(actor, await workerBranchIds(userId)));
  if (await isMonthLocked(db(), actor.companyId!, monthOf(date))) throw new AppError("month_locked", 400);
}

/** After a change, the day's events must still be a valid sequence. */
async function assertValidSequence(tx: Tx, userId: number, date: string) {
  const events = await tx.attendanceEvent.findMany({
    where: { userId, localDate: date, status: "ACCEPTED", voided: false },
    orderBy: [{ serverTime: "asc" }, { id: "asc" }],
  });
  let state: DayState = "NOT_STARTED";
  for (const e of events) {
    const step = transition(state, e.type);
    if (!step.ok) throw new AppError("sequence", 400);
    state = step.next;
  }
  const branchIds = new Set(events.map((e) => e.branchId));
  if (branchIds.size > 1) throw new AppError("sequence", 400);
}

function dayAudit(actor: Actor, userId: number, date: string, action: string, before: unknown, after: unknown, note: string) {
  return {
    companyId: actor.companyId!,
    actorUserId: actor.userId,
    action,
    entity: "day",
    entityId: `${userId}:${date}`,
    before,
    after,
    comment: note,
  };
}

function eventSnapshot(e: { id: number; type: string; serverTime: Date; voided: boolean; source: string }) {
  return { id: e.id, type: e.type, serverTime: e.serverTime, voided: e.voided, source: e.source };
}

export async function addEvent(
  actor: Actor,
  raw: { userId?: unknown; date?: unknown; type?: unknown; time?: unknown; branchId?: unknown; comment?: unknown },
) {
  const userId = Number(raw.userId);
  const date = String(raw.date ?? "");
  await guard(actor, userId, date);
  const note = comment(raw.comment);
  if (typeof raw.type !== "string" || !EVENT_TYPES.includes(raw.type as EventType)) throw badRequest();
  const minute = typeof raw.time === "string" ? parseHHMM(raw.time) : null;
  if (minute === null) throw badRequest("bad_time");
  // No branch given (an empty day): the worker's oldest active branch.
  const branchId =
    Number(raw.branchId) ||
    (await db().branchMember.findFirst({ where: { userId, active: true, branch: { companyId: actor.companyId! } }, orderBy: { joinedAt: "asc" } }))?.branchId ||
    0;
  const branch = await db().branch.findUnique({ where: { id: branchId } });
  if (!branch || branch.companyId !== actor.companyId) throw badRequest();
  ensure(canManageWorker(actor, [branchId]));

  return transaction(async (tx) => {
    const event = await tx.attendanceEvent.create({
      data: {
        companyId: branch.companyId,
        userId,
        branchId,
        localDate: date,
        type: raw.type as EventType,
        serverTime: localToUtc(date, minute, branch.timezone),
        status: "ACCEPTED",
        source: "ADMIN",
        idempotencyKey: `admin-${randomToken(12)}`,
      },
    });
    await assertValidSequence(tx, userId, date);
    await audit(tx, dayAudit(actor, userId, date, "event.add", null, eventSnapshot(event), note));
    return recalcDay(tx, userId, date);
  });
}

export async function editEvent(actor: Actor, eventId: number, raw: { time?: unknown; comment?: unknown }) {
  const event = await db().attendanceEvent.findUnique({ where: { id: eventId }, include: { branch: true } });
  if (!event || !event.branch || event.status !== "ACCEPTED") throw notFound();
  await guard(actor, event.userId, event.localDate);
  const note = comment(raw.comment);
  const minute = typeof raw.time === "string" ? parseHHMM(raw.time) : null;
  if (minute === null) throw badRequest("bad_time");
  return transaction(async (tx) => {
    const after = await tx.attendanceEvent.update({
      where: { id: eventId },
      data: { serverTime: localToUtc(event.localDate, minute, event.branch!.timezone), source: "ADMIN" },
    });
    await assertValidSequence(tx, event.userId, event.localDate);
    await audit(tx, dayAudit(actor, event.userId, event.localDate, "event.edit", eventSnapshot(event), eventSnapshot(after), note));
    return recalcDay(tx, event.userId, event.localDate);
  });
}

/** Removes an event from the calculation. It stays in the database as history. */
export async function voidEvent(actor: Actor, eventId: number, raw: { comment?: unknown }) {
  const event = await db().attendanceEvent.findUnique({ where: { id: eventId } });
  if (!event || event.status !== "ACCEPTED" || event.voided) throw notFound();
  await guard(actor, event.userId, event.localDate);
  const note = comment(raw.comment);
  return transaction(async (tx) => {
    const after = await tx.attendanceEvent.update({ where: { id: eventId }, data: { voided: true } });
    await assertValidSequence(tx, event.userId, event.localDate);
    await audit(tx, dayAudit(actor, event.userId, event.localDate, "event.void", eventSnapshot(event), eventSnapshot(after), note));
    return recalcDay(tx, event.userId, event.localDate);
  });
}

/**
 * Day-level correction: confirm it as reviewed, and optionally set the earned amount by hand
 * (`manualEarned: null` returns to the formula).
 */
export async function reviewDay(
  actor: Actor,
  userId: number,
  date: string,
  raw: { comment?: unknown; manualEarned?: unknown },
) {
  await guard(actor, userId, date);
  const note = comment(raw.comment);
  const manual = raw.manualEarned;
  if (manual !== undefined && manual !== null && (typeof manual !== "number" || !Number.isInteger(manual) || manual < 0)) {
    throw badRequest("bad_amount");
  }
  return transaction(async (tx) => {
    const before = (await recalcDay(tx, userId, date)) ?? (await tx.dailyResult.findUnique({ where: { userId_date: { userId, date } } }));
    if (!before) throw notFound();
    const after = await tx.dailyResult.update({
      where: { id: before.id },
      data: {
        reviewedAt: new Date(),
        reviewedById: actor.userId,
        ...(manual !== undefined ? { manualEarned: manual as number | null } : {}),
      },
    });
    await audit(
      tx,
      dayAudit(
        actor,
        userId,
        date,
        "day.review",
        { manualEarned: before.manualEarned, reviewedAt: before.reviewedAt, earned: before.earned },
        { manualEarned: after.manualEarned, reviewedAt: after.reviewedAt },
        note,
      ),
    );
    return after;
  });
}
