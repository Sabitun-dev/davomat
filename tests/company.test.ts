import { beforeAll, describe, expect, it } from "vitest";
import { createBranch } from "../src/branches/service.ts";
import { getCompany, updateCompany } from "../src/users/company.ts";
import { db } from "../src/lib/db.ts";
import type { Actor } from "../src/auth/permissions.ts";
import { createTestDb } from "./helpers/db.ts";
import { makeAdmin, makeOwner, makeWorker, OFFICE } from "./helpers/fixtures.ts";

let owner: Actor;

beforeAll(async () => {
  await createTestDb();
  owner = await makeOwner();
});

describe("company currency", () => {
  it("can be changed while no money is stored yet", async () => {
    expect((await getCompany(owner)).currencyLocked).toBe(false);
    const c = await updateCompany(owner, { currency: "USD" });
    expect(c.currency).toBe("USD");
    await updateCompany(owner, { currency: "UZS" });
  });

  it("is locked once a daily amount exists; other settings still save", async () => {
    const b = await createBranch(owner, { name: "Money", ...OFFICE });
    const { user } = await makeWorker(b.id, "Paid");
    await db().dailyAmount.create({ data: { userId: user.id, branchId: b.id, date: "2026-03-02", amount: 250000 } });
    expect((await getCompany(owner)).currencyLocked).toBe(true);
    await expect(updateCompany(owner, { currency: "USD" })).rejects.toThrow("currency_locked");
    // Sending the same currency again (the settings form always sends it) is fine.
    const c = await updateCompany(owner, { currency: "UZS", name: "Renamed", settings: { overtimeEnabled: false } });
    expect(c).toMatchObject({ name: "Renamed", currency: "UZS", settings: { overtimeEnabled: false } });
  });

  it("only the owner may edit the company", async () => {
    const admin = await makeAdmin([]);
    await expect(updateCompany(admin, { name: "X" })).rejects.toThrow("forbidden");
  });
});
