// A real Postgres in memory (PGlite) with the real migrations, for integration tests.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { PrismaPGlite } from "pglite-prisma-adapter";
import { PrismaClient } from "../../src/generated/prisma/client.ts";
import { setDb } from "../../src/lib/db.ts";
import { setTelegram } from "../../src/bot/api.ts";
import type { Api } from "grammy";

export const TEST_BOT_TOKEN = "123456:TEST-token-for-unit-tests-only-abcdefghijk";

export function setTestEnv(): void {
  process.env.BOT_TOKEN = TEST_BOT_TOKEN;
  process.env.QR_SIGNING_SECRET = "test-qr-secret-0123456789-0123456789-abcdef";
  process.env.WEBHOOK_SECRET = "test-webhook-secret-0123456789-0123456789";
  process.env.SETUP_SECRET = "test-setup-secret-0123456789-0123456789";
  process.env.OWNER_TELEGRAM_IDS = "1000";
  process.env.DEFAULT_TIMEZONE = "Asia/Tashkent";
  process.env.BOT_USERNAME = "davomat_test_bot";
  process.env.APP_URL = "https://davomat.example";
  delete process.env.GROUP_CHAT_ID;
}

/** Every message the bot "sent" during a test. */
export const sent: { method: string; chatId: number; text?: string; filename?: string; replyTo?: number; threadId?: number }[] = [];

function fakeTelegram() {
  return {
    sendMessage: async (chatId: number, text: string, extra?: { reply_parameters?: { message_id: number }; message_thread_id?: number }) => {
      sent.push({ method: "sendMessage", chatId, text, replyTo: extra?.reply_parameters?.message_id, threadId: extra?.message_thread_id });
      return { message_id: sent.length };
    },
    sendDocument: async (chatId: number, file: { filename?: string }) => {
      sent.push({ method: "sendDocument", chatId, filename: file.filename });
      return { message_id: sent.length };
    },
  } as unknown as Api;
}

export async function createTestDb(): Promise<PrismaClient> {
  setTestEnv();
  setTelegram(fakeTelegram());
  const pg = new PGlite();
  const dir = join(process.cwd(), "prisma", "migrations");
  for (const name of readdirSync(dir).filter((n) => !n.endsWith(".toml")).sort()) {
    await pg.exec(readFileSync(join(dir, name, "migration.sql"), "utf8"));
  }
  const client = new PrismaClient({ adapter: new PrismaPGlite(pg) });
  setDb(client);
  return client;
}
