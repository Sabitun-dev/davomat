// Checks that a Mini App request really comes from Telegram (spec section 4).
// secret = HMAC_SHA256(key "WebAppData", BOT_TOKEN); hash = HMAC_SHA256(secret, data-check-string).

import { hmac, safeEqual } from "../lib/crypto.ts";
import { AppError } from "../lib/errors.ts";

export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export interface InitData {
  user: TelegramUser;
  authDate: number;
  startParam: string | null;
}

export const INIT_DATA_MAX_AGE_SEC = 24 * 60 * 60;

function dataCheckString(params: URLSearchParams): string {
  return [...params.entries()]
    .filter(([key]) => key !== "hash")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

function signature(params: URLSearchParams, botToken: string): string {
  const secret = hmac("WebAppData", botToken);
  return hmac(secret, dataCheckString(params)).toString("hex");
}

export function validateInitData(
  raw: string,
  botToken: string,
  opts: { now?: number; maxAgeSec?: number } = {},
): InitData {
  const invalid = new AppError("auth_invalid", 401);
  if (!raw || raw.length > 8192) throw invalid;
  const params = new URLSearchParams(raw);
  const hash = params.get("hash") ?? "";
  if (!/^[0-9a-f]{64}$/.test(hash)) throw invalid;
  if (!safeEqual(signature(params, botToken), hash)) throw invalid;

  const authDate = Number(params.get("auth_date"));
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  if (!Number.isFinite(authDate) || authDate <= 0) throw invalid;
  if (now - authDate > (opts.maxAgeSec ?? INIT_DATA_MAX_AGE_SEC)) throw new AppError("auth_expired", 401);

  let user: TelegramUser;
  try {
    user = JSON.parse(params.get("user") ?? "");
  } catch {
    throw invalid;
  }
  if (!user || typeof user.id !== "number") throw invalid;

  return { user, authDate, startParam: params.get("start_param") };
}

/** Builds a signed initData string. Used by tests and the local demo only. */
export function signInitData(fields: Record<string, string>, botToken: string): string {
  const params = new URLSearchParams(fields);
  params.set("hash", signature(params, botToken));
  return params.toString();
}
