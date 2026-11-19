// Company name, currency and settings (owner only).

import { audit } from "../audit/audit.ts";
import { canEditCompany, ensure, type Actor } from "../auth/permissions.ts";
import { db, transaction } from "../lib/db.ts";
import { badRequest } from "../lib/errors.ts";
import { DEFAULT_SETTINGS, parseSettings } from "../lib/settings.ts";

export async function getCompany(actor: Actor) {
  ensure(canEditCompany(actor));
  const c = await db().company.findUniqueOrThrow({ where: { id: actor.companyId! } });
  return { id: c.id, name: c.name, currency: c.currency, settings: parseSettings(c.settings), defaults: DEFAULT_SETTINGS };
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
  if (raw.currency !== undefined) {
    if (raw.currency !== "UZS" && raw.currency !== "USD") throw badRequest();
    // Changing currency does not convert stored amounts; it only changes how they are read.
    data.currency = raw.currency;
  }
  if (raw.settings !== undefined) {
    if (!raw.settings || typeof raw.settings !== "object") throw badRequest();
    data.settings = { ...parseSettings(before.settings), ...parseSettings({ ...parseSettings(before.settings), ...(raw.settings as object) }) };
  }
  return transaction(async (tx) => {
    const after = await tx.company.update({ where: { id: before.id }, data });
    await audit(tx, { companyId: before.id, actorUserId: actor.userId, action: "company.update", entity: "company", entityId: before.id, before, after });
    return { id: after.id, name: after.name, currency: after.currency, settings: parseSettings(after.settings), defaults: DEFAULT_SETTINGS };
  });
}
