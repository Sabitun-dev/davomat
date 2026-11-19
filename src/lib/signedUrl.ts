// Short-lived signed download links (for Telegram's downloadFile, which cannot send our login header).

import { hmac, safeEqual } from "./crypto.ts";
import { env } from "./env.ts";

function signature(path: string, params: Record<string, string>, exp: number): string {
  const data = [path, ...Object.keys(params).sort().map((k) => `${k}=${params[k]}`), `exp=${exp}`].join("|");
  return hmac(env.qrSecret, `file|${data}`).subarray(0, 16).toString("hex");
}

export function signedUrl(path: string, params: Record<string, string>, ttlSec = 600): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const qs = new URLSearchParams({ ...params, exp: String(exp), sig: signature(path, params, exp) });
  return `${env.appUrl}/api/files/${path}?${qs}`;
}

/** Returns the signed params (without exp/sig) when the link is valid and not expired. */
export function verifySignedUrl(path: string, query: URLSearchParams): Record<string, string> | null {
  const exp = Number(query.get("exp"));
  const sig = query.get("sig") ?? "";
  if (!Number.isFinite(exp) || exp < Date.now() / 1000) return null;
  const params: Record<string, string> = {};
  for (const [k, v] of query.entries()) if (k !== "exp" && k !== "sig") params[k] = v;
  return safeEqual(sig, signature(path, params, exp)) ? params : null;
}
