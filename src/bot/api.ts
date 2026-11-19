// Sending messages and files from anywhere on the server.
// A failed send is reported back, never thrown, so one bad chat never stops the others.

import { Api, GrammyError, InputFile } from "grammy";
import { db } from "../lib/db.ts";
import { env, logError } from "../lib/env.ts";

let api: Api | undefined;

export function telegram(): Api {
  if (!api) api = new Api(env.botToken);
  return api;
}

export type SendResult = "ok" | "blocked" | "failed";

async function handleFailure(chatId: bigint | number, err: unknown): Promise<SendResult> {
  if (err instanceof GrammyError && (err.error_code === 403 || /chat not found/i.test(err.description))) {
    await db()
      .user.updateMany({ where: { telegramId: BigInt(chatId) }, data: { botBlocked: true } })
      .catch(() => undefined);
    return "blocked";
  }
  logError("telegram send", err);
  return "failed";
}

export async function sendText(
  chatId: bigint | number,
  text: string,
  extra: Parameters<Api["sendMessage"]>[2] = {},
): Promise<SendResult> {
  try {
    await telegram().sendMessage(Number(chatId), text, extra);
    return "ok";
  } catch (err) {
    return handleFailure(chatId, err);
  }
}

export async function sendFile(
  chatId: bigint | number,
  data: Uint8Array,
  filename: string,
  caption?: string,
): Promise<SendResult> {
  try {
    await telegram().sendDocument(Number(chatId), new InputFile(data, filename), caption ? { caption } : {});
    return "ok";
  } catch (err) {
    return handleFailure(chatId, err);
  }
}

/** Inline keyboard with one button that opens the Mini App. */
export function openAppKeyboard(label: string, url: string) {
  return { inline_keyboard: [[{ text: label, web_app: { url } }]] };
}
