import { describe, expect, it } from "vitest";
import {
  canCreateBranch,
  canLockMonth,
  canManageAdmins,
  canManageBranch,
  canManageWorker,
  canUnlockMonth,
  canViewWorker,
  visibleBranchIds,
  type Actor,
} from "../src/auth/permissions.ts";

// Company 1 has branches 10 and 20; branch 99 belongs to another company.
const base = {
  telegramId: 1n,
  companyId: 1,
  memberBranchIds: [] as number[],
  companyBranchIds: [10, 20],
  platform: false,
  companyState: "ok" as const,
  companies: [],
};
const owner: Actor = { ...base, userId: 1, role: "OWNER", adminBranchIds: [] };
const admin: Actor = { ...base, userId: 2, role: "ADMIN", adminBranchIds: [10] };
const worker: Actor = { ...base, userId: 3, role: "WORKER", adminBranchIds: [], memberBranchIds: [10] };
const stranger: Actor = { ...base, userId: 4, role: "NONE", adminBranchIds: [], companyId: null, companyBranchIds: [], companyState: "none" };

describe("permissions", () => {
  it("owner can do everything inside their company, nothing outside it", () => {
    expect(canManageBranch(owner, 10)).toBe(true);
    expect(canManageBranch(owner, 99)).toBe(false);
    expect(canManageWorker(owner, [99])).toBe(false);
    expect(canViewWorker(owner, 5, [99])).toBe(false);
    expect(canManageWorker(owner, [99, 20])).toBe(true);
    expect(visibleBranchIds(owner, [10, 20, 99])).toEqual([10, 20]);
    expect(canManageAdmins(owner)).toBe(true);
    expect(canUnlockMonth(owner)).toBe(true);
    expect(canLockMonth(owner)).toBe(true);
    expect(visibleBranchIds(owner, [10, 20])).toEqual([10, 20]);
  });

  it("admin manages only assigned branches", () => {
    expect(canManageBranch(admin, 10)).toBe(true);
    expect(canManageBranch(admin, 20)).toBe(false);
    expect(canCreateBranch(admin)).toBe(true);
    expect(canManageAdmins(admin)).toBe(false);
    expect(canLockMonth(admin)).toBe(true);
    expect(canUnlockMonth(admin)).toBe(false);
    expect(visibleBranchIds(admin, [10, 20])).toEqual([10]);
    expect(canManageWorker(admin, [10])).toBe(true);
    expect(canManageWorker(admin, [20])).toBe(false);
  });

  it("worker sees only themselves", () => {
    expect(canManageBranch(worker, 10)).toBe(false);
    expect(canCreateBranch(worker)).toBe(false);
    expect(canViewWorker(worker, 3, [10])).toBe(true);
    expect(canViewWorker(worker, 5, [10])).toBe(false);
    expect(visibleBranchIds(worker, [10])).toEqual([]);
    expect(canLockMonth(worker)).toBe(false);
  });

  it("admin sees workers of their branches only", () => {
    expect(canViewWorker(admin, 5, [10])).toBe(true);
    expect(canViewWorker(admin, 5, [20])).toBe(false);
  });

  it("user without a role can do nothing", () => {
    expect(canManageBranch(stranger, 10)).toBe(false);
    expect(canCreateBranch(stranger)).toBe(false);
    expect(canViewWorker(stranger, 5, [10])).toBe(false);
  });
});
