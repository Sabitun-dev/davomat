// Each company links its own Telegram group (where workers send round videos) with /groupid.
// Backward compatibility: if GROUP_CHAT_ID is set and no company has linked that group, it is
// treated as the group of the oldest company.

import { db, type Tx } from "../lib/db.ts";
import { env } from "../lib/env.ts";
import type { Company } from "../generated/prisma/client.ts";

type DbLike = Tx | ReturnType<typeof db>;

async function oldestCompany(tx: DbLike = db()): Promise<Company | null> {
  return tx.company.findFirst({ orderBy: { id: "asc" } });
}

/** The company whose group this chat is (or null). */
export async function companyForGroup(chatId: bigint): Promise<Company | null> {
  const linked = await db().company.findUnique({ where: { groupChatId: chatId } });
  if (linked) return linked;
  if (env.groupChatId !== null && env.groupChatId === chatId) return oldestCompany();
  return null;
}

/** The group chat id of a company: its linked group, or GROUP_CHAT_ID for the oldest company. */
export async function groupOfCompany(companyId: number, tx: DbLike = db()): Promise<bigint | null> {
  const company = await tx.company.findUnique({ where: { id: companyId }, select: { groupChatId: true } });
  if (company?.groupChatId) return company.groupChatId;
  const legacy = env.groupChatId;
  if (legacy === null) return null;
  const takenByOther = await tx.company.findUnique({ where: { groupChatId: legacy }, select: { id: true } });
  if (takenByOther) return null;
  return (await oldestCompany(tx))?.id === companyId ? legacy : null;
}

export type LinkResult = "linked" | "taken" | "not_owner";

/**
 * /groupid sent in a group: links the group to the sender's current company, but only when the
 * sender is the OWNER of a usable company and no other company already has this group.
 */
export async function linkGroup(input: {
  chatId: bigint;
  title: string;
  owner: { role: string; companyId: number | null; companyState: string; userId: number };
}): Promise<{ result: LinkResult; companyName?: string }> {
  const { owner } = input;
  if (owner.role !== "OWNER" || owner.companyId === null || owner.companyState !== "ok") return { result: "not_owner" };
  const holder = await db().company.findUnique({ where: { groupChatId: input.chatId }, select: { id: true } });
  if (holder && holder.id !== owner.companyId) return { result: "taken" };
  const company = await db().company.update({
    where: { id: owner.companyId },
    data: { groupChatId: input.chatId, groupTitle: input.title.slice(0, 120) },
  });
  await db().auditLog.create({
    data: {
      companyId: company.id,
      actorUserId: owner.userId,
      action: "company.group_link",
      entity: "company",
      entityId: String(company.id),
      after: { groupChatId: input.chatId.toString(), groupTitle: company.groupTitle },
    },
  });
  return { result: "linked", companyName: company.name };
}
