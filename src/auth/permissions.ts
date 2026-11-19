// Who may do what (spec section 4). Every admin endpoint calls one of these on the server.

import { forbidden } from "../lib/errors.ts";

export type RoleName = "OWNER" | "ADMIN" | "WORKER" | "NONE";

export interface Actor {
  userId: number;
  telegramId: bigint;
  companyId: number | null;
  role: RoleName;
  /** Branches an admin manages (empty for owner: the owner sees all). */
  adminBranchIds: number[];
  /** Branches where this user is an active worker. */
  memberBranchIds: number[];
}

export function isOwner(a: Actor): boolean {
  return a.role === "OWNER";
}

export function isStaff(a: Actor): boolean {
  return a.role === "OWNER" || a.role === "ADMIN";
}

export function canManageBranch(a: Actor, branchId: number): boolean {
  if (a.role === "OWNER") return true;
  return a.role === "ADMIN" && a.adminBranchIds.includes(branchId);
}

export function canCreateBranch(a: Actor): boolean {
  return isStaff(a);
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

/** A worker's data: themselves, or a manager of one of the worker's branches. */
export function canViewWorker(a: Actor, workerUserId: number, workerBranchIds: number[]): boolean {
  if (a.userId === workerUserId) return true;
  if (a.role === "OWNER") return true;
  return a.role === "ADMIN" && workerBranchIds.some((id) => a.adminBranchIds.includes(id));
}

export function canManageWorker(a: Actor, workerBranchIds: number[]): boolean {
  if (a.role === "OWNER") return true;
  return a.role === "ADMIN" && workerBranchIds.some((id) => a.adminBranchIds.includes(id));
}

/** Branch ids this actor may see in admin screens. */
export function visibleBranchIds(a: Actor, allBranchIds: number[]): number[] {
  if (a.role === "OWNER") return allBranchIds;
  if (a.role === "ADMIN") return allBranchIds.filter((id) => a.adminBranchIds.includes(id));
  return [];
}

export function ensure(condition: boolean): void {
  if (!condition) throw forbidden();
}
