import { beforeAll, describe, expect, it } from "vitest";
import { createBranch } from "../src/branches/service.ts";
import { db } from "../src/lib/db.ts";
import { localToUtc } from "../src/shared/time.ts";
import { amountGrid, bulkFill, setAmounts } from "../src/pay/amounts.ts";
import { addEvent, editEvent, reviewDay, voidEvent } from "../src/pay/corrections.ts";
import { addAdjustment, lockMonth, recalcMonth, unlockMonth } from "../src/pay/months.ts";
import { recalcDay } from "../src/pay/recalc.ts";
import { copyPreviousMonth, getSchedule, putDay, putWeek } from "../src/schedule/service.ts";
import type { Actor } from "../src/auth/permissions.ts";
import type { Branch } from "../src/generated/prisma/client.ts";
import { createTestDb } from "./helpers/db.ts";
import { makeAdmin, makeOwner, makeWorker, OFFICE } from "./helpers/fixtures.ts";

let owner: Actor;
let branch: Branch;
const TZ = "Asia/Tashkent";
const now = new Date("2026-04-30T15:00:00Z"); // everything in March is in the past

async function event(userId: number, b: Branch, date: string, type: "CHECK_IN" | "BREAK_START" | "BREAK_END" | "CHECK_OUT", hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return db().attendanceEvent.create({
    data: {
      companyId: b.companyId,
      userId,
      branchId: b.id,
      localDate: date,
      type,
      serverTime: localToUtc(date, h * 60 + m, TZ),
      status: "ACCEPTED",
      idempotencyKey: `seed-${userId}-${date}-${type}-${hhmm}-${Math.random()}`,
    },
  });
}

beforeAll(async () => {
  await createTestDb();
  owner = await makeOwner();
  branch = await createBranch(owner, { name: "Pay branch", ...OFFICE });
});

describe("daily amounts", () => {
  it("grid shows working days, defaults and missing cells; bulk fill and single cells", async () => {
    const { user } = await makeWorker(branch.id, "Grid A", null);
    const { user: u2 } = await makeWorker(branch.id, "Grid B", 50000);
    let grid = await amountGrid(owner, branch.id, "2026-05");
    const row = grid.workers.find((w) => w.userId === user.id)!;
    expect(row.cells.find((c) => c.date === "2026-05-03")?.working).toBe(false); // Sunday
    expect(row.cells.find((c) => c.date === "2026-05-04")?.effective).toBeNull();
    expect(grid.workers.find((w) => w.userId === u2.id)!.cells.find((c) => c.date === "2026-05-04")?.effective).toBe(50000);
    expect(grid.missing).toBeGreaterThan(20);

    const { filled } = await bulkFill(owner, branch.id, "2026-05", [user.id], 100000);
    expect(filled).toBe(26); // May 2026 has 26 Mon-Sat days
    await setAmounts(owner, branch.id, [{ userId: user.id, date: "2026-05-04", amount: 120000 }]);
    grid = await amountGrid(owner, branch.id, "2026-05");
    expect(grid.workers.find((w) => w.userId === user.id)!.cells.find((c) => c.date === "2026-05-04")?.amount).toBe(120000);
    expect(grid.missing).toBe(0);
  });

  it("an admin of another branch cannot touch amounts", async () => {
    const otherBranch = await createBranch(owner, { name: "Other pay", ...OFFICE });
    const admin = await makeAdmin([otherBranch.id]);
    await expect(amountGrid(admin, branch.id, "2026-05")).rejects.toThrow("forbidden");
  });
});

describe("pay end to end", () => {
  it("example A from events: in 09:30, out 18:30, 100 USD -> 90.00", async () => {
    const { user } = await makeWorker(branch.id, "Example A", 10000);
    await event(user.id, branch, "2026-03-02", "CHECK_IN", "09:30");
    await event(user.id, branch, "2026-03-02", "CHECK_OUT", "18:30");
    const r = await recalcDay(db(), user.id, "2026-03-02", now);
    expect(r).toMatchObject({ workedMin: 540, earned: 9000, lateMin: 30, earlyMin: 30, status: "LATE" });
  });

  it("a working day with no events becomes absent", async () => {
    const { user } = await makeWorker(branch.id, "Absent", 10000);
    await db().branchMember.updateMany({ where: { userId: user.id }, data: { joinedAt: new Date("2026-01-01") } });
    const r = await recalcDay(db(), user.id, "2026-03-03", now);
    expect(r).toMatchObject({ status: "ABSENT", earned: 0 });
  });

  it("days before the worker joined are not absences", async () => {
    const { user } = await makeWorker(branch.id, "New", 10000);
    expect(await recalcDay(db(), user.id, "2026-03-03", now)).toBeNull();
  });
});

describe("schedule changes recalculate", () => {
  it("a holiday override turns an absence into a day off; a personal week overrides the branch week", async () => {
    const b = await createBranch(owner, { name: "Sched", ...OFFICE });
    const { user } = await makeWorker(b.id, "Sched worker", 10000);
    await db().branchMember.updateMany({ where: { userId: user.id }, data: { joinedAt: new Date("2026-01-01") } });
    expect((await recalcDay(db(), user.id, "2026-03-09", now))?.status).toBe("ABSENT");
    await putDay(owner, b.id, null, "2026-03-09", { holiday: true, note: "Bayram" });
    expect((await db().dailyResult.findUnique({ where: { userId_date: { userId: user.id, date: "2026-03-09" } } }))?.status).toBe("DAY_OFF");

    const week = Array.from({ length: 7 }, (_, i) => (i < 5 ? { startMin: 600, endMin: 1080 } : { dayOff: true }));
    await putWeek(owner, b.id, user.id, week);
    const s = await getSchedule(owner, b.id, "2026-03", user.id);
    expect(s.ownWeek).toBe(true);
    expect(s.days.find((d) => d.date === "2026-03-10")).toMatchObject({ startMin: 600, endMin: 1080 });
    expect(s.days.find((d) => d.date === "2026-03-14")?.dayOff).toBe(true); // Saturday off for this worker
    expect(s.days.find((d) => d.date === "2026-03-09")?.holiday).toBe(true); // branch holiday still applies
  });

  it("copies single-day changes from the previous month", async () => {
    const b = await createBranch(owner, { name: "Copy", ...OFFICE });
    await putDay(owner, b.id, null, "2026-03-08", { holiday: true });
    await putDay(owner, b.id, null, "2026-03-21", { startMin: 540, endMin: 780 });
    await copyPreviousMonth(owner, b.id, null, "2026-04");
    const s = await getSchedule(owner, b.id, "2026-04", null);
    expect(s.days.find((d) => d.date === "2026-04-08")?.holiday).toBe(true);
    expect(s.days.find((d) => d.date === "2026-04-21")).toMatchObject({ startMin: 540, endMin: 780, overridden: true });
  });

  it("rejects night shifts and bad times", async () => {
    await expect(putDay(owner, branch.id, null, "2026-03-05", { startMin: 1200, endMin: 360 })).rejects.toThrow("bad_schedule");
    await expect(putDay(owner, branch.id, null, "2026-03-05", { startMin: -5, endMin: 360 })).rejects.toThrow("bad_time");
  });
});

describe("corrections and audit", () => {
  it("needs a comment; edits, adds and voids are audited and recalculated", async () => {
    const { user } = await makeWorker(branch.id, "Corrected", 10000);
    const date = "2026-03-04";
    const inEv = await event(user.id, branch, date, "CHECK_IN", "09:30");
    await recalcDay(db(), user.id, date, now);

    await expect(editEvent(owner, inEv.id, { time: "09:00", comment: "" })).rejects.toThrow("comment_required");
    let r = await editEvent(owner, inEv.id, { time: "09:00", comment: "GPS failed, I saw him" });
    expect(r?.lateMin).toBe(0);

    r = await addEvent(owner, { userId: user.id, date, type: "CHECK_OUT", time: "19:00", branchId: branch.id, comment: "Forgot to check out" });
    expect(r).toMatchObject({ earned: 10000, autoClosed: false });
    expect(r?.flags).toContain("corrected");

    await expect(
      addEvent(owner, { userId: user.id, date, type: "CHECK_IN", time: "10:00", branchId: branch.id, comment: "duplicate" }),
    ).rejects.toThrow("sequence");

    const outEv = await db().attendanceEvent.findFirstOrThrow({ where: { userId: user.id, type: "CHECK_OUT" } });
    r = await voidEvent(owner, outEv.id, { comment: "Wrong entry" });
    expect(r?.autoClosed).toBe(true);

    const log = await db().auditLog.findMany({ where: { entity: "day", entityId: `${user.id}:${date}` }, orderBy: { id: "asc" } });
    expect(log.map((l) => l.action)).toEqual(["event.edit", "event.add", "event.void"]);
    expect(log[0].comment).toBe("GPS failed, I saw him");
    expect(log[0].before).toBeTruthy();
    expect(log[0].after).toBeTruthy();
  });

  it("day review can set the earned amount by hand", async () => {
    const { user } = await makeWorker(branch.id, "Manual", 10000);
    await event(user.id, branch, "2026-03-05", "CHECK_IN", "09:00");
    await recalcDay(db(), user.id, "2026-03-05", now);
    const r = await reviewDay(owner, user.id, "2026-03-05", { comment: "Paid full day", manualEarned: 8000 });
    expect(r.manualEarned).toBe(8000);
    expect(r.reviewedAt).not.toBeNull();
  });
});

describe("month lock", () => {
  it("a locked month cannot be changed; only the owner unlocks, with an audit entry", async () => {
    const { user } = await makeWorker(branch.id, "Locked", 10000);
    const date = "2026-02-02";
    const ev = await event(user.id, branch, date, "CHECK_IN", "09:00");
    await recalcDay(db(), user.id, date, now);
    const admin = await makeAdmin([branch.id]);
    await lockMonth(admin, "2026-02");

    await expect(editEvent(owner, ev.id, { time: "08:00", comment: "try" })).rejects.toThrow("month_locked");
    await expect(setAmounts(owner, branch.id, [{ userId: user.id, date, amount: 1 }])).rejects.toThrow("month_locked");
    await expect(addAdjustment(owner, { userId: user.id, month: "2026-02", kind: "BONUS", amount: 100, comment: "x1" })).rejects.toThrow("month_locked");
    await expect(putDay(owner, branch.id, null, date, { holiday: true })).rejects.toThrow("month_locked");
    await expect(recalcMonth(owner, "2026-02")).rejects.toThrow("month_locked");
    // Recalculation silently keeps the locked numbers.
    const before = await db().dailyResult.findUniqueOrThrow({ where: { userId_date: { userId: user.id, date } } });
    await db().branch.update({ where: { id: branch.id }, data: { graceMin: 99 } });
    expect((await recalcDay(db(), user.id, date, now))?.updatedAt).toEqual(before.updatedAt);
    await db().branch.update({ where: { id: branch.id }, data: { graceMin: 0 } });

    await expect(unlockMonth(admin, "2026-02", "please")).rejects.toThrow("forbidden");
    await expect(unlockMonth(owner, "2026-02", "")).rejects.toThrow("comment_required");
    await unlockMonth(owner, "2026-02", "Fix a mistake");
    const log = await db().auditLog.findFirst({ where: { action: "month.unlock", entityId: "2026-02" } });
    expect(log?.comment).toBe("Fix a mistake");
  });
});
