import { beforeAll, describe, expect, it } from "vitest";
import { recordAttempt, type AttemptInput } from "../src/attendance/service.ts";
import { rotatingToken, staticToken } from "../src/attendance/qr.ts";
import { createBranch, regenerateQr, updateBranch } from "../src/branches/service.ts";
import { db } from "../src/lib/db.ts";
import { onGroupVideoNote } from "../src/video/service.ts";
import { workerToday } from "../src/reports/worker.ts";
import type { Actor } from "../src/auth/permissions.ts";
import type { Branch, User } from "../src/generated/prisma/client.ts";
import { createTestDb } from "./helpers/db.ts";
import { makeOwner, makeWorker, OFFICE } from "./helpers/fixtures.ts";

const SECRET = "test-qr-secret-0123456789-0123456789-abcdef";
// Monday 2 March 2026 in Tashkent (UTC+5): 09:00 local = 04:00Z.
const at = (hhmm: string, date = "2026-03-02") => {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(`${date}T${String(h - 5).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`);
};
const north = (m: number) => OFFICE.lat + m / 111195;

let owner: Actor;
let branch: Branch;
let other: Branch;
let keyN = 0;

function attempt(user: User, type: AttemptInput["eventType"], when: Date, extra: Partial<AttemptInput> = {}, b = branch) {
  return recordAttempt(
    user,
    b.companyId,
    {
      eventType: type,
      qrToken: `https://t.me/davomat_test_bot/app?startapp=${staticToken(SECRET, b.id, b.qrVersion)}`,
      lat: OFFICE.lat,
      lng: OFFICE.lng + 0.00001 * (keyN % 7),
      accuracy: 12,
      idempotencyKey: `test-key-${++keyN}`,
      deviceId: `device${String(keyN).padStart(8, "0")}`,
      ...extra,
    },
    { now: when, userAgent: "vitest" },
  );
}

beforeAll(async () => {
  await createTestDb();
  owner = await makeOwner();
  branch = await createBranch(owner, { name: "Main", ...OFFICE, radiusM: 25 });
  other = await createBranch(owner, { name: "Far branch", lat: OFFICE.lat + 0.1, lng: OFFICE.lng });
});

describe("check-in", () => {
  it("accepts inside the geofence and reports lateness", async () => {
    const { user } = await makeWorker(branch.id, "Late Ali", 10000);
    const r = await attempt(user, "CHECK_IN", at("09:07"), { lat: north(12), lng: OFFICE.lng });
    expect(r.ok).toBe(true);
    expect(r.distanceM).toBe(12);
    expect(r.localTime).toBe("09:07");
    expect(r.lateMin).toBe(7);
  });

  it("rejects outside the geofence with the distance, and logs it", async () => {
    const { user } = await makeWorker(branch.id, "Far");
    const r = await attempt(user, "CHECK_IN", at("09:00"), { lat: north(83), lng: OFFICE.lng });
    expect(r).toMatchObject({ ok: false, reason: "too_far", distanceM: 83, params: { distance: 83, radius: 25 } });
    const logged = await db().attendanceEvent.findFirst({ where: { userId: user.id, status: "REJECTED" } });
    expect(logged?.rejectReason).toBe("too_far");
    expect(logged?.lat).toBeCloseTo(north(83), 6);
  });

  it("rejects weak GPS and missing location", async () => {
    const { user } = await makeWorker(branch.id, "Weak");
    expect(await attempt(user, "CHECK_IN", at("09:00"), { accuracy: 70 })).toMatchObject({ reason: "weak_gps", params: { accuracy: 70 } });
    expect(await attempt(user, "CHECK_IN", at("09:00"), { lat: null, lng: null })).toMatchObject({ reason: "no_location" });
  });

  it("rejects a non-branch QR, another branch's QR and an old QR", async () => {
    const { user } = await makeWorker(branch.id, "Qr");
    expect(await attempt(user, "CHECK_IN", at("09:00"), { qrToken: "https://example.com" })).toMatchObject({ reason: "bad_qr" });
    const r = await attempt(user, "CHECK_IN", at("09:00"), {}, other);
    expect(r).toMatchObject({ reason: "other_branch", params: { branch: "Far branch" } });

    const b2 = await createBranch(owner, { name: "Regen", ...OFFICE });
    const { user: u2 } = await makeWorker(b2.id, "Regen worker");
    const oldToken = staticToken(SECRET, b2.id, b2.qrVersion);
    await regenerateQr(owner, b2.id);
    expect(await attempt(u2, "CHECK_IN", at("09:00"), { qrToken: oldToken }, b2)).toMatchObject({ reason: "old_qr" });
  });

  it("rotating mode needs the code from the screen", async () => {
    const b = await createBranch(owner, { name: "Rotating", ...OFFICE, qrMode: "ROTATING" });
    const { user } = await makeWorker(b.id, "Rot");
    const when = at("09:00");
    expect(await attempt(user, "CHECK_IN", when, {}, b)).toMatchObject({ reason: "qr_expired" });
    const fresh = rotatingToken(SECRET, b.id, 1, when.getTime() - 20_000);
    expect(await attempt(user, "CHECK_IN", when, { qrToken: fresh }, b)).toMatchObject({ ok: true });
  });

  it("too early: more than 3 hours before start", async () => {
    const { user } = await makeWorker(branch.id, "Early");
    expect(await attempt(user, "CHECK_IN", at("05:59"))).toMatchObject({ reason: "too_early", params: { time: "06:00" } });
    expect(await attempt(user, "CHECK_IN", at("06:00"))).toMatchObject({ ok: true });
  });
});

describe("sequence, idempotency, rate limit", () => {
  it("runs the full day and rejects invalid moves", async () => {
    const { user } = await makeWorker(branch.id, "Full day", 10000);
    expect((await attempt(user, "BREAK_START", at("08:55"))).reason).toBe("not_checked_in");
    expect((await attempt(user, "CHECK_OUT", at("08:56"))).reason).toBe("not_checked_in");
    expect((await attempt(user, "CHECK_IN", at("09:00"))).ok).toBe(true);
    expect(await attempt(user, "CHECK_IN", at("09:05"))).toMatchObject({ reason: "already_checked_in", params: { time: "09:00" } });
    expect((await attempt(user, "BREAK_END", at("12:00"))).reason).toBe("not_on_break");
    expect((await attempt(user, "BREAK_START", at("13:00"))).ok).toBe(true);
    expect((await attempt(user, "BREAK_START", at("13:01"))).reason).toBe("already_on_break");
    expect((await attempt(user, "BREAK_END", at("13:40"))).ok).toBe(true);
    expect((await attempt(user, "CHECK_OUT", at("19:00"))).ok).toBe(true);
    expect((await attempt(user, "BREAK_START", at("19:05"))).reason).toBe("already_finished");
    expect((await attempt(user, "CHECK_IN", at("19:06"))).reason).toBe("already_finished");
    const day = await db().dailyResult.findUniqueOrThrow({ where: { userId_date: { userId: user.id, date: "2026-03-02" } } });
    expect(day).toMatchObject({ status: "ON_TIME", breakMin: 40, overageMin: 0, workedMin: 600, earned: 10000 });
  });

  it("check-out during a break ends the break at the same time", async () => {
    const { user } = await makeWorker(branch.id, "Break out", 10000);
    await attempt(user, "CHECK_IN", at("09:00"));
    await attempt(user, "BREAK_START", at("17:30"));
    expect((await attempt(user, "CHECK_OUT", at("18:45"))).ok).toBe(true);
    const events = await db().attendanceEvent.findMany({ where: { userId: user.id, status: "ACCEPTED" }, orderBy: { id: "asc" } });
    expect(events.map((e) => `${e.type}:${e.source}`)).toEqual(["CHECK_IN:APP", "BREAK_START:APP", "BREAK_END:AUTO", "CHECK_OUT:APP"]);
    const day = await db().dailyResult.findUniqueOrThrow({ where: { userId_date: { userId: user.id, date: "2026-03-02" } } });
    expect(day).toMatchObject({ breakMin: 75, overageMin: 15, earlyMin: 15, workedMin: 570 });
  });

  it("check-out must be at the check-in branch", async () => {
    const b2 = await createBranch(owner, { name: "Second", ...OFFICE });
    const { user } = await makeWorker(branch.id, "Two branches");
    await db().branchMember.create({ data: { userId: user.id, branchId: b2.id } });
    await attempt(user, "CHECK_IN", at("09:00"));
    expect(await attempt(user, "CHECK_OUT", at("19:00"), {}, b2)).toMatchObject({ reason: "wrong_branch", params: { branch: "Main" } });
  });

  it("a double tap with the same key is stored once", async () => {
    const { user } = await makeWorker(branch.id, "Double");
    const input = { idempotencyKey: "same-key-123456" };
    const [a, b] = await Promise.all([attempt(user, "CHECK_IN", at("09:01"), input), attempt(user, "CHECK_IN", at("09:01"), input)]);
    expect(a.ok && b.ok).toBe(true);
    expect(await db().attendanceEvent.count({ where: { userId: user.id } })).toBe(1);
  });

  it("two different taps at once never make two check-ins", async () => {
    const { user } = await makeWorker(branch.id, "Race");
    const results = await Promise.all([attempt(user, "CHECK_IN", at("09:01")), attempt(user, "CHECK_IN", at("09:01"))]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)?.reason).toBe("already_checked_in");
  });

  it("rate limit: 10 attempts per 5 minutes", async () => {
    const { user } = await makeWorker(branch.id, "Spammer");
    for (let i = 0; i < 10; i++) await attempt(user, "CHECK_IN", new Date(), { accuracy: 99 });
    expect((await attempt(user, "CHECK_IN", new Date())).reason).toBe("rate_limited");
  });
});

describe("flags", () => {
  it("zero accuracy, edge after fails and shared device are flagged, never blocked", async () => {
    const { user } = await makeWorker(branch.id, "Suspicious");
    await attempt(user, "CHECK_IN", at("08:50"), { lat: north(60), lng: OFFICE.lng });
    await attempt(user, "CHECK_IN", at("08:52"), { lat: north(40), lng: OFFICE.lng });
    const r = await attempt(user, "CHECK_IN", at("08:55"), { lat: north(24), lng: OFFICE.lng, accuracy: 0, deviceId: "shareddevice1" });
    expect(r.ok).toBe(true);
    const e = await db().attendanceEvent.findFirstOrThrow({ where: { userId: user.id, status: "ACCEPTED" } });
    expect(e.flags).toEqual(expect.arrayContaining(["zero_accuracy", "edge_after_fails"]));

    const { user: friend } = await makeWorker(branch.id, "Friend");
    await attempt(friend, "CHECK_IN", at("08:58"), { deviceId: "shareddevice1" });
    const fe = await db().attendanceEvent.findFirstOrThrow({ where: { userId: friend.id, status: "ACCEPTED" } });
    expect(fe.flags).toContain("shared_device");
    const day = await db().dailyResult.findUniqueOrThrow({ where: { userId_date: { userId: friend.id, date: "2026-03-02" } } });
    expect(day.needsReview).toBe(true);
  });

  it("an impossible jump between branches is flagged", async () => {
    const { user } = await makeWorker(branch.id, "Jumper");
    await db().branchMember.create({ data: { userId: user.id, branchId: other.id } });
    await attempt(user, "CHECK_IN", at("08:58", "2026-03-03"), { lat: other.lat, lng: other.lng, accuracy: 70 }, other);
    const r = await attempt(user, "CHECK_IN", at("09:00", "2026-03-03"));
    expect(r.ok).toBe(true);
    const e = await db().attendanceEvent.findFirstOrThrow({ where: { userId: user.id, status: "ACCEPTED" } });
    expect(e.flags).toContain("impossible_jump");
  });
});

describe("group video link", () => {
  it("links a video sent before the event and one sent after", async () => {
    const { user } = await makeWorker(branch.id, "Video");
    // The company linked its group with /groupid.
    await db().company.update({ where: { id: branch.companyId }, data: { groupChatId: -1001234567890n, groupTitle: "Test group" } });
    await onGroupVideoNote({ companyId: branch.companyId, chatId: -1001234567890n, messageId: 11, fromTelegramId: user.telegramId, sentAt: at("08:50") });
    await attempt(user, "CHECK_IN", at("09:00"));
    await attempt(user, "BREAK_START", at("13:00"));
    const late = await onGroupVideoNote({ companyId: branch.companyId, chatId: -1001234567890n, messageId: 12, fromTelegramId: user.telegramId, sentAt: at("13:04") });
    expect(late?.linkedEvent?.type).toBe("BREAK_START");
    const videos = await db().videoNote.findMany({ where: { userTelegramId: user.telegramId }, orderBy: { messageId: "asc" } });
    expect(videos.every((v) => v.linkedEventId !== null)).toBe(true);
  });

  it("a video outside the window is not linked", async () => {
    const { user } = await makeWorker(branch.id, "Video 2");
    await onGroupVideoNote({ companyId: branch.companyId, chatId: -1001234567890n, messageId: 21, fromTelegramId: user.telegramId, sentAt: at("08:40") });
    await attempt(user, "CHECK_IN", at("09:00"));
    const v = await db().videoNote.findFirstOrThrow({ where: { messageId: 21 } });
    expect(v.linkedEventId).toBeNull();
  });
});

describe("worker today", () => {
  it("shows the state and only valid actions", async () => {
    const { user } = await makeWorker(branch.id, "Today");
    // Make "today" a working day for the whole day, whatever the real clock says.
    const today = new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);
    await db().scheduleOverride.create({ data: { branchId: branch.id, userId: user.id, date: today, startMin: 0, endMin: 1439 } });
    const before = await workerToday(user.id, [branch.id]);
    expect(before.actions).toEqual(["CHECK_IN"]);
    await updateBranch(owner, branch.id, { graceMin: 0 });
    await attempt(user, "CHECK_IN", new Date());
    const after = await workerToday(user.id, [branch.id]);
    expect(after.state).toBe("WORKING");
    expect(after.actions).toEqual(["BREAK_START", "CHECK_OUT"]);
  });
});
