// Demo data for the screenshot review build (?s=<scenario>&screen=<name>). Never in the real app.

import { route } from "./mock.ts";

const q = new URLSearchParams(location.search);
const scenario = q.get("s") ?? "worker";
const lang = q.get("lang") ?? "uz";
const admin = scenario.startsWith("admin");

// The demo always shows the current month, with "today" on the 18th.
const MONTH = (() => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
})();
const TODAY = `${MONTH}-18`;

function me() {
  return {
    user: {
      id: 1,
      telegramName: "Ali",
      fullName: admin ? "Sobitxon Abdullayev" : "Ali Valiyev",
      phone: "+998901234567",
      language: lang,
      introSeen: scenario === "intro" ? [] : ["worker", "admin"],
      writeAccess: true,
    },
    needs: {
      consent: scenario === "consent",
      phone: scenario === "phone",
      name: scenario === "name",
    },
    role: admin ? "OWNER" : "WORKER",
    isStaff: admin,
    company: { id: 1, name: "Sobitxon Savdo", currency: "UZS" },
    branches: [{ id: 1, name: "Chilonzor", timezone: "Asia/Tashkent" }],
    adminBranchIds: [],
    startParam: null,
    botUsername: "davomat_bot",
  };
}

const ev = (id: number, type: string, localTime: string, extra: Record<string, unknown> = {}) => ({
  id,
  type,
  time: `${TODAY}T0${Number(localTime.slice(0, 2)) - 5}:${localTime.slice(3)}:00Z`,
  localTime,
  distanceM: 12,
  accuracy: 9,
  source: "APP",
  status: "ACCEPTED",
  rejectReason: null,
  voided: false,
  flags: [],
  videoUrl: "https://t.me/c/123/45",
  branchName: "Chilonzor",
  ...extra,
});

function result(extra: Record<string, unknown> = {}) {
  return {
    date: TODAY,
    branchId: 1,
    status: "IN_PROGRESS",
    startMin: 540,
    endMin: 1140,
    scheduledMin: 600,
    lateMin: 0,
    earlyMin: 0,
    breakMin: 0,
    overageMin: 0,
    workedMin: 600,
    amount: 250000,
    earned: 250000,
    computedEarned: 250000,
    manualEarned: null,
    autoClosed: false,
    flags: [],
    needsReview: false,
    reviewedAt: null,
    ...extra,
  };
}

function today() {
  const base = {
    date: TODAY,
    branch: { id: 1, name: "Chilonzor", timezone: "Asia/Tashkent" },
    branches: [{ id: 1, name: "Chilonzor" }],
    schedule: { startMin: 540, endMin: 1140 },
    earliestCheckInMin: 0,
    breakAllowanceMin: 60,
    streak: 5,
    week: { onTime: 3, workDays: 3 },
    month: { earned: 3_240_741, max: 6_500_000, timesLate: 2 },
    currency: "UZS",
  };
  if (scenario === "worker-working")
    return { ...base, state: "WORKING", actions: ["BREAK_START", "CHECK_OUT"], events: [ev(1, "CHECK_IN", "09:07")], result: result({ lateMin: 7 }) };
  if (scenario === "worker-break")
    return {
      ...base,
      state: "ON_BREAK",
      actions: ["BREAK_END"],
      events: [ev(1, "CHECK_IN", "08:56"), ev(2, "BREAK_START", "13:02")],
      result: result({ breakMin: 24 }),
    };
  if (scenario === "worker-finished")
    return {
      ...base,
      state: "FINISHED",
      actions: [],
      events: [ev(1, "CHECK_IN", "08:56"), ev(2, "BREAK_START", "13:02"), ev(3, "BREAK_END", "13:45"), ev(4, "CHECK_OUT", "19:01")],
      result: result({ status: "ON_TIME", breakMin: 43 }),
      streak: 6,
    };
  return { ...base, state: "NOT_STARTED", actions: ["CHECK_IN"], events: [], result: null };
}

function monthDays() {
  const looks: Record<number, string> = { 2: "LATE", 9: "ABSENT", 12: "LATE" };
  return Array.from({ length: new Date(Number(MONTH.slice(0, 4)), Number(MONTH.slice(5)), 0).getDate() }, (_, i) => {
    const d = i + 1;
    const date = `${MONTH}-${String(d).padStart(2, "0")}`;
    const wd = new Date(`${date}T00:00:00Z`).getUTCDay();
    if (wd === 0) return { date, status: "DAY_OFF", needsReview: false, reviewedAt: null, lateMin: 0, earned: 0 };
    if (d > 18) return { date, status: "FUTURE", needsReview: false, reviewedAt: null, lateMin: 0, earned: 0 };
    if (d === 18) return { date, status: "IN_PROGRESS", needsReview: false, reviewedAt: null, lateMin: 0, earned: 0 };
    if (d === 16) return { date, status: "ON_TIME", needsReview: true, reviewedAt: null, lateMin: 0, earned: 250000 };
    const status = looks[d] ?? "ON_TIME";
    return { date, status, needsReview: false, reviewedAt: null, lateMin: status === "LATE" ? 12 : 0, earned: status === "ABSENT" ? 0 : 250000 };
  });
}

const workers = [
  ["Ali Valiyev", "Sotuvchi", 250000],
  ["Dilnoza Karimova", "Kassir", 220000],
  ["Jasur Toshmatov", "Omborchi", 200000],
  ["Malika Rahimova", "Sotuvchi", 250000],
  ["Bobur Aliyev", "Haydovchi", null],
] as const;

export function registerScenarios() {
  route(/^GET \/me$/, () => me());
  route(/^POST \/me$/, () => me());
  route(/^GET \/worker\/today/, () => today());
  route(/^POST \/worker\/attendance$/, (_u, body) => {
    const b = body as { eventType: string };
    if (scenario === "worker-fail-far")
      return { ok: false, eventType: b.eventType, reason: "too_far", params: { distance: 83, radius: 25 }, distanceM: 83, serverTime: "", localTime: "09:02" };
    if (scenario === "worker-fail-location")
      return { ok: false, eventType: b.eventType, reason: "no_location", params: {}, distanceM: null, serverTime: "", localTime: "09:02" };
    return { ok: true, eventType: b.eventType, serverTime: "", localTime: "09:07", distanceM: 12, radiusM: 25, lateMin: scenario === "worker-late" ? 7 : 0, branchName: "Chilonzor" };
  });
  route(/^GET \/worker\/month/, () => ({
    month: MONTH,
    today: TODAY,
    days: monthDays(),
    totals: { timesLate: 2, lateMin: 24, earned: 3_240_741, max: 6_500_000, workedDays: 15, absentDays: 1 },
    currency: "UZS",
  }));
  route(/^GET \/worker\/history/, () =>
    monthDays()
      .filter((d) => !["FUTURE", "DAY_OFF"].includes(d.status))
      .reverse()
      .map((d) => ({ ...result({ date: d.date, status: d.status, lateMin: d.lateMin, earned: d.earned }), branchName: "Chilonzor", checkIn: "08:57", checkOut: "19:02" })),
  );
  route(/^GET \/(worker|admin)\/day/, () => ({
    date: `${MONTH}-16`,
    userName: "Ali Valiyev",
    branchName: "Chilonzor",
    branchId: 1,
    timezone: "Asia/Tashkent",
    result: result({ date: `${MONTH}-16`, status: "ON_TIME", flags: ["no_video"], needsReview: true, breakMin: 52 }),
    events: [ev(1, "CHECK_IN", "08:58", { videoUrl: null, flags: [] }), ev(2, "BREAK_START", "13:00"), ev(3, "BREAK_END", "13:52"), ev(4, "CHECK_OUT", "19:00")],
    audit: [],
  }));

  const branch = {
    id: 1,
    name: "Chilonzor",
    address: "Bunyodkor ko'chasi 12",
    lat: 41.2856,
    lng: 69.2034,
    radiusM: 25,
    timezone: "Asia/Tashkent",
    qrVersion: 1,
    qrMode: "STATIC",
    breakAllowanceMin: 60,
    graceMin: 5,
    graceMode: "FULL",
    active: true,
  };
  route(/^GET \/admin\/branches$/, () => [
    { ...branch, workerCount: 5 },
    { ...branch, id: 2, name: "Yunusobod", address: "Amir Temur 108", workerCount: 3 },
  ]);
  const qrSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 29 29" shape-rendering="crispEdges"><rect width="29" height="29" fill="#fff"/>${Array.from({ length: 140 }, (_, i) => `<rect x="${(i * 7) % 27 + 1}" y="${Math.floor((i * 7) / 27) % 27 + 1}" width="1" height="1"/>`).join("")}<rect x="1" y="1" width="7" height="7" fill="none" stroke="#000"/><rect x="21" y="1" width="7" height="7" fill="none" stroke="#000"/><rect x="1" y="21" width="7" height="7" fill="none" stroke="#000"/></svg>`;
  route(/^GET \/admin\/branches\/1$/, () => ({ ...branch, qr: { svg: qrSvg, version: 1, pngUrl: "#", posterUrl: "#", fileBase: "chilonzor" } }));
  route(/^GET \/admin\/branches\/1\/members/, () =>
    workers.map(([name, position, amount], i) => ({
      memberId: i + 1,
      userId: i + 1,
      name,
      phone: `+99890123456${i}`,
      username: null,
      position,
      defaultDailyAmount: amount,
      active: true,
      joinedAt: "2026-01-10",
      otherBranches: [],
    })),
  );
  route(/^GET \/admin\/branches\/1\/invites/, () => [
    { id: 1, role: "WORKER", expiresAt: "2026-03-25T00:00:00Z", maxUses: null, uses: 3, link: "https://t.me/davomat_bot/app?startapp=inv_abc" },
  ]);
  route(/^GET \/admin\/dashboard/, () => ({
    working: [
      { userId: 1, name: "Ali Valiyev", branch: "Chilonzor", since: "08:56" },
      { userId: 2, name: "Dilnoza Karimova", branch: "Chilonzor", since: "09:07" },
      { userId: 4, name: "Malika Rahimova", branch: "Yunusobod", since: "08:49" },
    ],
    onBreak: [{ userId: 3, name: "Jasur Toshmatov", branch: "Chilonzor", since: "13:02" }],
    late: [{ userId: 2, name: "Dilnoza Karimova", branch: "Chilonzor", lateMin: 7, time: "09:07" }],
    notArrived: [{ userId: 5, name: "Bobur Aliyev", branch: "Yunusobod", start: "09:00" }],
    reviewCount: 3,
    dates: { 1: TODAY },
  }));
  const totals = (i: number) => ({
    daysWorked: 15 - i,
    absent: i % 2,
    timesLate: [2, 4, 0, 1, 3][i],
    lateMin: [24, 51, 0, 6, 33][i],
    earlyMin: [0, 10, 0, 0, 5][i],
    overageMin: [0, 15, 0, 0, 0][i],
    workedMin: (15 - i) * 590,
    onTimeDays: 12 - i,
    earned: [3_240_741, 2_980_000, 2_800_000, 3_190_000, 0][i],
    max: [6_500_000, 5_720_000, 5_200_000, 6_500_000, 0][i],
    bonus: i === 0 ? 300_000 : 0,
    fine: i === 1 ? 50_000 : 0,
    salary: [3_540_741, 2_930_000, 2_800_000, 3_190_000, 0][i],
    missingAmounts: i === 4 ? 14 : 0,
    reviewDays: i === 1 ? 2 : 0,
  });
  route(/^GET \/admin\/reports\/month/, () => {
    const rows = workers.map(([name, position], i) => ({ userId: i + 1, name, branchName: i === 3 ? "Yunusobod" : "Chilonzor", position, ...totals(i) }));
    const sum = (k: string) => rows.reduce((s, r) => s + Number((r as Record<string, unknown>)[k]), 0);
    const company = { ...totals(0), workers: 5, punctuality: 87, salary: sum("salary"), timesLate: sum("timesLate"), lateMin: sum("lateMin"), absent: sum("absent"), missingAmounts: 14, reviewDays: 2 };
    return {
      month: MONTH,
      currency: "UZS",
      locked: false,
      rows,
      branches: [
        { ...company, id: 1, name: "Chilonzor", punctuality: 84 },
        { ...company, id: 2, name: "Yunusobod", punctuality: 93, salary: 3_190_000 },
      ],
      company,
      ranking: rows.filter((r) => r.timesLate > 0).sort((a, b) => b.lateMin - a.lateMin).map((r) => ({ userId: r.userId, name: r.name, branchName: r.branchName, timesLate: r.timesLate, lateMin: r.lateMin })),
    };
  });
  route(/^GET \/admin\/reports\/year/, () => ({
    year: 2026,
    currency: "UZS",
    months: Array.from({ length: 12 }, (_, i) => ({ month: `2026-${String(i + 1).padStart(2, "0")}`, ...totals(0), salary: i < 3 ? [11_800_000, 12_400_000, 12_460_741][i] : 0, lateMin: i < 3 ? [140, 96, 114][i] : 0 })),
    workers: workers.map(([name], i) => ({ userId: i + 1, name, ...totals(i) })),
  }));
  route(/^GET \/admin\/branches\/1\/amounts/, () => {
    const dates = Array.from({ length: new Date(Number(MONTH.slice(0, 4)), Number(MONTH.slice(5)), 0).getDate() }, (_, i) => `${MONTH}-${String(i + 1).padStart(2, "0")}`);
    return {
      month: MONTH,
      currency: "UZS",
      locked: false,
      dates,
      missing: 26,
      workers: workers.map(([name, , amount], i) => ({
        userId: i + 1,
        name,
        defaultDailyAmount: amount,
        cells: dates.map((date) => {
          const working = new Date(`${date}T00:00:00Z`).getUTCDay() !== 0;
          return { date, working, amount: i === 0 && date === `${MONTH}-08` ? 300000 : null, effective: working ? amount : null };
        }),
      })),
    };
  });
  route(/^GET \/admin\/branches\/1\/schedule/, () => {
    const dates = Array.from({ length: new Date(Number(MONTH.slice(0, 4)), Number(MONTH.slice(5)), 0).getDate() }, (_, i) => `${MONTH}-${String(i + 1).padStart(2, "0")}`);
    return {
      branch: { id: 1, name: "Chilonzor" },
      month: MONTH,
      locked: false,
      ownWeek: false,
      week: [1, 2, 3, 4, 5, 6, 7].map((weekday) => (weekday === 7 ? { weekday, startMin: null, endMin: null, dayOff: true } : { weekday, startMin: 540, endMin: weekday === 6 ? 900 : 1140, dayOff: false })),
      days: dates.map((date) => {
        const wd = new Date(`${date}T00:00:00Z`).getUTCDay();
        const holiday = date === `${MONTH}-08` || date === `${MONTH}-21`;
        return { date, startMin: wd === 0 || holiday ? null : 540, endMin: wd === 0 || holiday ? null : wd === 6 ? 900 : 1140, dayOff: wd === 0 || holiday, holiday, overridden: holiday, note: "" };
      }),
    };
  });
  route(/^GET \/admin\/reports\/worker-days/, () => ({ month: MONTH, today: TODAY, days: monthDays() }));
  route(/^GET \/admin\/review/, () => [
    { userId: 2, name: "Dilnoza Karimova", branchName: "Chilonzor", date: `${MONTH}-16`, flags: ["no_checkout"], status: "ON_TIME" },
    { userId: 1, name: "Ali Valiyev", branchName: "Chilonzor", date: `${MONTH}-14`, flags: ["no_video"], status: "ON_TIME" },
    { userId: 3, name: "Jasur Toshmatov", branchName: "Chilonzor", date: `${MONTH}-12`, flags: ["edge_after_fails", "repeated_coords"], status: "LATE" },
  ]);
  route(/^GET \/admin\/(adjustments|people)/, () => []);
  route(/^GET \/admin\/company/, () => ({ name: "Sobitxon Savdo", currency: "UZS", currencyLocked: true, settings: { overtimeEnabled: true, overtimeIncludeEarly: true, gpsAccuracyLimitM: 50, geofenceToleranceM: 0, earliestCheckInMin: 180, autoCloseAfterMin: 120, videoBeforeMin: 15, videoAfterMin: 5, botReplyUnderVideo: false, flagMissingVideo: true, inviteExpiryDays: 7, gpsRetentionMonths: 12, rateLimitPer5Min: 10, remindCheckInAfterMin: 10, remindCheckOutAfterMin: 30, morningSummary: true, dailyFlagSummary: true, monthlyPayrollMessage: true } }));
}
