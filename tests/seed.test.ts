import { beforeAll, describe, expect, it } from "vitest";
import { seedDemo } from "../prisma/seed.ts";
import { db } from "../src/lib/db.ts";
import { createTestDb } from "./helpers/db.ts";

beforeAll(async () => {
  await createTestDb();
});

describe("demo seed", () => {
  it("fills an empty database and refuses a second run", async () => {
    await seedDemo();
    expect(await db().branch.count()).toBe(2);
    expect(await db().branchMember.count()).toBe(5);
    expect(await db().dailyResult.count()).toBeGreaterThan(40);
    await expect(seedDemo()).rejects.toThrow("not empty");
  });
});
