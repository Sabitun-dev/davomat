// Owner-only: who is an admin, and of which branches.

import { audit } from "../audit/audit.ts";
import { canManageAdmins, ensure, type Actor } from "../auth/permissions.ts";
import { db, transaction } from "../lib/db.ts";
import { AppError, badRequest, notFound } from "../lib/errors.ts";
import { displayName } from "./service.ts";

export async function listPeople(actor: Actor) {
  ensure(canManageAdmins(actor));
  const rows = await db().membership.findMany({
    where: { companyId: actor.companyId!, active: true },
    include: { user: { include: { adminBranches: { where: { branch: { companyId: actor.companyId! } }, select: { branchId: true } } } } },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((m) => ({
    userId: m.userId,
    name: displayName(m.user),
    phone: m.user.phone,
    username: m.user.username,
    role: m.role,
    adminBranchIds: m.user.adminBranches.map((a) => a.branchId),
  }));
}

export async function setAdmin(actor: Actor, userId: number, branchIds: unknown) {
  ensure(canManageAdmins(actor));
  if (!Array.isArray(branchIds) || branchIds.some((id) => !Number.isInteger(id))) throw badRequest();
  const membership = await db().membership.findUnique({
    where: { userId_companyId: { userId, companyId: actor.companyId! } },
  });
  if (!membership?.active) throw notFound();
  const valid = await db().branch.findMany({
    where: { id: { in: branchIds as number[] }, companyId: actor.companyId! },
    select: { id: true },
  });
  const before = await db().adminBranch.findMany({ where: { userId, branch: { companyId: actor.companyId! } }, select: { branchId: true } });
  await transaction(async (tx) => {
    if (membership.role !== "OWNER") await tx.membership.update({ where: { id: membership.id }, data: { role: "ADMIN" } });
    // Only this company's admin rights change; other companies are untouched.
    await tx.adminBranch.deleteMany({ where: { userId, branch: { companyId: actor.companyId! } } });
    await tx.adminBranch.createMany({ data: valid.map((b) => ({ userId, branchId: b.id })) });
    await audit(tx, {
      companyId: actor.companyId!,
      actorUserId: actor.userId,
      action: "admin.set",
      entity: "user",
      entityId: userId,
      before: { role: membership.role, branchIds: before.map((b) => b.branchId) },
      after: { role: membership.role === "OWNER" ? "OWNER" : "ADMIN", branchIds: valid.map((b) => b.id) },
    });
  });
}

export async function removeAdmin(actor: Actor, userId: number) {
  ensure(canManageAdmins(actor));
  const membership = await db().membership.findUnique({
    where: { userId_companyId: { userId, companyId: actor.companyId! } },
  });
  if (!membership) throw notFound();
  if (membership.role === "OWNER") throw new AppError("last_owner", 400);
  await transaction(async (tx) => {
    await tx.membership.update({ where: { id: membership.id }, data: { role: "WORKER" } });
    await tx.adminBranch.deleteMany({ where: { userId, branch: { companyId: actor.companyId! } } });
    await audit(tx, {
      companyId: actor.companyId!,
      actorUserId: actor.userId,
      action: "admin.remove",
      entity: "user",
      entityId: userId,
      before: { role: membership.role },
      after: { role: "WORKER" },
    });
  });
}
