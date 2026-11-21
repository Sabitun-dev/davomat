// Check in / break / check out (spec 5.3). The server decides everything and uses its own clock.
// Every attempt is stored, accepted or rejected, with the reason.

import { db, isUniqueViolation, transaction, type Tx } from "../lib/db.ts";
import { env } from "../lib/env.ts";
import { badRequest } from "../lib/errors.ts";
import { parseSettings } from "../lib/settings.ts";
import { EVENT_TYPES, stateAfter, transition, type EventType } from "../shared/attendance.ts";
import { minuteToHHMM, monthOf, toLocal } from "../shared/time.ts";
import { isMonthLocked, recalcDay } from "../pay/recalc.ts";
import { resolveDay } from "../schedule/resolve.ts";
import { linkVideoToEvent } from "../video/service.ts";
import { replyUnderVideo } from "../jobs/notify.ts";
import { suspiciousFlags } from "./flags.ts";
import { checkGeofence } from "./geo.ts";
import { checkTokenFreshness, parseToken } from "./qr.ts";
import { isUsable } from "../companies/access.ts";
import { tickAllowed, tickedUsers, workOverStatus, type WorkOverStatus } from "./workOver.ts";
import type { AttendanceEvent, Branch, User } from "../generated/prisma/client.ts";

export interface AttemptInput {
  eventType: unknown;
  qrToken: unknown;
  lat: unknown;
  lng: unknown;
  accuracy: unknown;
  idempotencyKey: unknown;
  deviceId: unknown;
  /** Check-out only: the "Ish tugadi" tick. */
  workOver?: unknown;
}

export interface AttemptResult {
  ok: boolean;
  eventType: EventType;
  reason?: string;
  params?: Record<string, string | number>;
  serverTime: string;
  localTime: string;
  distanceM: number | null;
  radiusM?: number;
  lateMin?: number;
  branchName?: string;
  /** After a check-out with the tick: how many ticked and how many are needed. */
  workOver?: WorkOverStatus & { counted: boolean };
}

type Reject = { reason: string; params?: Record<string, string | number>; branch?: Branch | null; distanceM?: number | null };

class Rejection extends Error {
  constructor(public r: Reject) {
    super(r.reason);
  }
}

function reject(r: Reject): never {
  throw new Rejection(r);
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function resultOf(e: AttendanceEvent, branch: Branch | null, lateMin?: number): AttemptResult {
  const tz = branch?.timezone ?? env.defaultTimezone;
  const reason = e.rejectReason ?? undefined;
  return {
    ok: e.status === "ACCEPTED",
    eventType: e.type,
    reason,
    params: reason ? rejectParams(e, branch) : undefined,
    serverTime: e.serverTime.toISOString(),
    localTime: minuteToHHMM(toLocal(e.serverTime, tz).minute),
    distanceM: e.distanceM,
    radiusM: branch?.radiusM,
    lateMin,
    branchName: branch?.name,
  };
}

function rejectParams(e: AttendanceEvent, branch: Branch | null): Record<string, string | number> {
  const p: Record<string, string | number> = {};
  if (e.distanceM !== null) p.distance = e.distanceM;
  if (branch) p.radius = branch.radiusM;
  if (e.accuracy !== null) p.accuracy = Math.round(e.accuracy);
  return p;
}

async function companySettings(tx: Tx | ReturnType<typeof db>, companyId: number) {
  const company = await tx.company.findUniqueOrThrow({ where: { id: companyId } });
  return parseSettings(company.settings);
}

export async function recordAttempt(
  user: User,
  companyId: number,
  input: AttemptInput,
  meta: { userAgent?: string; now?: Date } = {},
): Promise<AttemptResult> {
  const now = meta.now ?? new Date();
  if (typeof input.eventType !== "string" || !EVENT_TYPES.includes(input.eventType as EventType)) throw badRequest();
  const eventType = input.eventType as EventType;
  const key = input.idempotencyKey;
  if (typeof key !== "string" || !/^[A-Za-z0-9_-]{8,80}$/.test(key)) throw badRequest();
  const deviceId = typeof input.deviceId === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(input.deviceId) ? input.deviceId : null;
  const lat = num(input.lat);
  const lng = num(input.lng);
  const accuracy = num(input.accuracy);
  const userAgent = meta.userAgent?.slice(0, 300) ?? null;

  // A double tap or a network retry: answer with the stored result.
  const previous = await db().attendanceEvent.findUnique({ where: { idempotencyKey: key } });
  if (previous) {
    if (previous.userId !== user.id) throw badRequest();
    const b = previous.branchId ? await db().branch.findUnique({ where: { id: previous.branchId } }) : null;
    return resultOf(previous, b);
  }

  // Rate limiting uses the current company's settings; everything after the scan uses the
  // settings of the scanned branch's company.
  let settings = await companySettings(db(), companyId);
  const base = {
    companyId,
    userId: user.id,
    type: eventType,
    serverTime: now,
    lat,
    lng,
    accuracy,
    idempotencyKey: key,
    deviceId,
    userAgent,
  };

  const saveRejection = async (r: Reject): Promise<AttemptResult> => {
    const tz = r.branch?.timezone ?? env.defaultTimezone;
    try {
      const e = await db().attendanceEvent.create({
        data: {
          ...base,
          branchId: r.branch?.id ?? null,
          localDate: toLocal(now, tz).date,
          distanceM: r.distanceM ?? null,
          status: "REJECTED",
          rejectReason: r.reason,
        },
      });
      return { ...resultOf(e, r.branch ?? null), params: { ...rejectParams(e, r.branch ?? null), ...(r.params ?? {}) } };
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      const e = await db().attendanceEvent.findUniqueOrThrow({ where: { idempotencyKey: key } });
      return resultOf(e, r.branch ?? null);
    }
  };

  // Rate limit: N attempts per worker per 5 minutes (counting rejected ones).
  const recentCount = await db().attendanceEvent.count({
    where: { userId: user.id, serverTime: { gt: new Date(now.getTime() - 5 * 60_000), lte: now } },
  });
  if (recentCount >= settings.rateLimitPer5Min) return saveRejection({ reason: "rate_limited" });

  // The QR code.
  const token = typeof input.qrToken === "string" ? parseToken(env.qrSecret, input.qrToken) : null;
  if (!token) return saveRejection({ reason: "bad_qr" });
  const branch = await db().branch.findUnique({ where: { id: token.branchId } });
  // A branch of a company this person does not belong to looks like any unknown QR code.
  const membership = branch
    ? await db().membership.findUnique({ where: { userId_companyId: { userId: user.id, companyId: branch.companyId } }, include: { company: true } })
    : null;
  if (!branch || !membership?.active) return saveRejection({ reason: "bad_qr" });
  if (!isUsable(membership.company)) return saveRejection({ reason: "company_inactive", branch });
  if (!branch.active) return saveRejection({ reason: "branch_inactive", branch });
  base.companyId = branch.companyId;
  settings = parseSettings(membership.company.settings);
  const member = await db().branchMember.findUnique({ where: { branchId_userId: { branchId: branch.id, userId: user.id } } });
  if (!member?.active) {
    const elsewhere = await db().branchMember.count({ where: { userId: user.id, active: true } });
    return saveRejection({ reason: elsewhere ? "other_branch" : "not_member", branch, params: { branch: branch.name } });
  }
  const freshness = checkTokenFreshness(token, branch, now.getTime());
  if (freshness !== "ok") return saveRejection({ reason: freshness, branch });

  const local = toLocal(now, branch.timezone);
  if (await isMonthLocked(db(), branch.companyId, monthOf(local.date))) return saveRejection({ reason: "month_locked", branch });

  try {
    const accepted = await transaction(async (tx) => {
      // One attempt per worker at a time, so two quick taps cannot both check in.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${user.id})`;

      const day = await tx.attendanceEvent.findMany({
        where: { userId: user.id, localDate: local.date, status: "ACCEPTED", voided: false },
        orderBy: [{ serverTime: "asc" }, { id: "asc" }],
      });
      const state = stateAfter(day.map((e) => e.type));
      const step = transition(state, eventType);
      if (!step.ok) {
        const firstIn = day.find((e) => e.type === "CHECK_IN");
        reject({
          reason: step.reason,
          branch,
          params: firstIn ? { time: minuteToHHMM(toLocal(firstIn.serverTime, branch.timezone).minute) } : {},
        });
      }

      const checkIn = day.find((e) => e.type === "CHECK_IN");
      if (checkIn && checkIn.branchId !== branch.id) {
        const original = await tx.branch.findUnique({ where: { id: checkIn.branchId! } });
        reject({ reason: "wrong_branch", branch, params: { branch: original?.name ?? "" } });
      }

      // The tick counts only before the end and inside the last part of the day.
      let workOver = false;
      if (eventType === "CHECK_OUT" && input.workOver === true) {
        const day = await resolveDay(tx, branch.id, user.id, local.date);
        workOver = tickAllowed(settings, day.schedule?.endMin ?? null, local.minute);
      }

      if (eventType === "CHECK_IN") {
        const resolved = await resolveDay(tx, branch.id, user.id, local.date);
        if (resolved.schedule) {
          const earliest = resolved.schedule.startMin - settings.earliestCheckInMin;
          if (local.minute < earliest) reject({ reason: "too_early", branch, params: { time: minuteToHHMM(Math.max(0, earliest)) } });
        }
      }

      const fence = checkGeofence({
        lat,
        lng,
        accuracy,
        branch,
        accuracyLimitM: settings.gpsAccuracyLimitM,
        toleranceM: settings.geofenceToleranceM,
      });
      if (!fence.ok) reject({ reason: fence.reason, branch, distanceM: fence.distanceM });

      const [recent, sharedDevice] = await Promise.all([
        tx.attendanceEvent.findMany({
          where: { userId: user.id, createdAt: { gt: new Date(now.getTime() - 30 * 86400_000) } },
          orderBy: { createdAt: "desc" },
          take: 50,
          select: { lat: true, lng: true, serverTime: true, status: true, rejectReason: true },
        }),
        deviceId
          ? tx.attendanceEvent.count({
              where: { deviceId, localDate: local.date, status: "ACCEPTED", userId: { not: user.id } },
            })
          : Promise.resolve(0),
      ]);
      const flags = suspiciousFlags({
        lat: lat!,
        lng: lng!,
        accuracy: accuracy!,
        now,
        distanceM: fence.distanceM,
        radiusM: branch.radiusM,
        recent,
        sharedDevice: sharedDevice > 0,
      });

      // Checking out during a break: the break ends at the same moment.
      if (eventType === "CHECK_OUT" && state === "ON_BREAK") {
        await tx.attendanceEvent.create({
          data: {
            ...base,
            type: "BREAK_END",
            idempotencyKey: `${key}-auto`,
            branchId: branch.id,
            localDate: local.date,
            distanceM: fence.distanceM,
            status: "ACCEPTED",
            source: "AUTO",
          },
        });
      }
      const event = await tx.attendanceEvent.create({
        data: { ...base, branchId: branch.id, localDate: local.date, distanceM: fence.distanceM, status: "ACCEPTED", flags, workOver },
      });
      await linkVideoToEvent(tx, event, settings);
      const result = await recalcDay(tx, user.id, local.date, now);
      const res = resultOf(event, branch, eventType === "CHECK_IN" ? (result?.lateMin ?? 0) : undefined);
      if (eventType === "CHECK_OUT" && input.workOver === true) {
        // One more tick may have reached the threshold: the others who ticked are recalculated too.
        for (const other of await tickedUsers(tx, branch.id, local.date)) {
          if (other !== user.id) await recalcDay(tx, other, local.date, now);
        }
        res.workOver = { ...(await workOverStatus(tx, branch.id, local.date, settings)), counted: workOver };
      }
      return { result: res, eventId: event.id };
    });
    // Optional reply under the group video (only when that setting is on).
    await replyUnderVideo(accepted.eventId);
    return accepted.result;
  } catch (err) {
    if (err instanceof Rejection) return saveRejection(err.r);
    if (isUniqueViolation(err)) {
      const e = await db().attendanceEvent.findUnique({ where: { idempotencyKey: key } });
      if (e) return resultOf(e, branch);
    }
    throw err;
  }
}
