import { describe, expect, it } from "vitest";
import { signInitData, validateInitData } from "../src/auth/initData.ts";

const TOKEN = "123456:TEST-token-for-unit-tests-only-abcdefghijk";
const NOW = 1_800_000_000;

function make(overrides: Record<string, string> = {}, token = TOKEN) {
  return signInitData(
    {
      user: JSON.stringify({ id: 42, first_name: "Ali", language_code: "uz" }),
      auth_date: String(NOW - 60),
      query_id: "AAE",
      ...overrides,
    },
    token,
  );
}

describe("initData", () => {
  it("accepts valid data", () => {
    const d = validateInitData(make({ start_param: "inv_abc" }), TOKEN, { now: NOW });
    expect(d.user.id).toBe(42);
    expect(d.startParam).toBe("inv_abc");
  });

  it("rejects a tampered user", () => {
    const raw = make().replace(encodeURIComponent('"id":42'), encodeURIComponent('"id":43'));
    expect(() => validateInitData(raw, TOKEN, { now: NOW })).toThrow("auth_invalid");
  });

  it("rejects a tampered field added after signing", () => {
    const raw = `${make()}&start_param=inv_evil`;
    expect(() => validateInitData(raw, TOKEN, { now: NOW })).toThrow("auth_invalid");
  });

  it("rejects data signed with another bot token", () => {
    const raw = make({}, "999:other-token-xxxxxxxxxxxxxxxxxxxxxxx");
    expect(() => validateInitData(raw, TOKEN, { now: NOW })).toThrow("auth_invalid");
  });

  it("rejects data older than 24 hours", () => {
    const raw = make({ auth_date: String(NOW - 24 * 3600 - 1) });
    expect(() => validateInitData(raw, TOKEN, { now: NOW })).toThrow("auth_expired");
  });

  it("accepts data exactly 24 hours old", () => {
    const raw = make({ auth_date: String(NOW - 24 * 3600) });
    expect(validateInitData(raw, TOKEN, { now: NOW }).user.id).toBe(42);
  });

  it("rejects missing or malformed hash", () => {
    expect(() => validateInitData("", TOKEN, { now: NOW })).toThrow("auth_invalid");
    expect(() => validateInitData("user=%7B%7D&hash=zz", TOKEN, { now: NOW })).toThrow("auth_invalid");
  });
});
