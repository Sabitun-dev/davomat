import { describe, expect, it } from "vitest";
import { addDays, daysInMonth, localToUtc, parseHHMM, shiftMonth, toLocal, weekdayOf } from "../src/shared/time.ts";
import { formatMoney, parseMoneyInput } from "../src/shared/money.ts";

describe("time helpers", () => {
  it("converts UTC to Tashkent local time and drops seconds", () => {
    const l = toLocal(new Date("2026-03-02T04:00:45Z"), "Asia/Tashkent");
    expect(l).toEqual({ date: "2026-03-02", minute: 9 * 60, second: 45, weekday: 1 });
  });

  it("converts local time back to UTC", () => {
    expect(localToUtc("2026-03-02", 540, "Asia/Tashkent").toISOString()).toBe("2026-03-02T04:00:00.000Z");
    // A zone with daylight saving time.
    expect(localToUtc("2026-07-01", 540, "Europe/Moscow").toISOString()).toBe("2026-07-01T06:00:00.000Z");
  });

  it("handles dates and months", () => {
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(weekdayOf("2026-03-08")).toBe(7);
    expect(daysInMonth("2028-02")).toHaveLength(29);
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(parseHHMM("9:05")).toBe(545);
    expect(parseHHMM("24:00")).toBeNull();
  });
});

describe("money", () => {
  it("formats so'm and dollars", () => {
    expect(formatMoney(4500000, "UZS")).toBe("4 500 000 so'm");
    expect(formatMoney(9750, "USD")).toBe("$97.50");
    expect(formatMoney(123456789, "USD")).toBe("$1,234,567.89");
  });

  it("parses admin input", () => {
    expect(parseMoneyInput("97.5", "USD")).toBe(9750);
    expect(parseMoneyInput("$100", "USD")).toBe(10000);
    expect(parseMoneyInput("250 000", "UZS")).toBe(250000);
    expect(parseMoneyInput("12.5", "UZS")).toBeNull();
    expect(parseMoneyInput("abc", "USD")).toBeNull();
  });
});
