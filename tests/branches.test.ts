import { beforeAll, describe, expect, it } from "vitest";
import { app } from "../src/api/app.ts";
import { posterPdf } from "../src/branches/qrFiles.ts";
import { addToBranch, createBranch, getBranchFor, listMembers, regenerateQr } from "../src/branches/service.ts";
import { acceptInvite, createInvite, previewInvite } from "../src/invites/service.ts";
import { db } from "../src/lib/db.ts";
import { loadActor } from "../src/users/service.ts";
import type { Actor } from "../src/auth/permissions.ts";
import { createTestDb } from "./helpers/db.ts";
import { authHeaders, makeAdmin, makeOwner, makeUser, makeWorker, OFFICE } from "./helpers/fixtures.ts";

let owner: Actor;

beforeAll(async () => {
  await createTestDb();
  owner = await makeOwner();
});

describe("branches", () => {
  it("owner creates a branch with a default weekly schedule", async () => {
    const b = await createBranch(owner, { name: "Chilonzor", ...OFFICE, radiusM: 30 });
    expect(b.radiusM).toBe(30);
    expect(b.timezone).toBe("Asia/Tashkent");
    const week = await db().scheduleTemplate.findMany({ where: { branchId: b.id, userId: null } });
    expect(week).toHaveLength(7);
    expect(week.find((d) => d.weekday === 7)?.dayOff).toBe(true);
    const log = await db().auditLog.findFirst({ where: { action: "branch.create", entityId: String(b.id) } });
    expect(log).not.toBeNull();
  });

  it("rejects bad input", async () => {
    await expect(createBranch(owner, { name: "", ...OFFICE })).rejects.toThrow("branch_name");
    await expect(createBranch(owner, { name: "X", lat: 200, lng: 0 })).rejects.toThrow("bad_location");
    await expect(createBranch(owner, { name: "X", ...OFFICE, radiusM: 5 })).rejects.toThrow("bad_radius");
  });

  it("an admin creating a branch becomes its admin; other branches stay hidden", async () => {
    const other = await createBranch(owner, { name: "Other", ...OFFICE });
    const admin = await makeAdmin([]);
    const mine = await createBranch(admin, { name: "Mine", ...OFFICE });
    const fresh = await loadActor(await db().user.findUniqueOrThrow({ where: { id: admin.userId } }));
    expect(fresh.adminBranchIds).toContain(mine.id);
    await expect(getBranchFor(fresh, other.id)).rejects.toThrow("forbidden");
  });

  it("a worker cannot use admin endpoints", async () => {
    const b = await createBranch(owner, { name: "W", ...OFFICE });
    const { user } = await makeWorker(b.id);
    const res = await app.request("/api/admin/branches", { headers: authHeaders(user.telegramId) });
    expect(res.status).toBe(403);
  });

  it("regenerate bumps the QR version", async () => {
    const b = await createBranch(owner, { name: "QR", ...OFFICE });
    const after = await regenerateQr(owner, b.id);
    expect(after.qrVersion).toBe(b.qrVersion + 1);
  });

  it("makes an A4 poster PDF with Uzbek text", async () => {
    const pdf = await posterPdf({ name: "Chilonzor filiali", address: "Bunyodkor 1" }, "https://t.me/bot/app?startapp=q_1_1_abc");
    expect(new TextDecoder().decode(pdf.slice(0, 5))).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(5000);
  });
});

describe("invites", () => {
  it("single-use invite works once", async () => {
    const b = await createBranch(owner, { name: "Invite branch", ...OFFICE });
    const inv = await createInvite(owner, b.id, { singleUse: true, days: 7 });
    const token = inv.link.split("inv_")[1];
    expect(inv.link).toContain("https://t.me/davomat_test_bot/");

    const u1 = await makeUser("First");
    expect((await previewInvite(token, u1.id)).valid).toBe(true);
    await acceptInvite(token, u1.id);
    const actor = await loadActor(u1);
    expect(actor.role).toBe("WORKER");
    expect(actor.memberBranchIds).toEqual([b.id]);

    const u2 = await makeUser("Second");
    expect((await previewInvite(token, u2.id)).valid).toBe(false);
    await expect(acceptInvite(token, u2.id)).rejects.toThrow("invite_invalid");

    const members = await listMembers(owner, b.id);
    expect(members.map((m) => m.name)).toEqual(["First"]);
  });

  it("multi-use invite works many times; expired invite does not", async () => {
    const b = await createBranch(owner, { name: "Multi", ...OFFICE });
    const inv = await createInvite(owner, b.id, { singleUse: false, days: 1 });
    const token = inv.link.split("inv_")[1];
    await acceptInvite(token, (await makeUser("A")).id);
    await acceptInvite(token, (await makeUser("B")).id);
    expect(await db().branchMember.count({ where: { branchId: b.id } })).toBe(2);

    await db().invite.updateMany({ where: { token }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(acceptInvite(token, (await makeUser("C")).id)).rejects.toThrow("invite_invalid");
  });

  it("only the owner makes admin invites; accepting makes an admin", async () => {
    const b = await createBranch(owner, { name: "AdminInv", ...OFFICE });
    const admin = await makeAdmin([b.id]);
    await expect(createInvite(admin, b.id, { role: "ADMIN" })).rejects.toThrow("forbidden");
    const inv = await createInvite(owner, b.id, { role: "ADMIN" });
    const u = await makeUser("New admin");
    await acceptInvite(inv.link.split("inv_")[1], u.id);
    const actor = await loadActor(u);
    expect(actor.role).toBe("ADMIN");
    expect(actor.adminBranchIds).toEqual([b.id]);
  });

  it("move and allow keep history", async () => {
    const a = await createBranch(owner, { name: "From", ...OFFICE });
    const c = await createBranch(owner, { name: "To", ...OFFICE });
    const { user } = await makeWorker(a.id, "Mover", 100000);
    const member = await db().branchMember.findFirstOrThrow({ where: { userId: user.id, branchId: a.id } });
    await addToBranch(owner, member.id, c.id, true);
    const rows = await db().branchMember.findMany({ where: { userId: user.id }, orderBy: { branchId: "asc" } });
    expect(rows.map((r) => [r.branchId, r.active, r.defaultDailyAmount])).toEqual([
      [a.id, false, 100000],
      [c.id, true, 100000],
    ]);
  });
});
