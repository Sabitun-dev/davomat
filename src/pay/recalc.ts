// Rebuilds daily_results for one worker-day from events, schedule, amounts and settings.
// Called in the same transaction as every change to those inputs.

import { db, type Tx } from "../lib/db.ts";
import { parseSettings } from "../lib/settings.ts";
import { addDays, localMinute, localToUtc, monthOf, toLocal } from "../shared/time.ts";
import { resolveDay } from "../schedule/resolve.ts";
import { computeDay } from "./engine.ts";
import type { DailyResult } from "../generated/prisma/client.ts";

type DbLike = Tx | ReturnType<typeof db>;

/** Flags that do not need a day review (they are payroll warnings). */
const NON_REVIEW_FLAGS = new Set(["missing_amount"]);

export async function isMonthLocked(tx: DbLike, companyId: number, month: string): Promise<boolean> {
  return Boolean(await tx.monthLock.findUnique({ where: { companyId_month: { companyId, month } } }));
}

/** Which branch a day belongs to: the check-in branch, else where an amount is set, else the oldest membership. */
async function branchForDay(tx: DbLike, userId: number, date: string, eventBranchId: number | null) {
  if (eventBranchId) return tx.branch.findUnique({ where: { id: eventBranchId } });
  const amount = await tx.dailyAmount.findFirst({ where: { userId, date }, select: { branchId: true } });
  if (amount) return tx.branch.findUnique({ where: { id: amount.branchId } });
  const member = await tx.branchMember.findFirst({
    where: { userId, active: true, branch: { active: true } },
    orderBy: { joinedAt: "asc" },
    include: { branch: true },
  });
  return member?.branch ?? null;
}

export async function recalcDay(tx: DbLike, userId: number, date: string, now = new Date()): Promise<DailyResult | null> {
  const events = await tx.attendanceEvent.findMany({
    where: { userId, localDate: date, status: "ACCEPTED", voided: false },
    orderBy: [{ serverTime: "asc" }, { id: "asc" }],
    include: { videoNote: { select: { id: true } } },
  });
  const checkIn = events.find((e) => e.type === "CHECK_IN");
  const branch = await branchForDay(tx, userId, date, checkIn?.branchId ?? events[0]?.branchId ?? null);
  const existing = await tx.dailyResult.findUnique({ where: { userId_date: { userId, date } } });
  if (!branch) return existing;

  const company = await tx.company.findUniqueOrThrow({ where: { id: branch.companyId } });
  if (await isMonthLocked(tx, company.id, monthOf(date))) return existing;
  const settings = parseSettings(company.settings);

  const local = toLocal(now, branch.timezone);
  if (date > local.date) return existing;

  const member = await tx.branchMember.findUnique({ where: { branchId_userId: { branchId: branch.id, userId } } });
  if (!events.length) {
    // Before the worker joined (or after they left) there is nothing to judge.
    const joined = member ? toLocal(member.joinedAt, branch.timezone).date : null;
    const left = member?.leftAt ? toLocal(member.leftAt, branch.timezone).date : null;
    if (!member || (joined && date < joined) || (left && date > left)) {
      if (existing) await tx.dailyResult.delete({ where: { id: existing.id } });
      return null;
    }
  }

  const resolved = await resolveDay(tx, branch.id, userId, date);
  const amountRow = await tx.dailyAmount.findUnique({
    where: { userId_branchId_date: { userId, branchId: branch.id, date } },
  });
  // A filled-in cell wins; otherwise the worker's default amount counts for working days.
  const amount = amountRow?.amount ?? (resolved.schedule ? (member?.defaultDailyAmount ?? null) : null);

  const out = computeDay({
    schedule: resolved.schedule,
    graceMin: branch.graceMin,
    graceMode: branch.graceMode,
    breakAllowanceMin: branch.breakAllowanceMin,
    amount,
    events: events.map((e) => ({ type: e.type, minute: localMinute(e.serverTime, branch.timezone), auto: e.source === "AUTO" })),
    nowMinute: date === local.date ? local.minute : null,
    autoCloseAfterMin: settings.autoCloseAfterMin,
  });

  // Flags from anti-cheat checks and from the group-video link.
  const flags = new Set(out.flags);
  for (const e of events) for (const f of e.flags) flags.add(f);
  if (events.some((e) => e.source === "ADMIN")) flags.add("corrected");
  if (settings.flagMissingVideo) {
    const afterMs = settings.videoAfterMin * 60_000;
    if (events.some((e) => e.source === "APP" && !e.videoNote && now.getTime() - e.serverTime.getTime() > afterMs)) flags.add("no_video");
    const dayStart = localToUtc(date, 0, branch.timezone);
    const dayEnd = localToUtc(addDays(date, 1), 0, branch.timezone);
    const orphanVideo = await tx.videoNote.findFirst({
      where: {
        userId,
        linkedEventId: null,
        sentAt: { gte: dayStart, lt: dayEnd, lte: new Date(now.getTime() - settings.videoBeforeMin * 60_000) },
      },
      select: { id: true },
    });
    if (orphanVideo) flags.add("video_without_scan");
  }
  const flagList = [...flags].sort();
  const needsReview = flagList.some((f) => !NON_REVIEW_FLAGS.has(f));
  const lastOut = [...events].reverse().find((e) => e.type === "CHECK_OUT");

  const data = {
    branchId: branch.id,
    status: out.status,
    startMin: resolved.schedule?.startMin ?? null,
    endMin: resolved.schedule?.endMin ?? null,
    scheduledMin: out.scheduledMin,
    lateMin: out.lateMin,
    earlyMin: out.earlyMin,
    breakMin: out.breakMin,
    overageMin: out.overageMin,
    workedMin: out.workedMin,
    amount,
    earned: out.earned,
    checkInAt: checkIn?.serverTime ?? null,
    checkOutAt: lastOut?.serverTime ?? (out.autoClosed && resolved.schedule ? localToUtc(date, resolved.schedule.endMin, branch.timezone) : null),
    autoClosed: out.autoClosed,
    flags: flagList,
    needsReview,
    finalized: out.final && (date < local.date || out.status !== "NOT_STARTED"),
  };
  return tx.dailyResult.upsert({
    where: { userId_date: { userId, date } },
    create: { userId, date, ...data },
    update: data,
  });
}

/** The amount that counts for pay: an admin's manual value, else the formula. */
export function finalEarned(r: Pick<DailyResult, "earned" | "manualEarned">): number {
  return r.manualEarned ?? r.earned;
}
