// Company name, currency and settings (owner only).

import { audit } from "../audit/audit.ts";
import { canEditCompany, ensure, type Actor } from "../auth/permissions.ts";
import { db, transaction } from "../lib/db.ts";
import { AppError, badRequest } from "../lib/errors.ts";
import { DEFAULT_SETTINGS, parseSettings } from "../lib/settings.ts";
import type { Company } from "../generated/prisma/client.ts";

/**
 * Money is stored as plain integers (so'm or cents). Once any amount exists, switching the currency
 * would silently turn 250 000 so'm into $2 500.00, so it is locked.
 */
export async function isCurrencyLocked(companyId: number): Promise<boolean> {
  const branchIds = (await db().branch.findMany({ where: { companyId }, select: { id: true } })).map((b) => b.id);
  const [amounts, defaults, adjustments, results] = await Promise.all([
    db().dailyAmount.count({ where: { branchId: { in: branchIds } } }),
    db().branchMember.count({ where: { branchId: { in: branchIds }, defaultDailyAmount: { not: null } } }),
    db().adjustment.count({ where: { companyId } }),
    db().dailyResult.count({ where: { branchId: { in: branchIds } } }),
  ]);
  return amounts + defaults + adjustments + results > 0;
}

async function json(c: Company) {
  return {
    id: c.id,
    name: c.name,
    currency: c.currency,
    currencyLocked: await isCurrencyLocked(c.id),
    // The company Telegram group (linked by the owner with /groupid there).
    groupTitle: c.groupTitle,
    hasGroup: c.groupChatId !== null,
    settings: parseSettings(c.settings),
    defaults: DEFAULT_SETTINGS,
  };
}

export async function getCompany(actor: Actor) {
  ensure(canEditCompany(actor));
  return json(await db().company.findUniqueOrThrow({ where: { id: actor.companyId! } }));
}

export async function updateCompany(actor: Actor, raw: { name?: unknown; currency?: unknown; settings?: unknown }) {
  ensure(canEditCompany(actor));
  const before = await db().company.findUniqueOrThrow({ where: { id: actor.companyId! } });
  const data: { name?: string; currency?: "UZS" | "USD"; settings?: object } = {};
  if (raw.name !== undefined) {
    const name = typeof raw.name === "string" ? raw.name.trim() : "";
    if (!name || name.length > 80) throw badRequest();
    data.name = name;
  }
  if (raw.currency !== undefined && raw.currency !== before.currency) {
    if (raw.currency !== "UZS" && raw.currency !== "USD") throw badRequest();
    if (await isCurrencyLocked(before.id)) throw new AppError("currency_locked", 400);
    data.currency = raw.currency;
  }
  if (raw.settings !== undefined) {
    if (!raw.settings || typeof raw.settings !== "object") throw badRequest();
    data.settings = parseSettings({ ...parseSettings(before.settings), ...(raw.settings as object) });
  }
  return transaction(async (tx) => {
    const after = await tx.company.update({ where: { id: before.id }, data });
    await audit(tx, { companyId: before.id, actorUserId: actor.userId, action: "company.update", entity: "company", entityId: before.id, before, after });
    return after;
  }).then(json);
}
