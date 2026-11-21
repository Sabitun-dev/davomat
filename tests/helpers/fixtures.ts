// Small builders for integration tests.

import { signInitData } from "../../src/auth/initData.ts";
import type { Actor } from "../../src/auth/permissions.ts";
import { db } from "../../src/lib/db.ts";
import { loadActor } from "../../src/users/service.ts";
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

export async function makeCompany(name = "Test company", data: { active?: boolean; paidUntil?: string | null; maxWorkers?: number | null } = {}) {
  return db().company.create({ data: { name, ...data } });
}

/** The first company of the test database (made on first use). Tests that need two companies use makeCompany. */
export async function firstCompany() {
  return (await db().company.findFirst({ orderBy: { id: "asc" } })) ?? makeCompany();
}

export async function makeOwner(companyId?: number): Promise<Actor> {
  const id = companyId ?? (await firstCompany()).id;
  const user = await makeUser("Owner");
  await db().membership.create({ data: { userId: user.id, companyId: id, role: "OWNER" } });
  return loadActor(user);
}

/** An admin of the given branches (their company), or of the first company when no branch is given. */
export async function makeAdmin(branchIds: number[], companyId?: number): Promise<Actor> {
  const branch = branchIds.length ? await db().branch.findUniqueOrThrow({ where: { id: branchIds[0] } }) : null;
  const id = companyId ?? branch?.companyId ?? (await firstCompany()).id;
  const user = await makeUser("Admin");
  await db().membership.create({ data: { userId: user.id, companyId: id, role: "ADMIN" } });
  for (const branchId of branchIds) await db().adminBranch.create({ data: { userId: user.id, branchId } });
  return loadActor(user);
}

/** A worker of a branch (and a WORKER member of that branch's company). */
export async function makeWorker(branchId: number, name = "Worker", defaultDailyAmount: number | null = null) {
  const branch = await db().branch.findUniqueOrThrow({ where: { id: branchId } });
  const user = await makeUser(name);
  await db().membership.create({ data: { userId: user.id, companyId: branch.companyId, role: "WORKER" } });
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
