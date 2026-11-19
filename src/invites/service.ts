// Invite links (spec 5.2): https://t.me/<bot>/<app>?startapp=inv_<token>

import { audit } from "../audit/audit.ts";
import { canManageAdmins, ensure, type Actor } from "../auth/permissions.ts";
import { getBranchFor } from "../branches/service.ts";
import { miniAppLink } from "../lib/appConfig.ts";
import { randomAlnum } from "../lib/crypto.ts";
import { db, transaction } from "../lib/db.ts";
import { AppError, badRequest, notFound } from "../lib/errors.ts";
import { parseSettings } from "../lib/settings.ts";
import { ensureCompany } from "../users/service.ts";
import type { Invite } from "../generated/prisma/client.ts";

export async function inviteJson(i: Invite) {
  return {
    id: i.id,
    role: i.role,
    expiresAt: i.expiresAt,
    maxUses: i.maxUses,
    uses: i.uses,
    revoked: Boolean(i.revokedAt),
    expired: i.expiresAt.getTime() < Date.now(),
    link: await miniAppLink(`inv_${i.token}`),
  };
}

export async function createInvite(
  actor: Actor,
  branchId: number,
  raw: { singleUse?: unknown; days?: unknown; role?: unknown },
) {
  const branch = await getBranchFor(actor, branchId);
  const company = await db().company.findUniqueOrThrow({ where: { id: branch.companyId } });
  const settings = parseSettings(company.settings);
  const days = raw.days === undefined ? settings.inviteExpiryDays : raw.days;
  if (typeof days !== "number" || !Number.isInteger(days) || days < 1 || days > 90) throw badRequest();
  const role = raw.role === "ADMIN" ? "ADMIN" : "WORKER";
  if (role === "ADMIN") ensure(canManageAdmins(actor));
  const invite = await transaction(async (tx) => {
    const created = await tx.invite.create({
      data: {
        token: randomAlnum(22),
        branchId,
        role,
        expiresAt: new Date(Date.now() + days * 86400_000),
        maxUses: raw.singleUse === false ? null : 1,
        createdById: actor.userId,
      },
    });
    await audit(tx, {
      companyId: branch.companyId,
      actorUserId: actor.userId,
      action: "invite.create",
      entity: "invite",
      entityId: created.id,
      after: { branchId, role, maxUses: created.maxUses, expiresAt: created.expiresAt },
    });
    return created;
  });
  return inviteJson(invite);
}

export async function listInvites(actor: Actor, branchId: number) {
  await getBranchFor(actor, branchId);
  const rows = await db().invite.findMany({
    where: { branchId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  const usable = rows.filter((i) => i.maxUses === null || i.uses < i.maxUses);
  return Promise.all(usable.map(inviteJson));
}

export async function revokeInvite(actor: Actor, inviteId: number) {
  const invite = await db().invite.findUnique({ where: { id: inviteId } });
  if (!invite) throw notFound();
  const branch = await getBranchFor(actor, invite.branchId);
  await transaction(async (tx) => {
    await tx.invite.update({ where: { id: inviteId }, data: { revokedAt: new Date() } });
    await audit(tx, {
      companyId: branch.companyId,
      actorUserId: actor.userId,
      action: "invite.revoke",
      entity: "invite",
      entityId: inviteId,
    });
  });
}

function usable(i: Invite & { branch: { active: boolean } }): boolean {
  return !i.revokedAt && i.expiresAt.getTime() > Date.now() && (i.maxUses === null || i.uses < i.maxUses) && i.branch.active;
}

export async function previewInvite(token: string, userId: number) {
  const invite = await db().invite.findUnique({ where: { token }, include: { branch: true } });
  if (!invite) return { valid: false, branchName: "", role: "WORKER" as const, alreadyMember: false };
  const member = await db().branchMember.findUnique({
    where: { branchId_userId: { branchId: invite.branchId, userId } },
  });
  const admin =
    invite.role === "ADMIN"
      ? await db().adminBranch.findUnique({ where: { userId_branchId: { userId, branchId: invite.branchId } } })
      : null;
  return {
    valid: usable(invite),
    branchName: invite.branch.name,
    role: invite.role,
    alreadyMember: invite.role === "ADMIN" ? Boolean(admin) : Boolean(member?.active),
  };
}

/** Joins the branch. The use count is raised atomically, so a single-use link works only once. */
export async function acceptInvite(token: string, userId: number) {
  const user = await db().user.findUniqueOrThrow({ where: { id: userId } });
  if (!user.phone || !user.nameConfirmedAt) throw new AppError("bad_request", 400);
  const company = await ensureCompany();
  return transaction(async (tx) => {
    const invite = await tx.invite.findUnique({ where: { token }, include: { branch: true } });
    if (!invite || !usable(invite) || invite.branch.companyId !== company.id) throw new AppError("invite_invalid", 400);
    const claimed = await tx.invite.updateMany({
      where: {
        id: invite.id,
        revokedAt: null,
        ...(invite.maxUses !== null ? { uses: { lt: invite.maxUses } } : {}),
      },
      data: { uses: { increment: 1 } },
    });
    if (claimed.count !== 1) throw new AppError("invite_invalid", 400);

    const membership = await tx.membership.findUnique({ where: { userId_companyId: { userId, companyId: company.id } } });
    const currentRole = membership?.active ? membership.role : null;
    const newRole = currentRole === "OWNER" ? "OWNER" : invite.role === "ADMIN" || currentRole === "ADMIN" ? "ADMIN" : "WORKER";
    await tx.membership.upsert({
      where: { userId_companyId: { userId, companyId: company.id } },
      create: { userId, companyId: company.id, role: newRole },
      update: { role: newRole, active: true },
    });

    if (invite.role === "ADMIN") {
      await tx.adminBranch.upsert({
        where: { userId_branchId: { userId, branchId: invite.branchId } },
        create: { userId, branchId: invite.branchId },
        update: {},
      });
    } else {
      await tx.branchMember.upsert({
        where: { branchId_userId: { branchId: invite.branchId, userId } },
        create: { branchId: invite.branchId, userId },
        update: { active: true, leftAt: null },
      });
    }
    await audit(tx, {
      companyId: company.id,
      actorUserId: userId,
      action: "invite.accept",
      entity: "invite",
      entityId: invite.id,
      after: { branchId: invite.branchId, role: invite.role },
    });
    return { branchId: invite.branchId, branchName: invite.branch.name, role: invite.role };
  });
}
