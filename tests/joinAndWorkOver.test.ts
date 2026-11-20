import { beforeAll, describe, expect, it } from "vitest";
import { recordAttempt } from "../src/attendance/service.ts";
import { staticToken } from "../src/attendance/qr.ts";
import { createBranch } from "../src/branches/service.ts";
import { acceptInviteCode, createInvite, CODE_ATTEMPTS } from "../src/invites/service.ts";
import { computeDay } from "../src/pay/engine.ts";
import { db } from "../src/lib/db.ts";
import { localToUtc } from "../src/shared/time.ts";
import { loadActor } from "../src/users/service.ts";
import type { Actor } from "../src/auth/permissions.ts";
import type { Branch, User } from "../src/generated/prisma/client.ts";
import { createTestDb } from "./helpers/db.ts";
import { makeOwner, makeUser, makeWorker, OFFICE } from "./helpers/fixtures.ts";

const SECRET = "test-qr-secret-0123456789-0123456789-abcdef";
const DAY = "2026-03-02"; // Monday, 09:00-19:00 by default
const at = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return localToUtc(DAY, h * 60 + m, "Asia/Tashkent");
};
let owner: Actor;
let n = 0;

function scan(user: User, b: Branch, type: "CHECK_IN" | "CHECK_OUT", when: Date, workOver = false) {
  return recordAttempt(
    user,
    b.companyId,
    { eventType: type, qrToken: staticToken(SECRET, b.id, b.qrVersion), lat: OFFICE.lat, lng: OFFICE.lng + 0.000001 * ++n, accuracy: 10, idempotencyKey: `wo-${++n}-key`, deviceId: null, workOver },
    { now: when },
  );
}

async function day(userId: number) {
  return db().dailyResult.findUniqueOrThrow({ where: { userId_date: { userId, date: DAY } } });
}

beforeAll(async () => {
  await createTestDb();
  owner = await makeOwner();
});

describe("joining with a short code", () => {
  it("a new worker types the code and joins the branch", async () => {
    const b = await createBranch(owner, { name: "Code branch", ...OFFICE });
    const inv = await createInvite(owner, b.id, { singleUse: false });
    const u = await makeUser("Coder");
    await acceptInviteCode(`  ${inv.code!.toLowerCase().slice(0, 3)} ${inv.code!.slice(3)} `, u.id);
    expect((await loadActor(u)).memberBranchIds).toEqual([b.id]);
  });

  it("wrong codes are refused, and guessing is stopped after 10 tries in 10 minutes", async () => {
    const u = await makeUser("Guesser");
    for (let i = 0; i < CODE_ATTEMPTS; i++) await expect(acceptInviteCode("ZZZZZZ", u.id)).rejects.toThrow("invite_code_wrong");
    const b = await createBranch(owner, { name: "Locked out", ...OFFICE });
    const inv = await createInvite(owner, b.id, {});
    await expect(acceptInviteCode(inv.code, u.id)).rejects.toThrow("rate_limited");
  });
});

describe("Ish tugadi (work is over)", () => {
  it("engine: a forgiven early leave is paid as a full day", () => {
    const base = {
      schedule: { startMin: 540, endMin: 1140 },
      graceMin: 0,
      graceMode: "FULL" as const,
      breakAllowanceMin: 60,
      amount: 10000,
      events: [{ type: "CHECK_IN" as const, minute: 540 }, { type: "CHECK_OUT" as const, minute: 1050 }],
      nowMinute: null,
      autoCloseAfterMin: 120,
    };
    expect(computeDay(base)).toMatchObject({ earlyMin: 90, earned: 8500 });
    expect(computeDay({ ...base, earlyLeaveForgiven: true })).toMatchObject({ earlyMin: 0, earned: 10000 });
  });

  it("50% of the workers present tick it at 17:30 -> they are paid as if they left at 19:00", async () => {
    const b = await createBranch(owner, { name: "Quiet day", ...OFFICE });
    const workers = await Promise.all([1, 2, 3, 4].map((i) => makeWorker(b.id, `W${i}`, 10000)));
    for (const { user } of workers) await scan(user, b, "CHECK_IN", at("09:00"));

    const first = await scan(workers[0].user, b, "CHECK_OUT", at("17:30"), true);
    expect(first.workOver).toMatchObject({ present: 4, ticked: 1, needed: 2, forgiven: false, counted: true });
    expect(await day(workers[0].user.id)).toMatchObject({ earlyMin: 90, earned: 8500 });

    const second = await scan(workers[1].user, b, "CHECK_OUT", at("17:32"), true);
    expect(second.workOver).toMatchObject({ ticked: 2, forgiven: true });
    // Both who ticked are now paid in full, the first one recalculated too.
    expect(await day(workers[0].user.id)).toMatchObject({ earlyMin: 0, earned: 10000 });
    expect(await day(workers[1].user.id)).toMatchObject({ earlyMin: 0, earned: 10000 });
    expect((await day(workers[1].user.id)).flags).toContain("work_over");

    // Leaving early without the tick is still deducted.
    await scan(workers[2].user, b, "CHECK_OUT", at("17:40"));
    expect(await day(workers[2].user.id)).toMatchObject({ earlyMin: 80 });
  });

  it("a tick earlier than 2 hours before the end does not count", async () => {
    const b = await createBranch(owner, { name: "Too early tick", ...OFFICE });
    const { user } = await makeWorker(b.id, "Solo", 10000);
    await scan(user, b, "CHECK_IN", at("09:00"));
    const r = await scan(user, b, "CHECK_OUT", at("15:00"), true);
    expect(r.workOver).toMatchObject({ counted: false, ticked: 0 });
    expect(await day(user.id)).toMatchObject({ earlyMin: 240 });
  });

  it("can be switched off", async () => {
    await db().company.updateMany({ data: { settings: { collectiveFinishEnabled: false } } });
    const b = await createBranch(owner, { name: "Off", ...OFFICE });
    const { user } = await makeWorker(b.id, "Alone", 10000);
    await scan(user, b, "CHECK_IN", at("09:00"));
    await scan(user, b, "CHECK_OUT", at("18:00"), true);
    expect(await day(user.id)).toMatchObject({ earlyMin: 60 });
    await db().company.updateMany({ data: { settings: {} } });
  });
});
