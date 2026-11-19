import { beforeAll, describe, expect, it } from "vitest";
import { signInitData } from "../src/auth/initData.ts";
import { app } from "../src/api/app.ts";
import { loadActor, normalizePhone, savePhoneFromContact, upsertTelegramUser } from "../src/users/service.ts";
import { createTestDb, TEST_BOT_TOKEN } from "./helpers/db.ts";
import type { PrismaClient } from "../src/generated/prisma/client.ts";

let prisma: PrismaClient;

function auth(userId: number, extra: Record<string, string> = {}) {
  const initData = signInitData(
    {
      user: JSON.stringify({ id: userId, first_name: "Test", language_code: "uz" }),
      auth_date: String(Math.floor(Date.now() / 1000)),
      ...extra,
    },
    TEST_BOT_TOKEN,
  );
  return { authorization: `tma ${initData}`, "content-type": "application/json" };
}

beforeAll(async () => {
  prisma = await createTestDb();
});

describe("users and first-open flow", () => {
  it("normalizes phone numbers", () => {
    expect(normalizePhone("+998 90 123-45-67")).toBe("+998901234567");
    expect(normalizePhone("79161234567")).toBe("+79161234567");
    expect(normalizePhone("123")).toBeNull();
  });

  it("makes owners from OWNER_TELEGRAM_IDS", async () => {
    const user = await upsertTelegramUser({ id: 1000, first_name: "Boss" });
    const actor = await loadActor(user);
    expect(actor.role).toBe("OWNER");
  });

  it("a new user has no role", async () => {
    const user = await upsertTelegramUser({ id: 2000, first_name: "New" });
    expect((await loadActor(user)).role).toBe("NONE");
  });

  it("accepts a phone only from the sender's own contact", async () => {
    expect(await savePhoneFromContact({ fromId: 2000, contactUserId: 3000, phone: "+998901112233" })).toBe(false);
    expect(await savePhoneFromContact({ fromId: 2000, contactUserId: undefined, phone: "+998901112233" })).toBe(false);
    expect(await savePhoneFromContact({ fromId: 2000, contactUserId: 2000, phone: "998901112233" })).toBe(true);
    const u = await prisma.user.findUniqueOrThrow({ where: { telegramId: 2000n } });
    expect(u.phone).toBe("+998901112233");
  });

  it("API rejects requests without valid initData", async () => {
    const res = await app.request("/api/me");
    expect(res.status).toBe(401);
    const bad = await app.request("/api/me", { headers: { authorization: "tma user=1&hash=00" } });
    expect(bad.status).toBe(401);
  });

  it("API runs consent and name steps", async () => {
    let res = await app.request("/api/me", { headers: auth(2000, { start_param: "inv_x" }) });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let me: any = await res.json();
    expect(me.needs).toEqual({ consent: true, phone: false, name: true });
    expect(me.startParam).toBe("inv_x");

    res = await app.request("/api/me", { method: "POST", headers: auth(2000), body: JSON.stringify({ consent: true }) });
    me = await res.json();
    expect(me.needs.consent).toBe(false);

    res = await app.request("/api/me", { method: "POST", headers: auth(2000), body: JSON.stringify({ fullName: " " }) });
    expect(res.status).toBe(400);

    res = await app.request("/api/me", {
      method: "POST",
      headers: auth(2000),
      body: JSON.stringify({ fullName: "  Ali   Valiyev " }),
    });
    me = await res.json();
    expect(me.user.fullName).toBe("Ali Valiyev");
    expect(me.needs.name).toBe(false);
  });
});
