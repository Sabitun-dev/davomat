// Who may do what (spec section 4). Every admin endpoint calls one of these on the server.
// Many companies share one bot, so every check stays inside the actor's current company:
// an OWNER manages all branches of THEIR company, never another company's.

import { forbidden } from "../lib/errors.ts";

export type RoleName = "OWNER" | "ADMIN" | "WORKER" | "NONE";

/** ok = usable; suspended/expired = blocked by the platform owner or the paid-until date; none = no company. */
export type CompanyAccess = "ok" | "suspended" | "expired" | "none";

export interface Actor {
  userId: number;
  telegramId: bigint;
  /** The current company (null = the user belongs to no company). */
  companyId: number | null;
  role: RoleName;
  /** Branches an admin manages in the current company. */
  adminBranchIds: number[];
  /** Branches of the current company where this user is an active worker. */
  memberBranchIds: number[];
  /** Every branch id of the current company. */
  companyBranchIds: number[];
  /** Telegram id is in OWNER_TELEGRAM_IDS: may add and switch companies. */
  platform: boolean;
  companyState: CompanyAccess;
  /** All companies where the user has an active membership. */
  companies: { id: number; name: string; role: RoleName }[];
}

export function isOwner(a: Actor): boolean {
  return a.role === "OWNER";
}

export function isStaff(a: Actor): boolean {
  return a.role === "OWNER" || a.role === "ADMIN";
}

function inCompany(a: Actor, branchId: number): boolean {
  return a.companyBranchIds.includes(branchId);
}

export function canManageBranch(a: Actor, branchId: number): boolean {
  if (!inCompany(a, branchId)) return false;
  if (a.role === "OWNER") return true;
  return a.role === "ADMIN" && a.adminBranchIds.includes(branchId);
}

export function canCreateBranch(a: Actor): boolean {
  return isStaff(a) && a.companyId !== null;
}

export function canManageAdmins(a: Actor): boolean {
  return isOwner(a);
}

export function canEditCompany(a: Actor): boolean {
  return isOwner(a);
}

export function canLockMonth(a: Actor): boolean {
  return isStaff(a);
}

export function canUnlockMonth(a: Actor): boolean {
  return isOwner(a);
}

/** A worker's data: themselves, or a manager of one of the worker's branches in this company. */
export function canViewWorker(a: Actor, workerUserId: number, workerBranchIds: number[]): boolean {
  if (a.userId === workerUserId) return true;
  return canManageWorker(a, workerBranchIds);
}

export function canManageWorker(a: Actor, workerBranchIds: number[]): boolean {
  const mine = workerBranchIds.filter((id) => inCompany(a, id));
  if (a.role === "OWNER") return mine.length > 0;
  return a.role === "ADMIN" && mine.some((id) => a.adminBranchIds.includes(id));
}

/** Branch ids this actor may see in admin screens. */
export function visibleBranchIds(a: Actor, allBranchIds: number[]): number[] {
  const mine = allBranchIds.filter((id) => inCompany(a, id));
  if (a.role === "OWNER") return mine;
  if (a.role === "ADMIN") return mine.filter((id) => a.adminBranchIds.includes(id));
  return [];
}

/** The branch ids of the current company the actor may manage (for filtering results). */
export function managedBranchIds(a: Actor): number[] {
  return visibleBranchIds(a, a.companyBranchIds);
}

export function ensure(condition: boolean): void {
  if (!condition) throw forbidden();
}
