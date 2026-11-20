// The Telegram bot (grammY). Runs behind the webhook in netlify/functions/telegram.mts.

import { Bot, type Context } from "grammy";
import type { UserFromGetMe } from "grammy/types";
import { getConfig, webAppUrl } from "../lib/appConfig.ts";
import { db, isUniqueViolation } from "../lib/db.ts";
import { env, logError } from "../lib/env.ts";
import { t } from "../i18n/index.ts";
import { pickLanguage, savePhoneFromContact } from "../users/service.ts";
import { onGroupVideoNote } from "../video/service.ts";
import { replyUnderVideo } from "../jobs/notify.ts";
import { openAppKeyboard } from "./api.ts";

async function languageOf(ctx: Context): Promise<string> {
  if (!ctx.from) return env.defaultLanguage;
  const user = await db().user.findUnique({ where: { telegramId: BigInt(ctx.from.id) }, select: { language: true } });
  return user?.language ?? pickLanguage(ctx.from.language_code);
}

export function createBot(botInfo?: UserFromGetMe): Bot {
  const bot = new Bot(env.botToken, botInfo ? { botInfo } : {});

  // Telegram may deliver the same update twice; handle each one only once.
  bot.use(async (ctx, next) => {
    try {
      await db().processedUpdate.create({ data: { updateId: BigInt(ctx.update.update_id) } });
    } catch (err) {
      if (isUniqueViolation(err)) return;
      throw err;
    }
    await next();
  });

  bot.command("start", async (ctx) => {
    if (ctx.chat.type !== "private") return;
    const lang = await languageOf(ctx);
    // An invite link (t.me/<bot>?start=inv_...) opens here: the button carries the invite into the app.
    const payload = typeof ctx.match === "string" && /^inv_[A-Za-z0-9]{10,40}$/.test(ctx.match) ? ctx.match : null;
    await ctx.reply(t(lang, payload ? "bot.start_invite" : "bot.start", { name: ctx.from?.first_name ?? "" }), {
      reply_markup: openAppKeyboard(t(lang, "bot.open"), webAppUrl(payload ? `?startapp=${payload}` : "")),
    });
  });

  bot.command("help", async (ctx) => {
    const lang = await languageOf(ctx);
    await ctx.reply(t(lang, "bot.help"));
  });

  bot.command("groupid", async (ctx) => {
    const lang = await languageOf(ctx);
    if (ctx.chat.type === "private") return void (await ctx.reply(t(lang, "bot.groupid_private")));
    await ctx.reply(t(lang, "bot.groupid", { id: String(ctx.chat.id) }));
  });

  // The phone number arrives as a contact message after the Mini App calls requestContact.
  bot.on("message:contact", async (ctx) => {
    if (ctx.chat.type !== "private" || !ctx.from) return;
    const c = ctx.message.contact;
    const ok = await savePhoneFromContact({
      fromId: ctx.from.id,
      contactUserId: c.user_id,
      phone: c.phone_number,
      firstName: ctx.from.first_name,
      lastName: ctx.from.last_name,
      username: ctx.from.username,
      languageCode: ctx.from.language_code,
    });
    const lang = await languageOf(ctx);
    await ctx.reply(t(lang, ok ? "bot.phone_saved" : "bot.phone_not_yours"), {
      reply_markup: ok ? { remove_keyboard: true } : undefined,
    });
  });

  bot.on("message:video_note", async (ctx) => {
    if (ctx.chat.type === "private" || !ctx.from) return;
    const groupId = env.groupChatId;
    if (groupId === null || BigInt(ctx.chat.id) !== groupId) return;
    const linked = await onGroupVideoNote({
      chatId: BigInt(ctx.chat.id),
      messageId: ctx.message.message_id,
      fromTelegramId: BigInt(ctx.from.id),
      sentAt: new Date(ctx.message.date * 1000),
    });
    if (linked?.linkedEvent) await replyUnderVideo(linked.linkedEvent.id);
  });

  // The user blocked or unblocked the bot.
  bot.on("my_chat_member", async (ctx) => {
    if (ctx.chat.type !== "private") return;
    const status = ctx.myChatMember.new_chat_member.status;
    await db().user.updateMany({
      where: { telegramId: BigInt(ctx.chat.id) },
      data: { botBlocked: status === "kicked" },
    });
  });

  bot.catch((err) => logError("bot", err.error));
  return bot;
}

let cached: Bot | undefined;

/** One bot per warm function instance. botInfo is saved by the setup page to skip getMe. */
export async function getBot(): Promise<Bot> {
  if (cached) return cached;
  const saved = await getConfig("bot_info");
  const bot = createBot(saved ? (JSON.parse(saved) as UserFromGetMe) : undefined);
  if (!saved) await bot.init();
  cached = bot;
  return bot;
}
