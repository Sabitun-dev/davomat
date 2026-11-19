import { describe, expect, it } from "vitest";
import {
  checkTokenFreshness,
  extractToken,
  parseToken,
  rotatingToken,
  staticToken,
  windowAt,
} from "../src/attendance/qr.ts";

const SECRET = "test-qr-secret-0123456789-0123456789-abcdef";
const NOW = 1_800_000_000_000;

describe("QR tokens", () => {
  it("accepts a valid static token, bare or inside a t.me link", () => {
    const token = staticToken(SECRET, 7, 3);
    expect(parseToken(SECRET, token)).toEqual({ kind: "static", branchId: 7, version: 3 });
    expect(parseToken(SECRET, `https://t.me/bot/app?startapp=${token}`)).toEqual({ kind: "static", branchId: 7, version: 3 });
    expect(checkTokenFreshness(parseToken(SECRET, token)!, { qrVersion: 3, qrMode: "STATIC" }, NOW)).toBe("ok");
  });

  it("never contains coordinates", () => {
    expect(staticToken(SECRET, 7, 3)).not.toMatch(/\d+\.\d+/);
  });

  it("rejects a forged branch id (wrong branch)", () => {
    const token = staticToken(SECRET, 7, 3).replace("q_7_", "q_8_");
    expect(parseToken(SECRET, token)).toBeNull();
  });

  it("rejects a token signed with another secret", () => {
    expect(parseToken(SECRET, staticToken("other-secret", 7, 3))).toBeNull();
  });

  it("rejects unrelated QR codes", () => {
    expect(parseToken(SECRET, "https://example.com")).toBeNull();
    expect(parseToken(SECRET, "WIFI:S:office;T:WPA;P:secret;;")).toBeNull();
    expect(extractToken("hello")).toBeNull();
  });

  it("an old version stops working after regenerate", () => {
    const token = parseToken(SECRET, staticToken(SECRET, 7, 3))!;
    expect(checkTokenFreshness(token, { qrVersion: 4, qrMode: "STATIC" }, NOW)).toBe("old_qr");
  });

  it("rotating: accepts the current and previous 30-second window only", () => {
    const branch = { qrVersion: 1, qrMode: "ROTATING" as const };
    const current = parseToken(SECRET, rotatingToken(SECRET, 7, 1, NOW))!;
    const previous = parseToken(SECRET, rotatingToken(SECRET, 7, 1, NOW - 30_000))!;
    const older = parseToken(SECRET, rotatingToken(SECRET, 7, 1, NOW - 60_000))!;
    expect(current.kind).toBe("rotating");
    expect(checkTokenFreshness(current, branch, NOW)).toBe("ok");
    expect(checkTokenFreshness(previous, branch, NOW)).toBe("ok");
    expect(checkTokenFreshness(older, branch, NOW)).toBe("qr_expired");
    expect(windowAt(NOW) - windowAt(NOW - 60_000)).toBe(2);
  });

  it("rotating mode refuses the printed static code", () => {
    const token = parseToken(SECRET, staticToken(SECRET, 7, 1))!;
    expect(checkTokenFreshness(token, { qrVersion: 1, qrMode: "ROTATING" }, NOW)).toBe("qr_expired");
  });

  it("rotating: a forged window is rejected", () => {
    const token = rotatingToken(SECRET, 7, 1, NOW);
    const forged = token.replace(`_${windowAt(NOW)}_`, `_${windowAt(NOW) + 100}_`);
    expect(parseToken(SECRET, forged)).toBeNull();
  });
});
