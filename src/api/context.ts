import type { Context, MiddlewareHandler } from "hono";
import { validateInitData, type InitData } from "../auth/initData.ts";
import type { Actor } from "../auth/permissions.ts";
import { env } from "../lib/env.ts";
import { AppError, badRequest } from "../lib/errors.ts";
import { loadActor, upsertTelegramUser } from "../users/service.ts";
import type { User } from "../generated/prisma/client.ts";

export type AppEnv = { Variables: { user: User; actor: Actor; init: InitData } };
export type Ctx = Context<AppEnv>;

/** Validates Telegram initData on every request and loads the user and their role. */
export const requireTelegram: MiddlewareHandler<AppEnv> = async (c, next) => {
  const header = c.req.header("authorization") ?? "";
  const raw = header.startsWith("tma ") ? header.slice(4) : "";
  if (!raw) throw new AppError("auth_missing", 401);
  const init = validateInitData(raw, env.botToken);
  const user = await upsertTelegramUser(init.user);
  const actor = await loadActor(user);
  c.set("init", init);
  c.set("user", user);
  c.set("actor", actor);
  await next();
};

/** /worker and /admin: the current company must exist and be usable (checked on every request). */
export const requireUsableCompany: MiddlewareHandler<AppEnv> = async (c, next) => {
  const state = c.get("actor").companyState;
  if (state === "none") throw new AppError("not_member", 403);
  if (state !== "ok") throw new AppError("company_inactive", 403);
  await next();
};

/** /platform: only Telegram ids listed in OWNER_TELEGRAM_IDS. */
export const requirePlatform: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!c.get("actor").platform) throw new AppError("forbidden", 403);
  await next();
};

export async function body<T = Record<string, unknown>>(c: Ctx): Promise<T> {
  try {
    const data = await c.req.json();
    if (!data || typeof data !== "object") throw new Error();
    return data as T;
  } catch {
    throw badRequest("bad_json");
  }
}

export function intParam(value: string | undefined, code = "bad_id"): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw badRequest(code);
  return n;
}
