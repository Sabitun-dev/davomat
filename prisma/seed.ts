// Demo data: 2 branches, 5 workers, two weeks of attendance.
// Run: npm run db:seed   (needs DATABASE_URL in .env)
// Refuses to run when the database already has branches or users other than owners.

import { createBranch } from "../src/branches/service.ts";
import { db } from "../src/lib/db.ts";
import { env } from "../src/lib/env.ts";
import { addDays, localToUtc, toLocal, weekdayOf } from "../src/shared/time.ts";
import { recalcUserDays } from "../src/pay/recalc.ts";
import { loadActor } from "../src/users/service.ts";

try {
  process.loadEnvFile();
} catch {
  // no .env
}

export async function seedDemo(): Promise<void> {
  const branches = await db().branch.count();
  const members = await db().membership.count({ where: { role: { not: "OWNER" } } });
  const events = await db().attendanceEvent.count();
  if (branches > 0 || members > 0 || events > 0) {
    throw new Error("The database is not empty. The demo seed only runs on a fresh database. Nothing was changed.");
  }

  const company = await db().company.create({ data: { name: "Demo kompaniya" } });

  const ownerTelegramId = env.ownerTelegramIds[0] ?? 900_000_000n;
  const ownerUser = await db().user.upsert({
    where: { telegramId: ownerTelegramId },
    create: { telegramId: ownerTelegramId, firstName: "Owner", fullName: "Demo Owner", phone: "+998900000000", consentAt: new Date(), nameConfirmedAt: new Date() },
    update: {},
  });
  await db().membership.upsert({
    where: { userId_companyId: { userId: ownerUser.id, companyId: company.id } },
    create: { userId: ownerUser.id, companyId: company.id, role: "OWNER" },
    update: { role: "OWNER", active: true },
  });
  const owner = await loadActor(ownerUser);

  const chilonzor = await createBranch(owner, { name: "Chilonzor", address: "Bunyodkor ko'chasi 12", lat: 41.2856, lng: 69.2034, radiusM: 25 });
  const yunusobod = await createBranch(owner, { name: "Yunusobod", address: "Amir Temur 108", lat: 41.3646, lng: 69.2873, radiusM: 30 });

  const people = [
    ["Ali Valiyev", "Sotuvchi", chilonzor, 250000, 0],
    ["Dilnoza Karimova", "Kassir", chilonzor, 220000, 8],
    ["Jasur Toshmatov", "Omborchi", chilonzor, 200000, 3],
    ["Malika Rahimova", "Sotuvchi", yunusobod, 250000, 0],
    ["Bobur Aliyev", "Haydovchi", yunusobod, 180000, 15],
  ] as const;

  const tz = "Asia/Tashkent";
  const today = toLocal(new Date(), tz).date;
  const joined = new Date(Date.now() - 30 * 86400_000);
  let n = 0;
  for (const [name, position, branch, amount, lateness] of people) {
    n++;
    const user = await db().user.create({
      data: {
        telegramId: BigInt(900_000_000 + n),
        firstName: name.split(" ")[0],
        fullName: name,
        phone: `+99890000000${n}`,
        consentAt: new Date(),
        nameConfirmedAt: new Date(),
        introSeen: ["worker"],
      },
    });
    await db().membership.create({ data: { userId: user.id, companyId: company.id, role: "WORKER" } });
    await db().branchMember.create({ data: { userId: user.id, branchId: branch.id, position, defaultDailyAmount: amount, joinedAt: joined } });

    const dates: string[] = [];
    for (let d = 14; d >= 1; d--) {
      const date = addDays(today, -d);
      dates.push(date);
      if (weekdayOf(date) === 7) continue;
      // Every worker misses one day; late ones are late on some days.
      if ((d + n) % 11 === 0) continue;
      const late = lateness && d % 3 === 0 ? lateness : 0;
      const ev = (type: "CHECK_IN" | "BREAK_START" | "BREAK_END" | "CHECK_OUT", minute: number) => ({
        companyId: company.id,
        userId: user.id,
        branchId: branch.id,
        localDate: date,
        type,
        serverTime: localToUtc(date, minute, tz),
        lat: branch.lat + 0.00005 * ((d % 5) - 2),
        lng: branch.lng + 0.00004 * ((n % 3) - 1),
        accuracy: 8 + (d % 7),
        distanceM: 4 + ((d * n) % 15),
        status: "ACCEPTED" as const,
        idempotencyKey: `seed-${user.id}-${date}-${type}`,
      });
      await db().attendanceEvent.createMany({
        data: [
          ev("CHECK_IN", 535 + late + (d % 4)),
          ev("BREAK_START", 780),
          ev("BREAK_END", 780 + 45 + (n === 2 && d % 4 === 0 ? 30 : 0)),
          ev("CHECK_OUT", 1140 + (d % 3)),
        ],
      });
    }
    await recalcUserDays(db(), user.id, dates);
  }
  console.log("Demo data created: 2 branches, 5 workers, 2 weeks of attendance.");
}

if ((process.argv[1] ?? "").split("\\").join("/").endsWith("prisma/seed.ts")) {
  seedDemo().then(
    () => process.exit(0),
    (err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    },
  );
}
