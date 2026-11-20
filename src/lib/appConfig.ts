// Small installation-wide values saved by the setup page (for example the bot username).

import { db } from "./db.ts";
import { env } from "./env.ts";

const cache = new Map<string, string | null>();

export async function getConfig(key: string): Promise<string | null> {
  if (cache.has(key)) return cache.get(key) ?? null;
  const row = await db().appConfig.findUnique({ where: { key } });
  cache.set(key, row?.value ?? null);
  return row?.value ?? null;
}

export async function setConfig(key: string, value: string): Promise<void> {
  await db().appConfig.upsert({ where: { key }, create: { key, value }, update: { value } });
  cache.set(key, value);
}

export async function botUsername(): Promise<string> {
  return env.botUsername || (await getConfig("bot_username")) || "";
}

/** https://t.me/<bot>/<app>?startapp=<param> */
export async function miniAppLink(startParam?: string): Promise<string> {
  const base = `https://t.me/${await botUsername()}/${env.miniAppShortName}`;
  return startParam ? `${base}?startapp=${encodeURIComponent(startParam)}` : base;
}

/** https://t.me/<bot>?start=<param> — always opens the bot, which answers with an "Ochish" button. */
export async function botStartLink(param: string): Promise<string> {
  return `https://t.me/${await botUsername()}?start=${encodeURIComponent(param)}`;
}

export function webAppUrl(path = ""): string {
  return `${env.appUrl}/app/${path.replace(/^\//, "")}`;
}
