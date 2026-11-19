// Editing schedules (spec 6.1): branch week, worker's own week, single days, copy previous month.
// Every change recalculates the affected days that already started.

import { audit } from "../audit/audit.ts";
import type { Actor } from "../auth/permissions.ts";
import { getBranchFor } from "../branches/service.ts";
import { db, transaction } from "../lib/db.ts";
import { AppError, badRequest } from "../lib/errors.ts";
import { daysInMonth, isValidDate, isValidMonth, monthOf, shiftMonth, toLocal } from "../shared/time.ts";
import { isMonthLocked, recalcBranchDays } from "../pay/recalc.ts";
import { loadScheduleRows, pickDay } from "./resolve.ts";

export interface SlotInput {
  startMin: number | null;
  endMin: number | null;
  dayOff: boolean;
}

export function parseSlot(raw: unknown): SlotInput {
  const r = (raw ?? {}) as Record<string, unknown>;
  const dayOff = r.dayOff === true;
  if (dayOff) return { startMin: null, endMin: null, dayOff: true };
  const s = r.startMin;
  const e = r.endMin;
  if (typeof s !== "number" || typeof e !== "number" || !Number.isInteger(s) || !Number.isInteger(e) || s < 0 || e > 1439) {
    throw badRequest("bad_time");
  }
  // Night shifts across midnight are not supported in v1.
  if (e <= s) throw badRequest("bad_schedule");
  return { startMin: s, endMin: e, dayOff: false };
}

async function ensureUnlocked(companyId: number, months: string[]) {
  for (const m of new Set(months)) if (await isMonthLocked(db(), companyId, m)) throw new AppError("month_locked", 400);
}

export { recalcBranchDays };

export async function getSchedule(actor: Actor, branchId: number, month: string, userId: number | null) {
  const branch = await getBranchFor(actor, branchId);
  if (!isValidMonth(month)) throw badRequest();
  const dates = daysInMonth(month);
  const rows = await loadScheduleRows(db(), branchId, dates, userId ? [userId] : []);
  const ownWeek = userId ? rows.templates.filter((t) => t.userId === userId) : [];
  const week = (userId && ownWeek.length ? ownWeek : rows.templates.filter((t) => t.userId === null)).sort((a, b) => a.weekday - b.weekday);
  // For a branch view a fake user id 0 never matches personal rows.
  const subject = userId ?? 0;
  return {
    branch: { id: branch.id, name: branch.name, timezone: branch.timezone },
    month,
    locked: await isMonthLocked(db(), branch.companyId, month),
    ownWeek: ownWeek.length > 0,
    week: [1, 2, 3, 4, 5, 6, 7].map((weekday) => {
      const t = week.find((w) => w.weekday === weekday);
      return { weekday, startMin: t?.startMin ?? null, endMin: t?.endMin ?? null, dayOff: t ? t.dayOff : true };
    }),
    days: dates.map((date) => {
      const d = pickDay(rows, subject, date);
      const override = rows.overrides.find((o) => o.date === date && o.userId === (userId ?? null));
      return {
        date,
        startMin: d.schedule?.startMin ?? null,
        endMin: d.schedule?.endMin ?? null,
        dayOff: !d.schedule,
        holiday: d.holiday,
        source: d.source,
        overridden: Boolean(override),
        note: override?.note ?? "",
      };
    }),
  };
}

/** Replaces a weekly template. userId null = branch week. `week: null` with a user = use the branch week. */
export async function putWeek(actor: Actor, branchId: number, userId: number | null, rawWeek: unknown) {
  const branch = await getBranchFor(actor, branchId);
  const week =
    rawWeek === null
      ? null
      : (() => {
          if (!Array.isArray(rawWeek) || rawWeek.length !== 7) throw badRequest();
          return rawWeek.map((d, i) => ({ weekday: i + 1, ...parseSlot(d) }));
        })();
  if (week === null && userId === null) throw badRequest();
  if (userId !== null) {
    const member = await db().branchMember.findUnique({ where: { branchId_userId: { branchId, userId } } });
    if (!member) throw badRequest();
  }
  const now = new Date();
  const month = monthOf(toLocal(now, branch.timezone).date);
  await transaction(async (tx) => {
    const before = await tx.scheduleTemplate.findMany({ where: { branchId, userId } });
    await tx.scheduleTemplate.deleteMany({ where: { branchId, userId } });
    if (week) await tx.scheduleTemplate.createMany({ data: week.map((d) => ({ ...d, branchId, userId })) });
    await audit(tx, {
      companyId: branch.companyId,
      actorUserId: actor.userId,
      action: "schedule.week",
      entity: "branch",
      entityId: branchId,
      before: { userId, week: before },
      after: { userId, week },
    });
    // The current month (if open) follows the new week; past months keep what was recorded.
    if (!(await isMonthLocked(tx, branch.companyId, month))) {
      await recalcBranchDays(tx, branchId, daysInMonth(month), userId !== null ? [userId] : undefined, now);
    }
  });
}

export async function putDay(actor: Actor, branchId: number, userId: number | null, date: string, raw: unknown) {
  const branch = await getBranchFor(actor, branchId);
  if (!isValidDate(date)) throw badRequest();
  await ensureUnlocked(branch.companyId, [monthOf(date)]);
  const r = (raw ?? {}) as Record<string, unknown>;
  const holiday = r.holiday === true;
  const slot = holiday ? { startMin: null, endMin: null, dayOff: true } : parseSlot(r);
  const note = typeof r.note === "string" ? r.note.slice(0, 100) : "";
  await transaction(async (tx) => {
    const before = await tx.scheduleOverride.findFirst({ where: { branchId, userId, date } });
    if (before) await tx.scheduleOverride.delete({ where: { id: before.id } });
    const after = await tx.scheduleOverride.create({ data: { branchId, userId, date, ...slot, holiday, note } });
    await audit(tx, {
      companyId: branch.companyId,
      actorUserId: actor.userId,
      action: "schedule.day",
      entity: "branch",
      entityId: branchId,
      before,
      after,
    });
    await recalcBranchDays(tx, branchId, [date], userId !== null ? [userId] : undefined);
  });
}

export async function clearDay(actor: Actor, branchId: number, userId: number | null, date: string) {
  const branch = await getBranchFor(actor, branchId);
  if (!isValidDate(date)) throw badRequest();
  await ensureUnlocked(branch.companyId, [monthOf(date)]);
  await transaction(async (tx) => {
    const before = await tx.scheduleOverride.findFirst({ where: { branchId, userId, date } });
    if (!before) return;
    await tx.scheduleOverride.delete({ where: { id: before.id } });
    await audit(tx, {
      companyId: branch.companyId,
      actorUserId: actor.userId,
      action: "schedule.day_clear",
      entity: "branch",
      entityId: branchId,
      before,
    });
    await recalcBranchDays(tx, branchId, [date], userId !== null ? [userId] : undefined);
  });
}

/** Copies the previous month's single-day changes onto the same day numbers of this month. */
export async function copyPreviousMonth(actor: Actor, branchId: number, userId: number | null, month: string) {
  const branch = await getBranchFor(actor, branchId);
  if (!isValidMonth(month)) throw badRequest();
  await ensureUnlocked(branch.companyId, [month]);
  const prev = shiftMonth(month, -1);
  const dates = daysInMonth(month);
  await transaction(async (tx) => {
    const source = await tx.scheduleOverride.findMany({ where: { branchId, userId, date: { startsWith: prev } } });
    await tx.scheduleOverride.deleteMany({ where: { branchId, userId, date: { startsWith: month } } });
    const copies = source
      .map((o) => ({ ...o, date: `${month}-${o.date.slice(8)}` }))
      .filter((o) => dates.includes(o.date))
      .map(({ id: _id, ...o }) => o);
    if (copies.length) await tx.scheduleOverride.createMany({ data: copies });
    await audit(tx, {
      companyId: branch.companyId,
      actorUserId: actor.userId,
      action: "schedule.copy_month",
      entity: "branch",
      entityId: branchId,
      after: { userId, from: prev, to: month, days: copies.length },
    });
    await recalcBranchDays(tx, branchId, dates, userId !== null ? [userId] : undefined);
  });
}
