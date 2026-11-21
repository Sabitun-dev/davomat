// Platform owner (OWNER_TELEGRAM_IDS) tools: add companies, set paid-until, pause, add owners.
// The platform owner sees each company's numbers, not its payroll or worker details.
// Every action is written to the audit log with the company id and the platform owner's user id.

import { audit } from "../audit/audit.ts";
import type { Actor } from "../auth/permissions.ts";
import { openAppKeyboard, sendText } from "../bot/api.ts";
import { activeWorkerCount, billingToday, companyState } from "../companies/access.ts";
import { botStartLink, webAppUrl } from "../lib/appConfig.ts";
import { db, transaction } from "../lib/db.ts";
import { badRequest, notFound } from "../lib/errors.ts";
import { addMonths, isValidDate } from "../shared/time.ts";
import { t } from "../i18n/index.ts";
import { displayName, pickLanguage } from "../users/service.ts";
import type { Company } from "../generated/prisma/client.ts";

// ---- input checks ----

function cleanName(v: unknown): string {
  const s = typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
  if (!s || s.length > 80) throw badRequest("company_name");
  return s;
}

function cleanTelegramId(v: unknown): bigint {
  const s = typeof v === "string" || typeof v === "number" ? String(v).trim() : "";
  if (!/^\d{5,15}$/.test(s)) throw badRequest("bad_telegram_id");
  return BigInt(s);
}

function cleanPaidUntil(v: unknown): string | null {
  if (v === null || v === "" || v === undefined) return null;
  if (typeof v !== "string" || !isValidDate(v)) throw badRequest("bad_date");
  return v;
}

function cleanMaxWorkers(v: unknown): number | null {
  if (v === null || v === "" || v === undefined) return null;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 100_000) throw badRequest("bad_max_workers");
  return v;
}

function cleanNote(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (typeof v !== "string" || v.length > 1000) throw badRequest();
  return v.trim();
}

// ---- reading ----

async function owners(companyId: number) {
  const rows = await db().membership.findMany({
    where: { companyId, role: "OWNER", active: true },
    include: { user: true },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((m) => ({
    userId: m.userId,
    telegramId: m.user.telegramId.toString(),
    name: displayName(m.user) === "—" ? null : displayName(m.user),
    // "hali kirmagan": they never opened the bot or the app.
    opened: m.user.lastSeenAt !== null || m.user.consentAt !== null,
  }));
}

function daysLeft(paidUntil: string | null, today: string): number | null {
  if (!paidUntil) return null;
  return Math.round((Date.parse(`${paidUntil}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400_000);
}

async function companyJson(c: Company) {
  const today = billingToday();
  return {
    id: c.id,
    name: c.name,
    active: c.active,
    paidUntil: c.paidUntil,
    maxWorkers: c.maxWorkers,
    note: c.note,
    currency: c.currency,
    groupTitle: c.groupTitle,
    hasGroup: c.groupChatId !== null,
    state: companyState(c, today),
    daysLeft: daysLeft(c.paidUntil, today),
    workers: await activeWorkerCount(c.id),
    owners: await owners(c.id),
    createdAt: c.createdAt,
  };
}

export async function listCompanies() {
  const rows = await db().company.findMany({ orderBy: { createdAt: "desc" } });
  return Promise.all(rows.map(companyJson));
}

export async function companyDetail(id: number) {
  const c = await db().company.findUnique({ where: { id } });
  if (!c) throw notFound();
  const since = new Date(Date.now() - 30 * 86400_000);
  const [branches, checkIns, last] = await Promise.all([
    db().branch.count({ where: { companyId: id } }),
    db().attendanceEvent.count({ where: { companyId: id, type: "CHECK_IN", status: "ACCEPTED", serverTime: { gte: since } } }),
    db().attendanceEvent.findFirst({ where: { companyId: id }, orderBy: { serverTime: "desc" }, select: { serverTime: true } }),
  ]);
  return { ...(await companyJson(c)), stats: { branches, checkIns30: checkIns, lastActivity: last?.serverTime ?? null } };
}

// ---- owners ----

/** Makes a Telegram account the OWNER of a company. The user row is created if they never opened the bot. */
async function addOwnerRow(companyId: number, telegramId: bigint) {
  const user = await db().user.upsert({ where: { telegramId }, create: { telegramId }, update: {} });
  await db().membership.upsert({
    where: { userId_companyId: { userId: user.id, companyId } },
    create: { userId: user.id, companyId, role: "OWNER" },
    update: { role: "OWNER", active: true },
  });
  if (!user.currentCompanyId) await db().user.update({ where: { id: user.id }, data: { currentCompanyId: companyId } });
  return user;
}

/** The bot tries to tell the new owner. If it cannot write to them yet, a link is returned to send by hand. */
async function notifyOwner(telegramId: bigint, companyName: string) {
  const user = await db().user.findUnique({ where: { telegramId } });
  const lang = user?.language ?? pickLanguage(null);
  const result = await sendText(telegramId, t(lang, "bot.owner_assigned", { company: companyName }), {
    reply_markup: openAppKeyboard(t(lang, "bot.open"), webAppUrl()),
  });
  return { notified: result === "ok", link: await botStartLink("owner") };
}

// ---- changes ----

export async function createCompany(actor: Actor, raw: Record<string, unknown>) {
  const name = cleanName(raw.name);
  const ownerId = cleanTelegramId(raw.ownerTelegramId);
  const paidUntil = cleanPaidUntil(raw.paidUntil);
  const maxWorkers = cleanMaxWorkers(raw.maxWorkers);
  const note = cleanNote(raw.note);
  const currency = raw.currency === "USD" ? "USD" : "UZS";
  const company = await transaction(async (tx) => {
    const c = await tx.company.create({ data: { name, paidUntil, maxWorkers, note, currency, createdByUserId: actor.userId } });
    await audit(tx, { companyId: c.id, actorUserId: actor.userId, action: "platform.company_create", entity: "company", entityId: c.id, after: c });
    return c;
  });
  await addOwnerRow(company.id, ownerId);
  await audit(db(), {
    companyId: company.id,
    actorUserId: actor.userId,
    action: "platform.owner_add",
    entity: "company",
    entityId: company.id,
    after: { telegramId: ownerId.toString() },
  });
  return { company: await companyDetail(company.id), ...(await notifyOwner(ownerId, company.name)) };
}

export async function updateCompany(actor: Actor, id: number, raw: Record<string, unknown>) {
  const before = await db().company.findUnique({ where: { id } });
  if (!before) throw notFound();
  const data: Partial<Pick<Company, "name" | "paidUntil" | "maxWorkers" | "note">> = {};
  if (raw.name !== undefined) data.name = cleanName(raw.name);
  if (raw.paidUntil !== undefined) data.paidUntil = cleanPaidUntil(raw.paidUntil);
  if (raw.maxWorkers !== undefined) data.maxWorkers = cleanMaxWorkers(raw.maxWorkers);
  if (raw.note !== undefined) data.note = cleanNote(raw.note);
  await transaction(async (tx) => {
    const after = await tx.company.update({ where: { id }, data });
    await audit(tx, { companyId: id, actorUserId: actor.userId, action: "platform.company_update", entity: "company", entityId: id, before, after });
  });
  return companyDetail(id);
}

/** +N months: from paid-until if it is still in the future, otherwise from today. */
export function extendedDate(paidUntil: string | null, months: number, today = billingToday()): string {
  const from = paidUntil && paidUntil >= today ? paidUntil : today;
  return addMonths(from, months);
}

export async function extendCompany(actor: Actor, id: number, months: unknown) {
  const n = months === undefined ? 1 : months;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > 36) throw badRequest();
  const before = await db().company.findUnique({ where: { id } });
  if (!before) throw notFound();
  const paidUntil = extendedDate(before.paidUntil, n);
  await transaction(async (tx) => {
    await tx.company.update({ where: { id }, data: { paidUntil } });
    await audit(tx, {
      companyId: id,
      actorUserId: actor.userId,
      action: "platform.company_extend",
      entity: "company",
      entityId: id,
      before: { paidUntil: before.paidUntil },
      after: { paidUntil },
    });
  });
  return companyDetail(id);
}

export async function setCompanyActive(actor: Actor, id: number, active: unknown) {
  if (typeof active !== "boolean") throw badRequest();
  const before = await db().company.findUnique({ where: { id } });
  if (!before) throw notFound();
  await transaction(async (tx) => {
    await tx.company.update({ where: { id }, data: { active } });
    await audit(tx, {
      companyId: id,
      actorUserId: actor.userId,
      action: active ? "platform.company_activate" : "platform.company_suspend",
      entity: "company",
      entityId: id,
      before: { active: before.active },
      after: { active },
    });
  });
  return companyDetail(id);
}

export async function addCompanyOwner(actor: Actor, id: number, rawTelegramId: unknown) {
  const company = await db().company.findUnique({ where: { id } });
  if (!company) throw notFound();
  const telegramId = cleanTelegramId(rawTelegramId);
  await addOwnerRow(id, telegramId);
  await audit(db(), {
    companyId: id,
    actorUserId: actor.userId,
    action: "platform.owner_add",
    entity: "company",
    entityId: id,
    after: { telegramId: telegramId.toString() },
  });
  return { company: await companyDetail(id), ...(await notifyOwner(telegramId, company.name)) };
}
