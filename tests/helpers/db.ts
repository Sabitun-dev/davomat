// A real Postgres in memory (PGlite) with the real migrations, for integration tests.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { PrismaPGlite } from "pglite-prisma-adapter";
import { PrismaClient } from "../../src/generated/prisma/client.ts";
import { setDb } from "../../src/lib/db.ts";

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

export async function createTestDb(): Promise<PrismaClient> {
  setTestEnv();
  const pg = new PGlite();
  const dir = join(process.cwd(), "prisma", "migrations");
  for (const name of readdirSync(dir).filter((n) => !n.endsWith(".toml")).sort()) {
    await pg.exec(readFileSync(join(dir, name, "migration.sql"), "utf8"));
  }
  const client = new PrismaClient({ adapter: new PrismaPGlite(pg) });
  setDb(client);
  return client;
}
