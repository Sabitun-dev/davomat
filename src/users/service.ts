// Users, roles and the first-open steps (consent, phone, name).

import type { Actor, RoleName } from "../auth/permissions.ts";
import type { TelegramUser } from "../auth/initData.ts";
import { db, type Tx } from "../lib/db.ts";
import { env } from "../lib/env.ts";
import { badRequest } from "../lib/errors.ts";
import type { Company, User } from "../generated/prisma/client.ts";

export const LANGUAGES = ["uz", "ru", "en"] as const;
export type Language = (typeof LANGUAGES)[number];

export function pickLanguage(code: string | undefined | null): Language {
  if (code && (LANGUAGES as readonly string[]).includes(code)) return code as Language;
  if (code?.startsWith("ru")) return "ru";
  return env.defaultLanguage;
}

/** The single company of this installation, created on first use. */
export async function ensureCompany(tx: Tx | ReturnType<typeof db> = db()): Promise<Company> {
  const existing = await tx.company.findFirst({ orderBy: { id: "asc" } });
  if (existing) return existing;
  return tx.company.create({ data: { name: "Kompaniya" } });
}

/** Finds or creates the user for a Telegram account and refreshes their Telegram names. */
export async function upsertTelegramUser(tg: TelegramUser): Promise<User> {
  const telegramId = BigInt(tg.id);
  const names = {
    firstName: (tg.first_name ?? "").slice(0, 128),
    lastName: (tg.last_name ?? "").slice(0, 128),
    username: tg.username?.slice(0, 64) ?? null,
  };
  const existing = await db().user.findUnique({ where: { telegramId } });
  if (!existing) {
    return db().user.create({
      data: { telegramId, ...names, language: pickLanguage(tg.language_code), lastSeenAt: new Date() },
    });
  }
  const stale = !existing.lastSeenAt || Date.now() - existing.lastSeenAt.getTime() > 10 * 60 * 1000;
  const changed =
    existing.firstName !== names.firstName || existing.lastName !== names.lastName || existing.username !== names.username;
  if (!stale && !changed) return existing;
  return db().user.update({ where: { id: existing.id }, data: { ...names, lastSeenAt: new Date() } });
}

/** Builds the Actor (role and branches) for a user. Owners listed in OWNER_TELEGRAM_IDS are added here. */
export async function loadActor(user: User): Promise<Actor> {
  const company = await ensureCompany();
  let membership = await db().membership.findUnique({
    where: { userId_companyId: { userId: user.id, companyId: company.id } },
  });
  const isEnvOwner = env.ownerTelegramIds.includes(user.telegramId);
  if (isEnvOwner && (!membership || membership.role !== "OWNER" || !membership.active)) {
    membership = await db().membership.upsert({
      where: { userId_companyId: { userId: user.id, companyId: company.id } },
      create: { userId: user.id, companyId: company.id, role: "OWNER" },
      update: { role: "OWNER", active: true },
    });
  }
  const role: RoleName = membership?.active ? membership.role : "NONE";
  const [adminBranches, memberBranches] = await Promise.all([
    role === "ADMIN" ? db().adminBranch.findMany({ where: { userId: user.id }, select: { branchId: true } }) : [],
    db().branchMember.findMany({
      where: { userId: user.id, active: true, branch: { active: true, companyId: company.id } },
      select: { branchId: true },
    }),
  ]);
  return {
    userId: user.id,
    telegramId: user.telegramId,
    companyId: membership?.active ? company.id : null,
    role,
    adminBranchIds: adminBranches.map((b) => b.branchId),
    memberBranchIds: memberBranches.map((b) => b.branchId),
  };
}

export function displayName(u: Pick<User, "fullName" | "firstName" | "lastName">): string {
  return u.fullName || [u.firstName, u.lastName].filter(Boolean).join(" ") || "—";
}

/** "+998 90 123 45 67" / "998901234567" -> "+998901234567". Returns null when it is not a phone number. */
export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return null;
  return `+${digits}`;
}

/**
 * Saves the phone from a contact message the BOT received (never from the Mini App callback).
 * Accepted only when the contact belongs to the sender.
 */
export async function savePhoneFromContact(input: {
  fromId: number;
  contactUserId: number | undefined;
  phone: string;
  firstName?: string;
  lastName?: string;
  username?: string;
  languageCode?: string;
}): Promise<boolean> {
  if (!input.contactUserId || input.contactUserId !== input.fromId) return false;
  const phone = normalizePhone(input.phone);
  if (!phone) return false;
  const telegramId = BigInt(input.fromId);
  await db().user.upsert({
    where: { telegramId },
    create: {
      telegramId,
      phone,
      firstName: input.firstName ?? "",
      lastName: input.lastName ?? "",
      username: input.username ?? null,
      language: pickLanguage(input.languageCode),
    },
    update: { phone },
  });
  return true;
}

export function cleanName(raw: unknown): string {
  if (typeof raw !== "string") throw badRequest("name_invalid");
  const name = raw.replace(/\s+/g, " ").trim();
  if (name.length < 2 || name.length > 80) throw badRequest("name_invalid");
  return name;
}

export async function updateProfile(
  userId: number,
  patch: { consent?: boolean; fullName?: string; language?: string; introSeen?: string; writeAccess?: boolean },
): Promise<User> {
  const user = await db().user.findUniqueOrThrow({ where: { id: userId } });
  const data: Partial<User> = {};
  if (patch.consent) data.consentAt = user.consentAt ?? new Date();
  if (patch.fullName !== undefined) {
    data.fullName = cleanName(patch.fullName);
    data.nameConfirmedAt = new Date();
  }
  if (patch.language !== undefined) {
    if (!(LANGUAGES as readonly string[]).includes(patch.language)) throw badRequest("bad_language");
    data.language = patch.language;
  }
  if (patch.introSeen && ["worker", "admin"].includes(patch.introSeen) && !user.introSeen.includes(patch.introSeen)) {
    data.introSeen = [...user.introSeen, patch.introSeen];
  }
  if (patch.writeAccess !== undefined) data.writeAccess = patch.writeAccess;
  if (Object.keys(data).length === 0) return user;
  return db().user.update({ where: { id: userId }, data });
}
