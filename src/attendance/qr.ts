// Branch QR tokens (spec 5.1). The token is signed and never contains coordinates.
//   static:   q_<branchId>_<version>_<sig>            sig = HMAC(branch, version)
//   rotating: r_<branchId>_<version>_<window>_<sig>   sig = HMAC(branch, version, 30-second window)
// The QR holds a Mini App link (t.me/<bot>/<app>?startapp=<token>), so a phone camera opens the app.
// The app still requires a live in-app scan: opening that link never records anything.

import { hmac, safeEqual } from "../lib/crypto.ts";

export const ROTATE_WINDOW_SEC = 30;

export type QrToken =
  | { kind: "static"; branchId: number; version: number }
  | { kind: "rotating"; branchId: number; version: number; window: number };

function sign(secret: string, data: string): string {
  return hmac(secret, `davomat:${data}`).subarray(0, 12).toString("hex");
}

export function staticToken(secret: string, branchId: number, version: number): string {
  return `q_${branchId}_${version}_${sign(secret, `s:${branchId}:${version}`)}`;
}

export function windowAt(nowMs: number): number {
  return Math.floor(nowMs / 1000 / ROTATE_WINDOW_SEC);
}

export function rotatingToken(secret: string, branchId: number, version: number, nowMs: number): string {
  const w = windowAt(nowMs);
  return `r_${branchId}_${version}_${w}_${sign(secret, `r:${branchId}:${version}:${w}`)}`;
}

/** Finds the token inside whatever the camera read: a t.me link or the bare token. */
export function extractToken(scanned: string): string | null {
  const text = scanned.trim().slice(0, 512);
  const fromLink = /[?&]startapp=([A-Za-z0-9_-]+)/.exec(text);
  const candidate = fromLink ? fromLink[1] : text;
  return /^[qr]_[0-9a-z_]+$/i.test(candidate) ? candidate : null;
}

/** Checks the signature only. Whether the version or window is still current is decided by the caller. */
export function parseToken(secret: string, scanned: string): QrToken | null {
  const token = extractToken(scanned);
  if (!token) return null;
  const parts = token.split("_");
  const nums = parts.slice(1, -1).map(Number);
  if (nums.some((n) => !Number.isSafeInteger(n) || n < 0)) return null;
  const sig = parts[parts.length - 1];
  if (parts[0] === "q" && parts.length === 4) {
    const [branchId, version] = nums;
    if (!safeEqual(sig, sign(secret, `s:${branchId}:${version}`))) return null;
    return { kind: "static", branchId, version };
  }
  if (parts[0] === "r" && parts.length === 5) {
    const [branchId, version, window] = nums;
    if (!safeEqual(sig, sign(secret, `r:${branchId}:${version}:${window}`))) return null;
    return { kind: "rotating", branchId, version, window };
  }
  return null;
}

export type QrCheck = "ok" | "old_qr" | "qr_expired";

/** Is a valid token still usable for the branch right now? Rotating: current and previous window. */
export function checkTokenFreshness(
  token: QrToken,
  branch: { qrVersion: number; qrMode: "STATIC" | "ROTATING" },
  nowMs: number,
): QrCheck {
  if (token.version !== branch.qrVersion) return "old_qr";
  if (branch.qrMode === "ROTATING") {
    if (token.kind !== "rotating") return "qr_expired";
    const w = windowAt(nowMs);
    return token.window === w || token.window === w - 1 ? "ok" : "qr_expired";
  }
  // A static branch also accepts a fresh rotating code (e.g. right after switching modes back).
  if (token.kind === "rotating") {
    const w = windowAt(nowMs);
    return token.window === w || token.window === w - 1 ? "ok" : "qr_expired";
  }
  return "ok";
}
