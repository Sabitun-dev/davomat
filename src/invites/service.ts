// Invites (spec 5.2). Each invite can be used two ways:
//  - a link: https://t.me/<bot>?start=inv_<token> (the bot answers with an "Ochish" button that opens
//    the Mini App with the invite), or the direct Mini App link t.me/<bot>/<app>?startapp=inv_<token>;
//  - a short code (e.g. K7M2QX) the worker types in the app after entering their name.

import { audit } from "../audit/audit.ts";
import { canManageAdmins, ensure, type Actor } from "../auth/permissions.ts";
import { getBranchFor } from "../branches/service.ts";
import { botStartLink, miniAppLink } from "../lib/appConfig.ts";
import { randomAlnum, randomCode } from "../lib/crypto.ts";
import { db, transaction } from "../lib/db.ts";
import { AppError, badRequest, notFound } from "../lib/errors.ts";
import { parseSettings } from "../lib/settings.ts";
import { activeWorkerCount, isUsable } from "../companies/access.ts";
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
    code: i.code,
    link: await botStartLink(`inv_${i.token}`),
    appLink: await miniAppLink(`inv_${i.token}`),
  };
}

/** A code no other invite uses. */
async function freeCode(): Promise<string> {
  for (let i = 0; i < 10; i++) {
    const code = randomCode(6);
    if (!(await db().invite.findUnique({ where: { code }, select: { id: true } }))) return code;
  }
  return randomCode(8);
}

export function normalizeCode(raw: unknown): string {
  return typeof raw === "string" ? raw.toUpperCase().replace(/[^A-Z0-9]/g, "") : "";
}

/** Max wrong codes per person in 10 minutes, so codes cannot be guessed. */
export const CODE_ATTEMPTS = 10;

/** Joins by the short code. Wrong codes are counted; too many in 10 minutes are refused. */
export async function acceptInviteCode(rawCode: unknown, userId: number) {
  const fails = await db().auditLog.count({
    where: { actorUserId: userId, action: "invite.code_fail", at: { gt: new Date(Date.now() - 10 * 60_000) } },
  });
  if (fails >= CODE_ATTEMPTS) throw new AppError("rate_limited", 429);
  const code = normalizeCode(rawCode);
  const invite = code.length >= 4 ? await db().invite.findUnique({ where: { code } }) : null;
  if (!invite) {
    // The person may have no company yet, so the log entry has none either.
    await audit(db(), { companyId: null, actorUserId: userId, action: "invite.code_fail", entity: "invite", entityId: code.slice(0, 12) || "-" });
    throw new AppError("invite_code_wrong", 400);
  }
  return acceptInvite(invite.token, userId);
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
  // Picked before the transaction: it reads the database on its own connection.
  const code = await freeCode();
  const invite = await transaction(async (tx) => {
    const created = await tx.invite.create({
      data: {
        token: randomAlnum(22),
        code,
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
  // Invites made before codes existed get one now.
  for (const i of usable) if (!i.code) i.code = (await db().invite.update({ where: { id: i.id }, data: { code: await freeCode() } })).code;
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
  const invite = await db().invite.findUnique({ where: { token }, include: { branch: { include: { company: true } } } });
  if (!invite) return { valid: false, branchName: "", role: "WORKER" as const, alreadyMember: false };
  const member = await db().branchMember.findUnique({
    where: { branchId_userId: { branchId: invite.branchId, userId } },
  });
  const admin =
    invite.role === "ADMIN"
      ? await db().adminBranch.findUnique({ where: { userId_branchId: { userId, branchId: invite.branchId } } })
      : null;
  return {
    // A stopped or expired company does not accept new people.
    valid: usable(invite) && isUsable(invite.branch.company),
    branchName: invite.branch.name,
    role: invite.role,
    alreadyMember: invite.role === "ADMIN" ? Boolean(admin) : Boolean(member?.active),
  };
}

/**
 * Joins the company of the invite's branch and makes it the user's current company.
 * The use count is raised atomically, so a single-use link works only once.
 */
export async function acceptInvite(token: string, userId: number) {
  const user = await db().user.findUniqueOrThrow({ where: { id: userId } });
  if (!user.phone || !user.nameConfirmedAt) throw new AppError("bad_request", 400);
  return transaction(async (tx) => {
    const invite = await tx.invite.findUnique({ where: { token }, include: { branch: { include: { company: true } } } });
    if (!invite || !usable(invite)) throw new AppError("invite_invalid", 400);
    const company = invite.branch.company;
    if (!isUsable(company)) throw new AppError("company_inactive", 403);
    // Worker limit: a new active worker must fit under max_workers.
    if (invite.role === "WORKER" && company.maxWorkers !== null) {
      const already = await tx.branchMember.findFirst({ where: { userId, active: true, branch: { companyId: company.id } } });
      if (!already && (await activeWorkerCount(company.id, tx)) >= company.maxWorkers) throw new AppError("company_full", 400);
    }
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
    await tx.user.update({ where: { id: userId }, data: { currentCompanyId: company.id } });
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
