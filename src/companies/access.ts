// Is a company allowed to use Davomat right now? (Platform owner switches; paid-until date.)
// A company is usable when it is active AND (no paid-until date OR today in Tashkent <= paid-until).

import { db, type Tx } from "../lib/db.ts";
import { AppError } from "../lib/errors.ts";
import { toLocal } from "../shared/time.ts";

/** Payment dates are counted in Tashkent time, wherever the branches are. */
export const BILLING_TZ = "Asia/Tashkent";

export type CompanyState = "ok" | "suspended" | "expired";

export function billingToday(now = new Date()): string {
  return toLocal(now, BILLING_TZ).date;
}

export function companyState(c: { active: boolean; paidUntil: string | null }, today = billingToday()): CompanyState {
  if (!c.active) return "suspended";
  if (c.paidUntil && today > c.paidUntil) return "expired";
  return "ok";
}

export function isUsable(c: { active: boolean; paidUntil: string | null }, today = billingToday()): boolean {
  return companyState(c, today) === "ok";
}

/** Throws company_inactive unless the company exists and is usable. */
export async function assertUsable(companyId: number, tx: Tx | ReturnType<typeof db> = db()): Promise<void> {
  const c = await tx.company.findUnique({ where: { id: companyId }, select: { active: true, paidUntil: true } });
  if (!c || !isUsable(c)) throw new AppError("company_inactive", 403);
}

/** Active workers of a company: different people who are active members of any of its branches. */
export async function activeWorkerCount(companyId: number, tx: Tx | ReturnType<typeof db> = db()): Promise<number> {
  const rows = await tx.branchMember.findMany({
    where: { active: true, branch: { companyId } },
    select: { userId: true },
    distinct: ["userId"],
  });
  return rows.length;
}
