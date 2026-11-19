// Spec 6.4: examples that must pass exactly.

import { describe, expect, it } from "vitest";
import { computeDay, proportionalPay, type DayInput } from "../src/pay/engine.ts";
import type { EventType } from "../src/shared/attendance.ts";

const hm = (s: string) => {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
};
/** Seconds are dropped before the engine: 09:00:45 -> 09:00. */
const hms = (s: string) => hm(s.slice(0, 5));
const ev = (type: EventType, time: string) => ({ type, minute: hms(time) });

function day(overrides: Partial<DayInput>): DayInput {
  return {
    schedule: { startMin: hm("09:00"), endMin: hm("19:00") },
    graceMin: 0,
    graceMode: "FULL",
    breakAllowanceMin: 60,
    amount: 10000, // 100 USD in cents
    events: [],
    nowMinute: null,
    autoCloseAfterMin: 120,
    ...overrides,
  };
}

describe("spec 6.4 examples", () => {
  it("A: 100 USD, in 09:30, out 18:30 -> worked 540, earned 90.00", () => {
    const r = computeDay(day({ events: [ev("CHECK_IN", "09:30"), ev("CHECK_OUT", "18:30")] }));
    expect(r).toMatchObject({ scheduledMin: 600, lateMin: 30, earlyMin: 30, workedMin: 540, earned: 9000, status: "LATE" });
  });

  it("B: in 08:50, breaks 75 min, out 19:10 -> overage 15, worked 585, earned 97.50", () => {
    const r = computeDay(
      day({
        events: [
          ev("CHECK_IN", "08:50"),
          ev("BREAK_START", "12:00"),
          ev("BREAK_END", "12:45"),
          ev("BREAK_START", "16:00"),
          ev("BREAK_END", "16:30"),
          ev("CHECK_OUT", "19:10"),
        ],
      }),
    );
    expect(r).toMatchObject({ lateMin: 0, earlyMin: 0, breakMin: 75, overageMin: 15, workedMin: 585, earned: 9750, status: "ON_TIME" });
  });

  it("C: in 09:00:45, out 19:00 -> on time, 100.00", () => {
    const r = computeDay(day({ events: [ev("CHECK_IN", "09:00:45"), ev("CHECK_OUT", "19:00")] }));
    expect(r).toMatchObject({ lateMin: 0, earned: 10000, status: "ON_TIME" });
  });

  it("D: grace 5 'full': in 09:04 -> late 0; in 09:07 -> late 7", () => {
    const a = computeDay(day({ graceMin: 5, events: [ev("CHECK_IN", "09:04"), ev("CHECK_OUT", "19:00")] }));
    const b = computeDay(day({ graceMin: 5, events: [ev("CHECK_IN", "09:07"), ev("CHECK_OUT", "19:00")] }));
    expect(a.lateMin).toBe(0);
    expect(b.lateMin).toBe(7);
    expect(b.workedMin).toBe(593);
  });

  it("D edge: exactly at start + grace is on time", () => {
    expect(computeDay(day({ graceMin: 5, events: [ev("CHECK_IN", "09:05"), ev("CHECK_OUT", "19:00")] })).lateMin).toBe(0);
  });

  it("E: grace 5 'after grace': in 09:07 -> late 2", () => {
    const r = computeDay(day({ graceMin: 5, graceMode: "AFTER_GRACE", events: [ev("CHECK_IN", "09:07"), ev("CHECK_OUT", "19:00")] }));
    expect(r.lateMin).toBe(2);
  });

  it("F: 250 000 so'm, 09:00-18:00, in 09:20 -> 520/540, 240 741 so'm", () => {
    const r = computeDay(
      day({
        schedule: { startMin: hm("09:00"), endMin: hm("18:00") },
        amount: 250000,
        events: [ev("CHECK_IN", "09:20"), ev("CHECK_OUT", "18:00")],
      }),
    );
    expect(r).toMatchObject({ scheduledMin: 540, workedMin: 520, earned: 240741 });
  });

  it("G: working day with no events -> absent, 0", () => {
    const r = computeDay(day({}));
    expect(r).toMatchObject({ status: "ABSENT", earned: 0, workedMin: 0, final: true });
  });

  it("H: in 09:00, no check-out -> auto-closed, 100.00, needs review", () => {
    const r = computeDay(day({ events: [ev("CHECK_IN", "09:00")] }));
    expect(r).toMatchObject({ autoClosed: true, earned: 10000, needsReview: true, checkOutMin: hm("19:00") });
    expect(r.flags).toContain("no_checkout");
  });

  it("H (scheduler): an AUTO check-out at the scheduled end gives the same result", () => {
    const r = computeDay(day({ events: [ev("CHECK_IN", "09:00"), { type: "CHECK_OUT", minute: hm("19:00"), auto: true }] }));
    expect(r).toMatchObject({ autoClosed: true, earned: 10000, needsReview: true });
  });

  it("I: 100, 09:00-10:00, in 10:30 -> worked 0, earned 0 (never negative)", () => {
    const r = computeDay(day({ schedule: { startMin: hm("09:00"), endMin: hm("10:00") }, events: [ev("CHECK_IN", "10:30")] }));
    expect(r.workedMin).toBe(0);
    expect(r.earned).toBe(0);
  });
});

describe("pay engine details", () => {
  it("rounds half up to 1 so'm / 1 cent", () => {
    expect(proportionalPay(1, 1, 2)).toBe(1); // 0.5 -> 1
    expect(proportionalPay(3, 1, 7)).toBe(0); // 0.43 -> 0
    expect(proportionalPay(100, 1, 3)).toBe(33);
    expect(proportionalPay(200, 1, 3)).toBe(67);
  });

  it("a break still open at the scheduled end counts until the end", () => {
    const r = computeDay(day({ events: [ev("CHECK_IN", "09:00"), ev("BREAK_START", "17:30")] }));
    expect(r.breakMin).toBe(90);
    expect(r.overageMin).toBe(30);
  });

  it("breaks outside scheduled hours do not cut pay", () => {
    const r = computeDay(
      day({ events: [ev("CHECK_IN", "08:00"), ev("BREAK_START", "08:10"), ev("BREAK_END", "09:10"), ev("CHECK_OUT", "19:00")] }),
    );
    expect(r.breakMin).toBe(10);
  });

  it("no daily amount: earned 0 and a payroll warning", () => {
    const r = computeDay(day({ amount: null, events: [ev("CHECK_IN", "09:00"), ev("CHECK_OUT", "19:00")] }));
    expect(r.earned).toBe(0);
    expect(r.flags).toContain("missing_amount");
    expect(r.needsReview).toBe(false);
  });

  it("day off with check-in is an extra day paid by the set amount (0 without one)", () => {
    const withAmount = computeDay(day({ schedule: null, amount: 15000, events: [ev("CHECK_IN", "10:00"), ev("CHECK_OUT", "14:00")] }));
    expect(withAmount).toMatchObject({ status: "EXTRA_DAY", earned: 15000, workedMin: 240 });
    const without = computeDay(day({ schedule: null, amount: null, events: [ev("CHECK_IN", "10:00"), ev("CHECK_OUT", "14:00")] }));
    expect(without.earned).toBe(0);
  });

  it("day off without events", () => {
    expect(computeDay(day({ schedule: null })).status).toBe("DAY_OFF");
  });

  it("today: still working is in progress; not arrived before end is not absent yet", () => {
    expect(computeDay(day({ nowMinute: hm("12:00"), events: [ev("CHECK_IN", "09:00")] })).status).toBe("IN_PROGRESS");
    expect(computeDay(day({ nowMinute: hm("12:00") })).status).toBe("NOT_STARTED");
    expect(computeDay(day({ nowMinute: hm("19:30") })).status).toBe("ABSENT");
    // At end + 2 h the open day closes itself.
    expect(computeDay(day({ nowMinute: hm("21:00"), events: [ev("CHECK_IN", "09:00")] })).autoClosed).toBe(true);
  });

  it("overtime is off: early arrival and late leaving add nothing", () => {
    const r = computeDay(day({ events: [ev("CHECK_IN", "07:00"), ev("CHECK_OUT", "22:00")] }));
    expect(r.workedMin).toBe(600);
    expect(r.earned).toBe(10000);
  });
});

describe("overtime (paid at the same per-minute rate)", () => {
  const on = { enabled: true, includeEarly: true };
  const shift12 = { startMin: hm("08:00"), endMin: hm("20:00") };

  it("owner's example: 12 h shift for 120 USD, worked 14 h -> 140 USD", () => {
    const r = computeDay(day({ schedule: shift12, amount: 12000, breakAllowanceMin: 0, overtime: on, events: [ev("CHECK_IN", "08:00"), ev("CHECK_OUT", "22:00")] }));
    expect(r).toMatchObject({ overtimeMin: 120, workedMin: 840, earned: 14000 });
  });

  it("working less still pays less", () => {
    const r = computeDay(day({ schedule: shift12, amount: 12000, overtime: on, events: [ev("CHECK_IN", "08:00"), ev("CHECK_OUT", "18:00")] }));
    expect(r).toMatchObject({ overtimeMin: 0, workedMin: 600, earned: 10000 });
  });

  it("arriving 30 min late and staying 30 min longer evens out", () => {
    const r = computeDay(day({ overtime: on, events: [ev("CHECK_IN", "09:30"), ev("CHECK_OUT", "19:30")] }));
    expect(r).toMatchObject({ lateMin: 30, overtimeMin: 30, workedMin: 600, earned: 10000 });
  });

  it("early arrival counts only when that setting is on", () => {
    const events = [ev("CHECK_IN", "08:00"), ev("CHECK_OUT", "19:00")];
    expect(computeDay(day({ overtime: on, events })).overtimeMin).toBe(60);
    expect(computeDay(day({ overtime: { enabled: true, includeEarly: false }, events })).overtimeMin).toBe(0);
    expect(computeDay(day({ overtime: { enabled: false, includeEarly: true }, events })).earned).toBe(10000);
  });

  it("breaks taken after the scheduled end are not paid", () => {
    const r = computeDay(
      day({ overtime: on, events: [ev("CHECK_IN", "09:00"), ev("BREAK_START", "19:30"), ev("BREAK_END", "20:00"), ev("CHECK_OUT", "21:00")] }),
    );
    expect(r).toMatchObject({ overtimeMin: 90, workedMin: 690, earned: 11500 });
  });

  it("an auto-closed day (no check-out) never earns overtime", () => {
    const r = computeDay(day({ overtime: on, events: [ev("CHECK_IN", "09:00"), { type: "CHECK_OUT", minute: hm("19:00"), auto: true }] }));
    expect(r).toMatchObject({ overtimeMin: 0, earned: 10000, autoClosed: true });
  });
});
