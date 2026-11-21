// Many companies on one bot: each company sees only its own data; platform owners add and stop companies.

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { app } from "../src/api/app.ts";
import { recordAttempt } from "../src/attendance/service.ts";
import { staticToken } from "../src/attendance/qr.ts";
import { createBranch } from "../src/branches/service.ts";
import { companyState, billingToday } from "../src/companies/access.ts";
import { linkGroup } from "../src/companies/group.ts";
import { acceptInvite, acceptInviteCode, createInvite } from "../src/invites/service.ts";
import { paymentReminders, runScheduler } from "../src/jobs/scheduler.ts";
import { db } from "../src/lib/db.ts";
import { extendedDate } from "../src/platform/service.ts";
import { addDays, addMonths, localToUtc } from "../src/shared/time.ts";
import { loadActor, switchCompany } from "../src/users/service.ts";
import { onGroupVideoNote } from "../src/video/service.ts";
import type { Actor } from "../src/auth/permissions.ts";
import type { Branch, Company, User } from "../src/generated/prisma/client.ts";
import { createTestDb, sent } from "./helpers/db.ts";
import { authHeaders, makeCompany, makeOwner, makeUser, makeWorker, OFFICE } from "./helpers/fixtures.ts";

const SECRET = "test-qr-secret-0123456789-0123456789-abcdef";
let A: Company;
let B: Company;
let ownerA: Actor;
let ownerB: Actor;
let branchA: Branch;
let branchB: Branch;
let workerA: User;
let workerB: User;
let memberB: number;

async function call(actor: { telegramId: bigint }, method: string, path: string, body?: unknown) {
  const res = await app.request(`/api${path}`, {
    method,
    headers: authHeaders(actor.telegramId),
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

beforeAll(async () => {
  await createTestDb();
  A = await makeCompany("Company A");
  B = await makeCompany("Company B");
  ownerA = await makeOwner(A.id);
  ownerB = await makeOwner(B.id);
  branchA = await createBranch(ownerA, { name: "A branch", ...OFFICE });
  branchB = await createBranch(ownerB, { name: "B branch", ...OFFICE });
  workerA = (await makeWorker(branchA.id, "Worker A", 10000)).user;
  workerB = (await makeWorker(branchB.id, "Worker B", 10000)).user;
  memberB = (await db().branchMember.findFirstOrThrow({ where: { userId: workerB.id } })).id;
});

beforeEach(() => {
  sent.length = 0;
});

describe("companies never mix", () => {
  it("owner A cannot read or change anything of company B (every admin route)", async () => {
    const date = "2026-03-02";
    const evB = await db().attendanceEvent.create({
      data: {
        companyId: B.id,
        userId: workerB.id,
        branchId: branchB.id,
        localDate: date,
        type: "CHECK_IN",
        serverTime: localToUtc(date, 540, "Asia/Tashkent"),
        status: "ACCEPTED",
        idempotencyKey: "b-event-1",
      },
    });
    const blocked: [string, string, unknown?][] = [
      ["GET", `/admin/branches/${branchB.id}`],
      ["PATCH", `/admin/branches/${branchB.id}`, { name: "Hacked" }],
      ["POST", `/admin/branches/${branchB.id}/qr/regenerate`, {}],
      ["GET", `/admin/branches/${branchB.id}/members`],
      ["GET", `/admin/branches/${branchB.id}/invites`],
      ["POST", `/admin/branches/${branchB.id}/invites`, {}],
      ["GET", `/admin/branches/${branchB.id}/devices`],
      ["PATCH", `/admin/members/${memberB}`, { position: "x" }],
      ["POST", `/admin/members/${memberB}/branch`, { branchId: branchA.id, move: true }],
      ["GET", `/admin/branches/${branchB.id}/schedule?month=2026-03`],
      ["PUT", `/admin/branches/${branchB.id}/schedule/day`, { date, holiday: true }],
      ["GET", `/admin/branches/${branchB.id}/amounts?month=2026-03`],
      ["PUT", `/admin/branches/${branchB.id}/amounts`, { cells: [{ userId: workerB.id, date, amount: 1 }] }],
      ["GET", `/admin/day?userId=${workerB.id}&date=${date}`],
      ["POST", "/admin/events", { userId: workerB.id, date, type: "CHECK_OUT", time: "19:00", branchId: branchB.id, comment: "test" }],
      ["PATCH", `/admin/events/${evB.id}`, { time: "08:00", comment: "test" }],
      ["POST", `/admin/events/${evB.id}/void`, { comment: "test" }],
      ["POST", "/admin/day/review", { userId: workerB.id, date, comment: "test" }],
      ["GET", `/admin/adjustments?month=2026-03&userId=${workerB.id}`],
      ["POST", "/admin/adjustments", { userId: workerB.id, month: "2026-03", kind: "BONUS", amount: 100, comment: "test" }],
      ["GET", `/admin/reports/month?month=2026-03&branchId=${branchB.id}`],
      ["GET", `/admin/reports/table?month=2026-03&branchId=${branchB.id}`],
      ["GET", `/admin/reports/year?year=2026&branchId=${branchB.id}`],
      ["GET", `/admin/reports/worker-days?month=2026-03&userId=${workerB.id}`],
      ["GET", `/admin/dashboard?branchId=${branchB.id}`],
    ];
    for (const [method, path, body] of blocked) {
      const r = await call(ownerA, method, path, body);
      expect([403, 404, 400], `${method} ${path} -> ${r.status}`).toContain(r.status);
      expect(r.json.error, `${method} ${path}`).not.toBe("server_error");
    }
    // Nothing of B changed.
    expect((await db().branch.findUniqueOrThrow({ where: { id: branchB.id } })).name).toBe("B branch");
    expect((await db().attendanceEvent.findUniqueOrThrow({ where: { id: evB.id } })).voided).toBe(false);
    expect(await db().adjustment.count({ where: { userId: workerB.id } })).toBe(0);
  });

  it("lists show only the own company", async () => {
    const branches = await call(ownerA, "GET", "/admin/branches");
    expect((branches.json as unknown as { id: number }[]).map((b) => b.id)).toEqual([branchA.id]);
    const month = await call(ownerA, "GET", "/admin/reports/month?month=2026-03");
    const rows = (month.json as { rows: { userId: number }[] }).rows;
    expect(rows.some((r) => r.userId === workerB.id)).toBe(false);
    const people = await call(ownerA, "GET", "/admin/people");
    expect((people.json as unknown as { userId: number }[]).some((p) => p.userId === workerB.id)).toBe(false);
  });

  it("locking a month in A does not lock it in B", async () => {
    expect((await call(ownerA, "POST", "/admin/months/2026-01/lock", {})).status).toBe(200);
    expect((await call(ownerB, "GET", "/admin/months/2026-01")).json.locked).toBe(false);
  });

  it("a worker of A cannot check in with B's QR code", async () => {
    const r = await recordAttempt(
      workerA,
      A.id,
      { eventType: "CHECK_IN", qrToken: staticToken(SECRET, branchB.id, branchB.qrVersion), lat: OFFICE.lat, lng: OFFICE.lng, accuracy: 10, idempotencyKey: "cross-company-1", deviceId: null },
      { now: localToUtc("2026-03-03", 540, "Asia/Tashkent") },
    );
    expect(r).toMatchObject({ ok: false, reason: "bad_qr" });
  });

  it("an invite of B makes a person join B, not A", async () => {
    const inv = await createInvite(ownerB, branchB.id, { singleUse: false });
    const u = await makeUser("Joiner");
    await acceptInviteCode(inv.code, u.id);
    const fresh = await loadActor(await db().user.findUniqueOrThrow({ where: { id: u.id } }));
    expect(fresh.companyId).toBe(B.id);
    expect(fresh.memberBranchIds).toEqual([branchB.id]);
  });
});

describe("platform owner", () => {
  it("platform routes refuse company owners and workers", async () => {
    expect((await call(ownerA, "GET", "/platform/companies")).status).toBe(403);
    expect((await call(workerA, "GET", "/platform/companies")).status).toBe(403);
    expect((await call(ownerA, "POST", "/platform/companies", { name: "X", ownerTelegramId: "123456" })).status).toBe(403);
  });

  it("a platform owner creates a company with an owner who never opened the bot", async () => {
    const platform = { telegramId: 1000n };
    const r = await call(platform, "POST", "/platform/companies", {
      name: "New Shop",
      ownerTelegramId: "777000111",
      paidUntil: "2027-01-31",
      maxWorkers: 5,
      note: "+998 90 000 00 00, 300k",
    });
    expect(r.status).toBe(200);
    const company = r.json.company as { id: number; owners: { telegramId: string; opened: boolean }[]; maxWorkers: number };
    expect(company.owners).toEqual([expect.objectContaining({ telegramId: "777000111", opened: false })]);
    expect(company.maxWorkers).toBe(5);
    expect(r.json.notified).toBe(true); // the fake Telegram accepts every message
    expect(sent.some((s) => s.chatId === 777000111 && s.text?.includes("New Shop"))).toBe(true);
    const log = await db().auditLog.findFirst({ where: { companyId: company.id, action: "platform.company_create" } });
    expect(log).not.toBeNull();

    const list = await call(platform, "GET", "/platform/companies");
    expect((list.json as unknown as { name: string }[]).some((c) => c.name === "New Shop")).toBe(true);
    // The platform owner is not made an owner of the new company.
    const me = await loadActor(await db().user.findUniqueOrThrow({ where: { telegramId: 1000n } }));
    expect(me.companies.map((c) => c.id)).not.toContain(company.id);
  });

  it("+1 oy extends from paid-until when still in the future, otherwise from today", () => {
    expect(extendedDate("2026-12-10", 1, "2026-11-21")).toBe("2027-01-10");
    expect(extendedDate("2026-10-01", 1, "2026-11-21")).toBe("2026-12-21");
    expect(extendedDate(null, 1, "2026-11-21")).toBe("2026-12-21");
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
  });
});

describe("stopped and expired companies", () => {
  it("company state from active and paid-until", () => {
    expect(companyState({ active: true, paidUntil: null }, "2026-03-02")).toBe("ok");
    expect(companyState({ active: true, paidUntil: "2026-03-02" }, "2026-03-02")).toBe("ok");
    expect(companyState({ active: true, paidUntil: "2026-03-01" }, "2026-03-02")).toBe("expired");
    expect(companyState({ active: false, paidUntil: null }, "2026-03-02")).toBe("suspended");
  });

  for (const kind of ["suspended", "expired"] as const) {
    it(`${kind}: admin and worker routes, invites and the scheduler all stop`, async () => {
      const c = await makeCompany(`C ${kind}`);
      const owner = await makeOwner(c.id);
      const branch = await createBranch(owner, { name: `C branch ${kind}`, ...OFFICE });
      const { user: worker } = await makeWorker(branch.id, `C worker ${kind}`, 10000);
      await db().branchMember.updateMany({ where: { userId: worker.id }, data: { joinedAt: new Date("2026-01-01") } });
      const inv = await createInvite(owner, branch.id, { singleUse: false });
      await db().company.update({
        where: { id: c.id },
        data: kind === "suspended" ? { active: false } : { paidUntil: "2026-03-01" },
      });

      const admin = await call(owner, "GET", "/admin/branches");
      expect(admin).toMatchObject({ status: 403, json: { error: "company_inactive" } });
      const work = await call(worker, "GET", "/worker/today");
      expect(work).toMatchObject({ status: 403, json: { error: "company_inactive" } });
      const me = await call(owner, "GET", "/me");
      expect((me.json.company as { state: string }).state).toBe(kind);

      const u = await makeUser("Late joiner");
      await expect(acceptInvite(inv.link.split("inv_")[1], u.id)).rejects.toThrow("company_inactive");

      // Monday 2 March 2026, 09:25 in Tashkent: a healthy company's worker who has not checked in
      // gets a reminder; the stopped/expired company's worker gets nothing.
      const { user: control } = await makeWorker(branchA.id, `Control ${kind}`, 10000);
      await runScheduler(localToUtc("2026-03-02", 565, "Asia/Tashkent"));
      expect(sent.some((s) => s.chatId === Number(control.telegramId))).toBe(true);
      expect(sent.some((s) => s.chatId === Number(worker.telegramId))).toBe(false);
    });
  }
});

describe("worker limit", () => {
  it("max_workers is enforced when accepting an invite", async () => {
    const c = await makeCompany("Small", { maxWorkers: 1 });
    const owner = await makeOwner(c.id);
    const branch = await createBranch(owner, { name: "Small branch", ...OFFICE });
    await makeWorker(branch.id, "The only one");
    const inv = await createInvite(owner, branch.id, { singleUse: false });
    const u = await makeUser("One too many");
    await expect(acceptInviteCode(inv.code, u.id)).rejects.toThrow("company_full");
    // Admin invites do not count as workers.
    const platformOwnerInvite = await db().invite.create({
      data: { token: "adminInviteToken123", code: "ADMN22", branchId: branch.id, role: "ADMIN", expiresAt: new Date(Date.now() + 86400_000), createdById: owner.userId },
    });
    await acceptInvite(platformOwnerInvite.token, u.id);
  });
});

describe("groups per company", () => {
  it("/groupid links only for an owner of a usable company; another company's group is refused", async () => {
    expect((await linkGroup({ chatId: -100777n, title: "A team", owner: ownerA })).result).toBe("linked");
    expect((await linkGroup({ chatId: -100777n, title: "B team", owner: ownerB })).result).toBe("taken");
    const workerActor = await loadActor(workerA);
    expect((await linkGroup({ chatId: -100888n, title: "X", owner: workerActor })).result).toBe("not_owner");
    expect((await db().company.findUniqueOrThrow({ where: { id: A.id } })).groupTitle).toBe("A team");
  });

  it("a video in A's group links only to members of A", async () => {
    const r = await onGroupVideoNote({ companyId: A.id, chatId: -100777n, messageId: 900, fromTelegramId: workerB.telegramId, sentAt: new Date() });
    const v = await db().videoNote.findUniqueOrThrow({ where: { id: r!.videoId } });
    expect(v.userId).toBeNull();
    expect(r!.linkedEvent).toBeNull();
    const own = await onGroupVideoNote({ companyId: A.id, chatId: -100777n, messageId: 901, fromTelegramId: workerA.telegramId, sentAt: new Date() });
    expect((await db().videoNote.findUniqueOrThrow({ where: { id: own!.videoId } })).userId).toBe(workerA.id);
  });
});

describe("company switcher", () => {
  it("switches only to the user's own companies", async () => {
    const u = await makeUser("Two jobs");
    await db().membership.createMany({ data: [{ userId: u.id, companyId: A.id, role: "WORKER" }, { userId: u.id, companyId: B.id, role: "WORKER" }] });
    const other = await makeCompany("Not mine");
    await expect(switchCompany(u.id, other.id)).rejects.toThrow("forbidden");
    await switchCompany(u.id, B.id);
    const actor = await loadActor(await db().user.findUniqueOrThrow({ where: { id: u.id } }));
    expect(actor.companyId).toBe(B.id);
    expect(actor.companies.map((c) => c.id).sort()).toEqual([A.id, B.id].sort());
    const r = await call(u, "POST", "/me/company", { companyId: other.id });
    expect(r.status).toBe(403);
  });
});

describe("payment reminders", () => {
  it("3 days before: once to the owners and once to the platform owner", async () => {
    const now = new Date();
    const c = await makeCompany("Pays soon", { paidUntil: addDays(billingToday(now), 3) });
    const owner = await makeOwner(c.id);
    const summary = { autoClosed: 0, recalculated: 0, reminders: 0, summaries: 0, gpsCleared: 0, errors: 0 };
    await paymentReminders(now, summary);
    await paymentReminders(now, summary);
    expect(sent.filter((s) => s.chatId === Number(owner.telegramId))).toHaveLength(1);
    expect(sent.filter((s) => s.chatId === 1000 && s.text?.includes("Pays soon"))).toHaveLength(1);
  });

  it("the day after it expires, the platform owner is told once", async () => {
    const now = new Date();
    await makeCompany("Just stopped", { paidUntil: addDays(billingToday(now), -1) });
    const summary = { autoClosed: 0, recalculated: 0, reminders: 0, summaries: 0, gpsCleared: 0, errors: 0 };
    await paymentReminders(now, summary);
    await paymentReminders(now, summary);
    expect(sent.filter((s) => s.chatId === 1000 && s.text?.includes("Just stopped"))).toHaveLength(1);
  });
});
