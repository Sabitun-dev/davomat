// Runs every 15 minutes (netlify/functions/scheduler.mts). Every step is safe to run twice.
//  - closes days with no check-out at scheduled end + 2 h (flag "needs review")
//  - decides absences and video mismatches by recalculating today and yesterday
//  - reminders to workers, morning / flag / payroll summaries to admins
//  - removes raw GPS older than the retention setting

import { randomToken } from "../lib/crypto.ts";
import { db, isUniqueViolation, transaction } from "../lib/db.ts";
import { logError } from "../lib/env.ts";
import { parseSettings } from "../lib/settings.ts";
import { sendText } from "../bot/api.ts";
import { escapeHtml, t } from "../i18n/index.ts";
import { stateAfter } from "../shared/attendance.ts";
import { addDays, localToUtc, minuteToHHMM, shiftMonth, toLocal } from "../shared/time.ts";
import { recalcUserDays } from "../pay/recalc.ts";
import { loadScheduleRows, pickDay } from "../schedule/resolve.ts";
import { displayName } from "../users/service.ts";
import { remindWorker, sendOnce } from "./notify.ts";
import type { Branch, User } from "../generated/prisma/client.ts";

export interface RunSummary {
  autoClosed: number;
  recalculated: number;
  reminders: number;
  summaries: number;
  gpsCleared: number;
  errors: number;
}

/** Admins of a branch and all owners, who can receive messages. */
async function staffFor(branch: Branch): Promise<User[]> {
  const memberships = await db().membership.findMany({
    where: {
      companyId: branch.companyId,
      active: true,
      OR: [{ role: "OWNER" }, { role: "ADMIN", user: { adminBranches: { some: { branchId: branch.id } } } }],
    },
    include: { user: true },
  });
  return memberships.map((m) => m.user).filter((u) => !u.botBlocked);
}

async function processBranch(branch: Branch, now: Date, summary: RunSummary) {
  const company = await db().company.findUniqueOrThrow({ where: { id: branch.companyId } });
  const settings = parseSettings(company.settings);
  const local = toLocal(now, branch.timezone);
  const today = local.date;
  const yesterday = addDays(today, -1);
  const members = await db().branchMember.findMany({ where: { branchId: branch.id, active: true }, include: { user: true } });
  if (!members.length) return;
  const userIds = members.map((m) => m.userId);
  const [rows, events] = await Promise.all([
    loadScheduleRows(db(), branch.id, [today, yesterday], userIds),
    db().attendanceEvent.findMany({
      where: { userId: { in: userIds }, localDate: { in: [today, yesterday] }, status: "ACCEPTED", voided: false },
      orderBy: [{ serverTime: "asc" }, { id: "asc" }],
    }),
  ]);

  const lateNames: string[] = [];
  const absentNames: string[] = [];
  let latestStart = -1;
  let latestEnd = -1;

  for (const m of members) {
    try {
      for (const date of [yesterday, today]) {
        const mine = events.filter((e) => e.userId === m.userId && e.localDate === date);
        // Belongs to another branch today (checked in elsewhere).
        if (mine.length && mine[0].branchId !== branch.id) continue;
        const day = pickDay(rows, m.userId, date).schedule;
        const state = stateAfter(mine.map((e) => e.type));
        const minuteNow = date === today ? local.minute : 24 * 60 + local.minute;

        // Auto-close: no check-out by scheduled end + N minutes -> close at scheduled end.
        if (day && (state === "WORKING" || state === "ON_BREAK") && minuteNow >= day.endMin + settings.autoCloseAfterMin) {
          const endAt = localToUtc(date, day.endMin, branch.timezone);
          const at = mine.length && mine[mine.length - 1].serverTime > endAt ? mine[mine.length - 1].serverTime : endAt;
          await transaction(async (tx) => {
            const base = { companyId: branch.companyId, userId: m.userId, branchId: branch.id, localDate: date, serverTime: at, status: "ACCEPTED" as const, source: "AUTO" as const };
            if (state === "ON_BREAK") await tx.attendanceEvent.create({ data: { ...base, type: "BREAK_END", idempotencyKey: `auto-${randomToken(12)}` } });
            await tx.attendanceEvent.create({ data: { ...base, type: "CHECK_OUT", idempotencyKey: `auto-${m.userId}-${date}-out` } });
          }).catch((err) => {
            // A parallel run already closed it (same idempotency key).
            if (!isUniqueViolation(err)) throw err;
          });
          summary.autoClosed++;
        }

        if (date === today && day) {
          latestStart = Math.max(latestStart, day.startMin);
          latestEnd = Math.max(latestEnd, day.endMin);
          const checkIn = mine.find((e) => e.type === "CHECK_IN");
          if (checkIn) {
            const min = toLocal(checkIn.serverTime, branch.timezone).minute;
            if (min > day.startMin + branch.graceMin) lateNames.push(`${displayName(m.user)} (${minuteToHHMM(min)})`);
          } else if (local.minute >= day.startMin) absentNames.push(displayName(m.user));

          if (!m.user.botBlocked) {
            if (settings.remindCheckInAfterMin > 0 && !checkIn && local.minute >= day.startMin + settings.remindCheckInAfterMin && local.minute < day.endMin) {
              if (await remindWorker(m.user, "remind.check_in", date)) summary.reminders++;
            }
            if (
              settings.remindCheckOutAfterMin > 0 &&
              (state === "WORKING" || state === "ON_BREAK") &&
              local.minute >= day.endMin + settings.remindCheckOutAfterMin &&
              local.minute < day.endMin + settings.autoCloseAfterMin
            ) {
              if (await remindWorker(m.user, "remind.check_out", date)) summary.reminders++;
            }
          }
        }
      }
      // Absences, auto-close results and video mismatches all come out of the recalculation.
      await recalcUserDays(db(), m.userId, [yesterday, today], now);
      summary.recalculated++;
    } catch (err) {
      summary.errors++;
      logError(`scheduler member ${m.userId}`, err);
    }
  }

  const staff = await staffFor(branch);
  const html = { parse_mode: "HTML" as const };

  // Morning summary, once, a little after the latest start of the day.
  if (settings.morningSummary && latestStart >= 0 && local.minute >= latestStart + Math.max(15, settings.remindCheckInAfterMin)) {
    for (const u of staff) {
      const none = t(u.language, "summary.morning_none");
      const text = t(u.language, "summary.morning", {
        branch: escapeHtml(branch.name),
        date: today,
        late: lateNames.length ? escapeHtml(lateNames.join(", ")) : none,
        absent: absentNames.length ? escapeHtml(absentNames.join(", ")) : none,
      });
      if (await sendOnce(`morning:${branch.id}`, u.telegramId, today, () => sendText(u.telegramId, text, html))) summary.summaries++;
    }
  }

  // Daily flag summary, once the day is closed for everyone.
  if (settings.dailyFlagSummary && latestEnd >= 0 && local.minute >= Math.min(23 * 60 + 30, latestEnd + settings.autoCloseAfterMin + 15)) {
    const count = await db().dailyResult.count({ where: { branchId: branch.id, date: today, needsReview: true, reviewedAt: null } });
    if (count > 0) {
      for (const u of staff) {
        const text = `${escapeHtml(branch.name)}\n${t(u.language, "summary.flags", { date: today, count })}`;
        if (await sendOnce(`flags:${branch.id}`, u.telegramId, today, () => sendText(u.telegramId, text))) summary.summaries++;
      }
    }
  }
}

export async function runScheduler(now = new Date()): Promise<RunSummary> {
  const summary: RunSummary = { autoClosed: 0, recalculated: 0, reminders: 0, summaries: 0, gpsCleared: 0, errors: 0 };
  const run = await db().schedulerRun.create({ data: {} });
  try {
    const branches = await db().branch.findMany({ where: { active: true } });
    for (const branch of branches) {
      try {
        await processBranch(branch, now, summary);
      } catch (err) {
        summary.errors++;
        logError(`scheduler branch ${branch.id}`, err);
      }
    }

    for (const company of await db().company.findMany()) {
      const settings = parseSettings(company.settings);
      const tz = branches.find((b) => b.companyId === company.id)?.timezone ?? "Asia/Tashkent";
      const local = toLocal(now, tz);

      // Monthly "payroll is ready" on the 1st after 09:00.
      if (settings.monthlyPayrollMessage && local.date.endsWith("-01") && local.minute >= 9 * 60) {
        const month = shiftMonth(local.date.slice(0, 7), -1);
        const staff = await db().membership.findMany({
          where: { companyId: company.id, active: true, role: { in: ["OWNER", "ADMIN"] } },
          include: { user: true },
        });
        for (const m of staff.filter((s) => !s.user.botBlocked)) {
          if (await sendOnce("payroll", m.user.telegramId, month, () => sendText(m.user.telegramId, t(m.user.language, "summary.payroll", { month })))) summary.summaries++;
        }
      }

      // Raw GPS is kept N months, then removed from old events (results stay).
      if (await sendOnce("gps_cleanup", 0n, `${company.id}:${local.date}`, async () => "ok")) {
        const cutoff = new Date(now);
        cutoff.setUTCMonth(cutoff.getUTCMonth() - settings.gpsRetentionMonths);
        const cleared = await db().attendanceEvent.updateMany({
          where: { companyId: company.id, serverTime: { lt: cutoff }, OR: [{ lat: { not: null } }, { lng: { not: null } }] },
          data: { lat: null, lng: null, accuracy: null },
        });
        summary.gpsCleared += cleared.count;
      }
    }
    await db().processedUpdate.deleteMany({ where: { at: { lt: new Date(now.getTime() - 7 * 86400_000) } } });
    await db().schedulerRun.update({ where: { id: run.id }, data: { finishedAt: new Date(), ok: summary.errors === 0, summary: { ...summary } } });
  } catch (err) {
    logError("scheduler", err);
    await db().schedulerRun.update({ where: { id: run.id }, data: { finishedAt: new Date(), ok: false, summary: { ...summary } } }).catch(() => undefined);
  }
  return summary;
}
