import { unzipSync, strFromU8 } from "fflate";
import { beforeAll, describe, expect, it } from "vitest";
import { createBranch } from "../src/branches/service.ts";
import { db } from "../src/lib/db.ts";
import { localToUtc } from "../src/shared/time.ts";
import { addAdjustment } from "../src/pay/months.ts";
import { recalcUserDays } from "../src/pay/recalc.ts";
import { monthReport, monthTable, yearReport } from "../src/reports/admin.ts";
import { buildExport } from "../src/reports/exports.ts";
import type { Actor } from "../src/auth/permissions.ts";
import type { Branch } from "../src/generated/prisma/client.ts";
import { createTestDb } from "./helpers/db.ts";
import { makeAdmin, makeOwner, makeWorker, OFFICE } from "./helpers/fixtures.ts";

let owner: Actor;
let branch: Branch;
let userId: number;
const now = new Date("2026-04-30T15:00:00Z");

async function ev(uid: number, date: string, type: "CHECK_IN" | "CHECK_OUT", hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  await db().attendanceEvent.create({
    data: {
      companyId: branch.companyId, userId: uid, branchId: branch.id, localDate: date, type,
      serverTime: localToUtc(date, h * 60 + m, "Asia/Tashkent"), status: "ACCEPTED", idempotencyKey: `r-${uid}-${date}-${type}`,
    },
  });
}

beforeAll(async () => {
  await createTestDb();
  owner = await makeOwner();
  await db().company.updateMany({ data: { currency: "USD" } });
  branch = await createBranch(owner, { name: "Report branch", ...OFFICE });
  const { user } = await makeWorker(branch.id, "Ali", 10000);
  userId = user.id;
  await db().branchMember.updateMany({ where: { userId }, data: { joinedAt: new Date("2026-02-28") } });
  // March 2026 by hand: Mon 2 = example A (90.00); Tue 3 in 08:55 out 19:00 = 600 + 5 min overtime
  // = 100 x 605 / 600 = 100.83; every other working day absent.
  await ev(userId, "2026-03-02", "CHECK_IN", "09:30");
  await ev(userId, "2026-03-02", "CHECK_OUT", "18:30");
  await ev(userId, "2026-03-03", "CHECK_IN", "08:55");
  await ev(userId, "2026-03-03", "CHECK_OUT", "19:00");
  const dates = Array.from({ length: 31 }, (_, i) => `2026-03-${String(i + 1).padStart(2, "0")}`);
  await recalcUserDays(db(), userId, dates, now);
  await addAdjustment(owner, { userId, month: "2026-03", kind: "BONUS", amount: 2000, comment: "Good work" });
  await addAdjustment(owner, { userId, month: "2026-03", kind: "FINE", amount: 500, comment: "Uniform" });
});

describe("month report", () => {
  it("matches a hand calculation", async () => {
    const r = await monthReport(owner, "2026-03", branch.id);
    const row = r.rows.find((x) => x.userId === userId)!;
    // March 2026 has 26 Mon-Sat working days: 2 worked, 24 absent.
    expect(row).toMatchObject({
      daysWorked: 2,
      absent: 24,
      timesLate: 1,
      lateMin: 30,
      earlyMin: 30,
      overtimeMin: 5,
      workedMin: 540 + 605,
      earned: 9000 + 10083,
      max: 26 * 10000,
      bonus: 2000,
      fine: 500,
      salary: 19083 + 2000 - 500,
    });
    expect(r.company.punctuality).toBe(50);
    expect(r.ranking[0]).toMatchObject({ userId, lateMin: 30 });
  });

  it("admins of other branches see nothing of it", async () => {
    const other = await createBranch(owner, { name: "Elsewhere", ...OFFICE });
    const admin = await makeAdmin([other.id]);
    await expect(monthReport(admin, "2026-03", branch.id)).rejects.toThrow("forbidden");
    const r = await monthReport(admin, "2026-03");
    expect(r.rows.find((x) => x.userId === userId)).toBeUndefined();
  });

  it("day-by-day table and year view agree", async () => {
    const table = await monthTable(owner, "2026-03", branch.id);
    const days = table.workers.find((w) => w.userId === userId)!.days;
    expect(days.find((d) => d.date === "2026-03-02")?.status).toBe("LATE");
    expect(days.find((d) => d.date === "2026-03-08")?.status).toBe("DAY_OFF");
    const year = await yearReport(owner, 2026, branch.id);
    const march = year.months[2];
    expect(march).toMatchObject({ earned: 19083, salary: 20583, lateMin: 30, overtimeMin: 5 });
    expect(year.workers.find((w) => w.userId === userId)?.salary).toBe(20583);
  });
});

describe("exports", () => {
  it("XLSX payroll shows example A as 90", async () => {
    const f = await buildExport(owner, "attendance", "xlsx", "2026-03", branch.id, "uz");
    const files = unzipSync(f.data);
    const sheet = strFromU8(files["xl/worksheets/sheet1.xml"]);
    expect(sheet).toContain("2026-03-02");
    expect(sheet).toContain("<v>90</v>");
    const payroll = await buildExport(owner, "payroll", "xlsx", "2026-03", branch.id, "uz");
    expect(strFromU8(unzipSync(payroll.data)["xl/worksheets/sheet1.xml"])).toContain("<v>205.83</v>");
  });

  it("CSV and PDF", async () => {
    const csv = await buildExport(owner, "attendance", "csv", "2026-03", branch.id, "ru");
    const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(csv.data);
    expect(text.startsWith("﻿")).toBe(true);
    expect(text).toContain("Опоздал");
    expect(text).toMatch(/2026-03-02,Ali,Report branch,[^\n]*,90,/);
    const pdf = await buildExport(owner, "payroll", "pdf", "2026-03", undefined, "uz");
    expect(new TextDecoder().decode(pdf.data.slice(0, 5))).toBe("%PDF-");
  });
});
