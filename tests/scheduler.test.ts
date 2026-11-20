import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { recordAttempt } from "../src/attendance/service.ts";
import { staticToken } from "../src/attendance/qr.ts";
import { createBranch } from "../src/branches/service.ts";
import { runScheduler } from "../src/jobs/scheduler.ts";
import { db } from "../src/lib/db.ts";
import { localToUtc } from "../src/shared/time.ts";
import { onGroupVideoNote } from "../src/video/service.ts";
import type { Actor } from "../src/auth/permissions.ts";
import type { Branch, User } from "../src/generated/prisma/client.ts";
import { createTestDb, sent } from "./helpers/db.ts";
import { makeOwner, makeWorker, OFFICE } from "./helpers/fixtures.ts";

const SECRET = "test-qr-secret-0123456789-0123456789-abcdef";
const TZ = "Asia/Tashkent";
const DAY = "2026-03-02"; // Monday
const at = (hhmm: string, date = DAY) => {
  const [h, m] = hhmm.split(":").map(Number);
  return localToUtc(date, h * 60 + m, TZ);
};

let owner: Actor;
let n = 0;

async function freshBranch(name: string): Promise<Branch> {
  return createBranch(owner, { name, ...OFFICE });
}

function checkIn(user: User, b: Branch, when: Date, type: "CHECK_IN" | "BREAK_START" | "CHECK_OUT" = "CHECK_IN") {
  return recordAttempt(
    user,
    b.companyId,
    { eventType: type, qrToken: staticToken(SECRET, b.id, b.qrVersion), lat: OFFICE.lat, lng: OFFICE.lng + 0.000001 * ++n, accuracy: 10, idempotencyKey: `sched-${++n}-key`, deviceId: null },
    { now: when },
  );
}

beforeAll(async () => {
  await createTestDb();
  owner = await makeOwner();
});
beforeEach(() => {
  sent.length = 0;
});

describe("scheduler", () => {
  it("auto-closes a day with no check-out at end + 2 h and flags it (example H)", async () => {
    const b = await freshBranch("Auto close");
    const { user } = await makeWorker(b.id, "Forgetful", 10000);
    await checkIn(user, b, at("09:00"));
    await runScheduler(at("20:59"));
    expect(await db().attendanceEvent.count({ where: { userId: user.id, source: "AUTO" } })).toBe(0);
    await runScheduler(at("21:00"));
    await runScheduler(at("21:15")); // running twice changes nothing
    const autos = await db().attendanceEvent.findMany({ where: { userId: user.id, source: "AUTO" } });
    expect(autos).toHaveLength(1);
    expect(autos[0].serverTime.toISOString()).toBe(at("19:00").toISOString());
    const r = await db().dailyResult.findUniqueOrThrow({ where: { userId_date: { userId: user.id, date: DAY } } });
    expect(r).toMatchObject({ autoClosed: true, earned: 10000, needsReview: true });
    expect(r.flags).toContain("no_checkout");
  });

  it("an open break is ended too", async () => {
    const b = await freshBranch("Break close");
    const { user } = await makeWorker(b.id, "On break", 10000);
    await checkIn(user, b, at("09:00"));
    await checkIn(user, b, at("18:00"), "BREAK_START");
    await runScheduler(at("21:05"));
    const autos = await db().attendanceEvent.findMany({ where: { userId: user.id, source: "AUTO" }, orderBy: { id: "asc" } });
    expect(autos.map((e) => e.type)).toEqual(["BREAK_END", "CHECK_OUT"]);
  });

  it("marks absence after the day and reminds only once", async () => {
    const b = await freshBranch("Absent branch");
    const { user } = await makeWorker(b.id, "Sleepy", 10000);
    await db().branchMember.updateMany({ where: { userId: user.id }, data: { joinedAt: new Date("2026-01-01") } });
    await runScheduler(at("09:05"));
    expect(sent.filter((s) => s.chatId === Number(user.telegramId))).toHaveLength(0);
    await runScheduler(at("09:10"));
    await runScheduler(at("09:25"));
    const reminders = sent.filter((s) => s.chatId === Number(user.telegramId));
    expect(reminders).toHaveLength(1);
    expect(reminders[0].text).toContain("Keldim");

    await runScheduler(at("19:05"));
    const r = await db().dailyResult.findUniqueOrThrow({ where: { userId_date: { userId: user.id, date: DAY } } });
    expect(r).toMatchObject({ status: "ABSENT", earned: 0 });
  });

  it("sends the morning summary to the owner once", async () => {
    const b = await freshBranch("Morning");
    const { user } = await makeWorker(b.id, "Late one", 10000);
    await checkIn(user, b, at("09:12"));
    await runScheduler(at("09:20"));
    await runScheduler(at("09:35"));
    const toOwner = sent.filter((s) => s.chatId === Number(owner.telegramId) && s.text?.includes("Morning"));
    expect(toOwner).toHaveLength(1);
    expect(toOwner[0].text).toContain("Late one (09:12)");
  });

  it("flags a scan without a video and a video without a scan", async () => {
    const b = await freshBranch("Video flags");
    const { user } = await makeWorker(b.id, "No video", 10000);
    await checkIn(user, b, at("09:00"));
    const { user: u2 } = await makeWorker(b.id, "Only video", 10000);
    await db().branchMember.updateMany({ where: { userId: u2.id }, data: { joinedAt: new Date("2026-01-01") } });
    await onGroupVideoNote({ chatId: -1001n, messageId: 555, fromTelegramId: u2.telegramId, sentAt: at("09:00") });
    await runScheduler(at("09:30"));
    const r1 = await db().dailyResult.findUniqueOrThrow({ where: { userId_date: { userId: user.id, date: DAY } } });
    expect(r1.flags).toContain("no_video");
    expect(r1.needsReview).toBe(true);
    const r2 = await db().dailyResult.findUniqueOrThrow({ where: { userId_date: { userId: u2.id, date: DAY } } });
    expect(r2.flags).toContain("video_without_scan");
  });

  it("replies under the group video when the setting is on", async () => {
    await db().company.updateMany({ data: { settings: { botReplyUnderVideo: true } } });
    const b = await freshBranch("Filial X");
    const { user } = await makeWorker(b.id, "Replied", 10000);
    await onGroupVideoNote({ chatId: -1009n, messageId: 77, threadId: 5, fromTelegramId: user.telegramId, sentAt: at("09:05") });
    await checkIn(user, b, at("09:07"));
    const reply = sent.find((s) => s.replyTo === 77);
    expect(reply?.threadId).toBe(5);
    expect(reply?.text).toMatch(/✅ Keldi 09:07 · Filial X · \d+ m · 7 daq kechikdi/);
    await db().company.updateMany({ data: { settings: {} } });
  });

  it("removes raw GPS older than 12 months", async () => {
    const b = await freshBranch("Old GPS");
    const { user } = await makeWorker(b.id, "Old", 10000);
    await checkIn(user, b, at("09:00", "2024-03-04"));
    await runScheduler(at("10:00", "2026-03-03"));
    const e = await db().attendanceEvent.findFirstOrThrow({ where: { userId: user.id } });
    expect(e.lat).toBeNull();
    expect(e.distanceM).not.toBeNull();
  });
});
