// Light, never spammy bot messages (spec 9): one per kind per chat per day, failures never stop others.

import { openAppKeyboard, sendText, telegram } from "../bot/api.ts";
import { webAppUrl } from "../lib/appConfig.ts";
import { db, isUniqueViolation } from "../lib/db.ts";
import { env, logError } from "../lib/env.ts";
import { parseSettings } from "../lib/settings.ts";
import { minuteToHHMM, toLocal } from "../shared/time.ts";
import { t, type MessageKey } from "../i18n/index.ts";

/** Claims (kind, chat, dayKey) first, then sends. A second call with the same key does nothing. */
export async function sendOnce(
  kind: string,
  chatId: bigint,
  dayKey: string,
  send: () => Promise<"ok" | "blocked" | "failed">,
): Promise<boolean> {
  try {
    await db().notificationSent.create({ data: { kind, chatId, dayKey } });
  } catch (err) {
    if (isUniqueViolation(err)) return false;
    throw err;
  }
  let result: "ok" | "blocked" | "failed" = "failed";
  try {
    result = await send();
  } catch (err) {
    logError(`notify ${kind}`, err);
  }
  if (result !== "ok") await db().notificationSent.updateMany({ where: { kind, chatId, dayKey }, data: { ok: false } });
  return result === "ok";
}

export async function remindWorker(user: { telegramId: bigint; language: string }, kind: "remind.check_in" | "remind.check_out", date: string) {
  return sendOnce(kind, user.telegramId, date, () =>
    sendText(user.telegramId, t(user.language, kind), { reply_markup: openAppKeyboard(t(user.language, "bot.open"), webAppUrl()) }),
  );
}

/** Optional reply under the group video: "✅ Keldi 09:07 · Filial X · 12 m · 7 daq kechikdi". */
export async function replyUnderVideo(eventId: number): Promise<void> {
  try {
    const video = await db().videoNote.findUnique({
      where: { linkedEventId: eventId },
      include: { linkedEvent: { include: { branch: true, user: { select: { language: true } } } } },
    });
    const event = video?.linkedEvent;
    if (!video || !event?.branch) return;
    const company = await db().company.findUniqueOrThrow({ where: { id: event.companyId } });
    if (!parseSettings(company.settings).botReplyUnderVideo) return;
    // The group is shared, so it gets the installation language.
    const lang = env.defaultLanguage;
    let late = "";
    if (event.type === "CHECK_IN") {
      const r = await db().dailyResult.findUnique({ where: { userId_date: { userId: event.userId, date: event.localDate } } });
      if (r && r.lateMin > 0) late = t(lang, "video.reply_late", { min: r.lateMin });
    }
    const text = t(lang, "video.reply", {
      event: t(lang, `event.${event.type}` as MessageKey),
      time: minuteToHHMM(toLocal(event.serverTime, event.branch.timezone).minute),
      branch: event.branch.name,
      distance: event.distanceM ?? 0,
      late,
    });
    // In a forum the reply stays in the video's topic.
    await telegram().sendMessage(Number(video.chatId), text, {
      reply_parameters: { message_id: video.messageId, allow_sending_without_reply: true },
      ...(video.threadId ? { message_thread_id: video.threadId } : {}),
    });
  } catch (err) {
    logError("video reply", err);
  }
}
