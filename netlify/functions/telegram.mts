// Telegram webhook. Telegram sends WEBHOOK_SECRET in a header; anything else is refused.
import type { Config } from "@netlify/functions";
import { webhookCallback } from "grammy";
import { getBot } from "../../src/bot/bot.ts";
import { safeEqual } from "../../src/lib/crypto.ts";
import { env, logError } from "../../src/lib/env.ts";

export default async (req: Request) => {
  if (req.method !== "POST") return new Response("ok");
  const secret = req.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!safeEqual(secret, env.webhookSecret)) return new Response("forbidden", { status: 403 });
  try {
    const bot = await getBot();
    return await webhookCallback(bot, "std/http", { timeoutMilliseconds: 9000 })(req);
  } catch (err) {
    logError("webhook", err);
    // Answer 200 so Telegram does not resend the same update forever.
    return new Response("ok");
  }
};

export const config: Config = { path: "/telegram/webhook" };
