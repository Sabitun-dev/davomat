// Small builders for integration tests.

import { signInitData } from "../../src/auth/initData.ts";
import type { Actor } from "../../src/auth/permissions.ts";
import { db } from "../../src/lib/db.ts";
import { ensureCompany, loadActor } from "../../src/users/service.ts";
import { TEST_BOT_TOKEN } from "./db.ts";

let nextTelegramId = 50_000;

/** A user who finished the first-open steps. */
export async function makeUser(name = "Test User", telegramId = nextTelegramId++) {
  return db().user.create({
    data: {
      telegramId: BigInt(telegramId),
      firstName: name.split(" ")[0],
      fullName: name,
      phone: `+99890${String(telegramId).padStart(7, "0")}`,
      consentAt: new Date(),
      nameConfirmedAt: new Date(),
    },
  });
}

export async function makeOwner(): Promise<Actor> {
  const company = await ensureCompany();
  const user = await makeUser("Owner");
  await db().membership.create({ data: { userId: user.id, companyId: company.id, role: "OWNER" } });
  return loadActor(user);
}

export async function makeAdmin(branchIds: number[]): Promise<Actor> {
  const company = await ensureCompany();
  const user = await makeUser("Admin");
  await db().membership.create({ data: { userId: user.id, companyId: company.id, role: "ADMIN" } });
  for (const branchId of branchIds) await db().adminBranch.create({ data: { userId: user.id, branchId } });
  return loadActor(user);
}

export async function makeWorker(branchId: number, name = "Worker", defaultDailyAmount: number | null = null) {
  const company = await ensureCompany();
  const user = await makeUser(name);
  await db().membership.create({ data: { userId: user.id, companyId: company.id, role: "WORKER" } });
  await db().branchMember.create({ data: { userId: user.id, branchId, defaultDailyAmount } });
  return { user, actor: await loadActor(user) };
}

export async function actorOf(userId: number): Promise<Actor> {
  return loadActor(await db().user.findUniqueOrThrow({ where: { id: userId } }));
}

export function authHeaders(telegramId: bigint | number, extra: Record<string, string> = {}) {
  const initData = signInitData(
    {
      user: JSON.stringify({ id: Number(telegramId), first_name: "Test" }),
      auth_date: String(Math.floor(Date.now() / 1000)),
      ...extra,
    },
    TEST_BOT_TOKEN,
  );
  return { authorization: `tma ${initData}`, "content-type": "application/json" };
}

/** Tashkent office used across tests. */
export const OFFICE = { lat: 41.311081, lng: 69.240562 };
