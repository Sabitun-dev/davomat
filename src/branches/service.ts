// Branches, their workers (branch_members) and rotating-QR display devices.

import { audit } from "../audit/audit.ts";
import {
  canCreateBranch,
  canManageBranch,
  ensure,
  visibleBranchIds,
  type Actor,
} from "../auth/permissions.ts";
import { isValidCoord } from "../attendance/geo.ts";
import { randomToken, sha256Hex } from "../lib/crypto.ts";
import { db, transaction } from "../lib/db.ts";
import { env } from "../lib/env.ts";
import { badRequest, notFound } from "../lib/errors.ts";
import { isValidTimeZone } from "../shared/time.ts";
import { recalcCurrentMonth } from "../pay/recalc.ts";
import { displayName } from "../users/service.ts";
import type { Branch } from "../generated/prisma/client.ts";

export interface BranchInput {
  name: string;
  address: string;
  lat: number;
  lng: number;
  radiusM: number;
  timezone: string;
  breakAllowanceMin: number;
  graceMin: number;
  graceMode: "FULL" | "AFTER_GRACE";
  qrMode: "STATIC" | "ROTATING";
  active: boolean;
}

function intIn(v: unknown, min: number, max: number, code: string): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) throw badRequest(code);
  return v;
}

/** Checks the fields that are present. With `full`, name and location are required. */
export function parseBranchInput(raw: Record<string, unknown>, full: boolean): Partial<BranchInput> {
  const out: Partial<BranchInput> = {};
  if (full || raw.name !== undefined) {
    const name = typeof raw.name === "string" ? raw.name.replace(/\s+/g, " ").trim() : "";
    if (!name || name.length > 80) throw badRequest("branch_name");
    out.name = name;
  }
  if (raw.address !== undefined) {
    if (typeof raw.address !== "string" || raw.address.length > 200) throw badRequest();
    out.address = raw.address.trim();
  }
  if (full || raw.lat !== undefined || raw.lng !== undefined) {
    if (!isValidCoord(raw.lat, raw.lng)) throw badRequest("bad_location");
    out.lat = raw.lat as number;
    out.lng = raw.lng as number;
  }
  if (raw.radiusM !== undefined) out.radiusM = intIn(raw.radiusM, 10, 1000, "bad_radius");
  if (raw.timezone !== undefined) {
    if (typeof raw.timezone !== "string" || !isValidTimeZone(raw.timezone)) throw badRequest("bad_timezone");
    out.timezone = raw.timezone;
  }
  if (raw.breakAllowanceMin !== undefined) out.breakAllowanceMin = intIn(raw.breakAllowanceMin, 0, 480, "bad_request");
  if (raw.graceMin !== undefined) out.graceMin = intIn(raw.graceMin, 0, 180, "bad_request");
  if (raw.graceMode !== undefined) {
    if (raw.graceMode !== "FULL" && raw.graceMode !== "AFTER_GRACE") throw badRequest();
    out.graceMode = raw.graceMode;
  }
  if (raw.qrMode !== undefined) {
    if (raw.qrMode !== "STATIC" && raw.qrMode !== "ROTATING") throw badRequest();
    out.qrMode = raw.qrMode;
  }
  if (raw.active !== undefined) {
    if (typeof raw.active !== "boolean") throw badRequest();
    out.active = raw.active;
  }
  return out;
}

/** Mon–Sat 09:00–19:00, Sunday off. The admin changes it in the schedule screen. */
export const DEFAULT_WEEK = [1, 2, 3, 4, 5, 6, 7].map((weekday) =>
  weekday === 7 ? { weekday, startMin: null, endMin: null, dayOff: true } : { weekday, startMin: 540, endMin: 1140, dayOff: false },
);

export async function createBranch(actor: Actor, raw: Record<string, unknown>): Promise<Branch> {
  ensure(canCreateBranch(actor) && actor.companyId !== null);
  const input = parseBranchInput(raw, true);
  return transaction(async (tx) => {
    const branch = await tx.branch.create({
      data: {
        companyId: actor.companyId!,
        name: input.name!,
        address: input.address ?? "",
        lat: input.lat!,
        lng: input.lng!,
        radiusM: input.radiusM ?? 25,
        timezone: input.timezone ?? env.defaultTimezone,
        breakAllowanceMin: input.breakAllowanceMin ?? 60,
        graceMin: input.graceMin ?? 0,
        graceMode: input.graceMode ?? "FULL",
        qrMode: input.qrMode ?? "STATIC",
      },
    });
    await tx.scheduleTemplate.createMany({ data: DEFAULT_WEEK.map((d) => ({ ...d, branchId: branch.id })) });
    if (actor.role === "ADMIN") await tx.adminBranch.create({ data: { userId: actor.userId, branchId: branch.id } });
    await audit(tx, {
      companyId: actor.companyId!,
      actorUserId: actor.userId,
      action: "branch.create",
      entity: "branch",
      entityId: branch.id,
      after: branch,
    });
    return branch;
  }).then((branch) => {
    // Keep this request's actor in step with the new branch.
    actor.companyBranchIds.push(branch.id);
    if (actor.role === "ADMIN") actor.adminBranchIds.push(branch.id);
    return branch;
  });
}

export async function getBranchFor(actor: Actor, branchId: number): Promise<Branch> {
  ensure(canManageBranch(actor, branchId));
  const branch = await db().branch.findFirst({ where: { id: branchId, companyId: actor.companyId ?? -1 } });
  if (!branch) throw notFound();
  return branch;
}

export async function updateBranch(actor: Actor, branchId: number, raw: Record<string, unknown>): Promise<Branch> {
  const before = await getBranchFor(actor, branchId);
  const patch = parseBranchInput(raw, false);
  return transaction(async (tx) => {
    const after = await tx.branch.update({ where: { id: branchId }, data: patch });
    await audit(tx, {
      companyId: before.companyId,
      actorUserId: actor.userId,
      action: "branch.update",
      entity: "branch",
      entityId: branchId,
      before,
      after,
    });
    const payRules = before.graceMin !== after.graceMin || before.graceMode !== after.graceMode || before.breakAllowanceMin !== after.breakAllowanceMin;
    if (payRules || before.timezone !== after.timezone) await recalcCurrentMonth(tx, branchId);
    return after;
  });
}

export async function regenerateQr(actor: Actor, branchId: number): Promise<Branch> {
  const before = await getBranchFor(actor, branchId);
  return transaction(async (tx) => {
    const after = await tx.branch.update({ where: { id: branchId }, data: { qrVersion: { increment: 1 } } });
    await audit(tx, {
      companyId: before.companyId,
      actorUserId: actor.userId,
      action: "branch.qr_regenerate",
      entity: "branch",
      entityId: branchId,
      before: { qrVersion: before.qrVersion },
      after: { qrVersion: after.qrVersion },
    });
    return after;
  });
}

export async function listBranches(actor: Actor) {
  const all = await db().branch.findMany({
    where: { companyId: actor.companyId ?? -1 },
    orderBy: [{ active: "desc" }, { name: "asc" }],
    include: { _count: { select: { members: { where: { active: true } } } } },
  });
  const visible = new Set(visibleBranchIds(actor, all.map((b) => b.id)));
  return all
    .filter((b) => visible.has(b.id))
    .map(({ _count, ...b }) => ({ ...branchJson(b), workerCount: _count.members }));
}

export function branchJson(b: Branch) {
  return {
    id: b.id,
    name: b.name,
    address: b.address,
    lat: b.lat,
    lng: b.lng,
    radiusM: b.radiusM,
    timezone: b.timezone,
    qrVersion: b.qrVersion,
    qrMode: b.qrMode,
    breakAllowanceMin: b.breakAllowanceMin,
    graceMin: b.graceMin,
    graceMode: b.graceMode,
    active: b.active,
  };
}

// ---- Workers of a branch ----

export async function listMembers(actor: Actor, branchId: number) {
  await getBranchFor(actor, branchId);
  const rows = await db().branchMember.findMany({
    where: { branchId },
    include: {
      user: {
        select: {
          id: true,
          fullName: true,
          firstName: true,
          lastName: true,
          phone: true,
          username: true,
          branchMembers: { where: { active: true }, select: { branchId: true, branch: { select: { name: true } } } },
        },
      },
    },
    orderBy: [{ active: "desc" }, { joinedAt: "asc" }],
  });
  return rows.map((m) => ({
    memberId: m.id,
    userId: m.userId,
    name: displayName(m.user),
    phone: m.user.phone,
    username: m.user.username,
    position: m.position,
    defaultDailyAmount: m.defaultDailyAmount,
    active: m.active,
    joinedAt: m.joinedAt,
    otherBranches: m.user.branchMembers.filter((b) => b.branchId !== branchId).map((b) => ({ id: b.branchId, name: b.branch.name })),
  }));
}

async function memberFor(actor: Actor, memberId: number) {
  const member = await db().branchMember.findUnique({ where: { id: memberId } });
  if (!member) throw notFound();
  await getBranchFor(actor, member.branchId);
  return member;
}

export async function updateMember(actor: Actor, memberId: number, raw: Record<string, unknown>) {
  const before = await memberFor(actor, memberId);
  const data: { position?: string; defaultDailyAmount?: number | null; active?: boolean; leftAt?: Date | null } = {};
  if (raw.position !== undefined) {
    if (typeof raw.position !== "string" || raw.position.length > 60) throw badRequest();
    data.position = raw.position.trim();
  }
  if (raw.defaultDailyAmount !== undefined) {
    const a = raw.defaultDailyAmount;
    if (a !== null && (typeof a !== "number" || !Number.isInteger(a) || a < 0 || a > 2_000_000_000)) throw badRequest("bad_amount");
    data.defaultDailyAmount = a as number | null;
  }
  if (raw.active !== undefined) {
    if (typeof raw.active !== "boolean") throw badRequest();
    data.active = raw.active;
    data.leftAt = raw.active ? null : new Date();
  }
  return transaction(async (tx) => {
    const after = await tx.branchMember.update({ where: { id: memberId }, data });
    await audit(tx, {
      companyId: actor.companyId!,
      actorUserId: actor.userId,
      action: "member.update",
      entity: "branch_member",
      entityId: memberId,
      before,
      after,
    });
    if (before.defaultDailyAmount !== after.defaultDailyAmount) await recalcCurrentMonth(tx, before.branchId, [before.userId]);
    return after;
  });
}

/** Adds the worker to another branch (keeping this one), or moves them (deactivating this one). */
export async function addToBranch(actor: Actor, memberId: number, targetBranchId: number, move: boolean) {
  const member = await memberFor(actor, memberId);
  await getBranchFor(actor, targetBranchId);
  if (targetBranchId === member.branchId) throw badRequest();
  return transaction(async (tx) => {
    const target = await tx.branchMember.upsert({
      where: { branchId_userId: { branchId: targetBranchId, userId: member.userId } },
      create: {
        branchId: targetBranchId,
        userId: member.userId,
        position: member.position,
        defaultDailyAmount: member.defaultDailyAmount,
      },
      update: { active: true, leftAt: null },
    });
    if (move) await tx.branchMember.update({ where: { id: memberId }, data: { active: false, leftAt: new Date() } });
    await audit(tx, {
      companyId: actor.companyId!,
      actorUserId: actor.userId,
      action: move ? "member.move" : "member.allow",
      entity: "branch_member",
      entityId: memberId,
      before: { branchId: member.branchId },
      after: { branchId: targetBranchId, memberId: target.id },
    });
    return target;
  });
}

// ---- Display devices for rotating QR ----

export async function listDevices(actor: Actor, branchId: number) {
  await getBranchFor(actor, branchId);
  return db().displayDevice.findMany({
    where: { branchId, revokedAt: null },
    select: { id: true, name: true, lastSeenAt: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
}

/** Returns the display link once; only a hash of the key is stored. */
export async function createDevice(actor: Actor, branchId: number, name: unknown) {
  await getBranchFor(actor, branchId);
  const clean = typeof name === "string" && name.trim() ? name.trim().slice(0, 60) : "Planshet";
  const key = randomToken(24);
  const device = await transaction(async (tx) => {
    const d = await tx.displayDevice.create({
      data: { branchId, name: clean, keyHash: sha256Hex(key), createdById: actor.userId },
    });
    await audit(tx, {
      companyId: actor.companyId!,
      actorUserId: actor.userId,
      action: "device.create",
      entity: "display_device",
      entityId: d.id,
      after: { branchId, name: clean },
    });
    return d;
  });
  return { id: device.id, name: device.name, url: `${env.appUrl}/app/display?d=${key}` };
}

export async function revokeDevice(actor: Actor, deviceId: number) {
  const device = await db().displayDevice.findUnique({ where: { id: deviceId } });
  if (!device) throw notFound();
  await getBranchFor(actor, device.branchId);
  await transaction(async (tx) => {
    await tx.displayDevice.update({ where: { id: deviceId }, data: { revokedAt: new Date() } });
    await audit(tx, {
      companyId: actor.companyId!,
      actorUserId: actor.userId,
      action: "device.revoke",
      entity: "display_device",
      entityId: deviceId,
    });
  });
}

export async function deviceByKey(key: string) {
  if (!key || key.length > 100) return null;
  const device = await db().displayDevice.findUnique({ where: { keyHash: sha256Hex(key) }, include: { branch: true } });
  if (!device || device.revokedAt || !device.branch.active) return null;
  if (!device.lastSeenAt || Date.now() - device.lastSeenAt.getTime() > 5 * 60 * 1000) {
    await db().displayDevice.update({ where: { id: device.id }, data: { lastSeenAt: new Date() } });
  }
  return device;
}
