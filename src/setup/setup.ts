// The setup page (/setup?key=SETUP_SECRET). Safe to open any number of times.
// It checks the configuration and connects the bot to Telegram. Secrets are never shown.

import { telegram } from "../bot/api.ts";
import { setConfig, webAppUrl } from "../lib/appConfig.ts";
import { db } from "../lib/db.ts";
import { env, redact } from "../lib/env.ts";
import { t } from "../i18n/index.ts";
import { ensureCompany } from "../users/service.ts";

export interface StepResult {
  name: string;
  ok: boolean;
  detail: string;
}

const REQUIRED_VARS = [
  "BOT_TOKEN",
  "WEBHOOK_SECRET",
  "SETUP_SECRET",
  "QR_SIGNING_SECRET",
  "DATABASE_URL",
  "GROUP_CHAT_ID",
  "OWNER_TELEGRAM_IDS",
];

async function step(results: StepResult[], name: string, work: () => Promise<string>): Promise<boolean> {
  try {
    results.push({ name, ok: true, detail: await work() });
    return true;
  } catch (err) {
    results.push({ name, ok: false, detail: redact(err instanceof Error ? err.message : String(err)) });
    return false;
  }
}

export async function runSetup(): Promise<StepResult[]> {
  const results: StepResult[] = [];

  await step(results, "Environment variables", async () => {
    const missing = REQUIRED_VARS.filter((n) => !(process.env[n] ?? "").trim());
    for (const n of ["WEBHOOK_SECRET", "SETUP_SECRET", "QR_SIGNING_SECRET"]) {
      if ((process.env[n] ?? "").trim().length > 0 && (process.env[n] ?? "").trim().length < 32)
        missing.push(`${n} (too short, use 32+ characters)`);
    }
    if (missing.length) throw new Error(`Missing: ${missing.join(", ")}`);
    return "All required variables are set.";
  });

  const dbOk = await step(results, "Database", async () => {
    const rows = await db().$queryRawUnsafe<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }[]>(
      `SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY started_at`,
    );
    const failed = rows.filter((r) => !r.finished_at && !r.rolled_back_at);
    if (failed.length) throw new Error(`Migration failed: ${failed.map((r) => r.migration_name).join(", ")}`);
    if (!rows.length) throw new Error("No migrations applied. Redeploy on Netlify: the build applies them.");
    return `Connected. ${rows.length} migration(s) applied, latest: ${rows[rows.length - 1].migration_name}.`;
  });

  if (dbOk) {
    await step(results, "Company and owners", async () => {
      const company = await ensureCompany();
      const owners = env.ownerTelegramIds;
      for (const telegramId of owners) {
        const user = await db().user.upsert({ where: { telegramId }, create: { telegramId }, update: {} });
        await db().membership.upsert({
          where: { userId_companyId: { userId: user.id, companyId: company.id } },
          create: { userId: user.id, companyId: company.id, role: "OWNER" },
          update: { role: "OWNER", active: true },
        });
      }
      return `Company "${company.name}" (${company.currency}). Owners: ${owners.length}.`;
    });
  }

  const me = await (async () => {
    let info: Awaited<ReturnType<ReturnType<typeof telegram>["getMe"]>> | undefined;
    await step(results, "Bot token", async () => {
      info = await telegram().getMe();
      if (dbOk) {
        await setConfig("bot_username", info.username);
        await setConfig("bot_info", JSON.stringify(info));
      }
      return `Bot @${info.username} works.`;
    });
    return info;
  })();
  if (!me) return results;

  await step(results, "Webhook", async () => {
    const url = `${env.appUrl}/telegram/webhook`;
    await telegram().setWebhook(url, {
      secret_token: env.webhookSecret,
      allowed_updates: ["message", "my_chat_member"],
    });
    return `Telegram sends updates to ${url}.`;
  });

  await step(results, "Bot commands", async () => {
    for (const lang of ["uz", "ru", "en"] as const) {
      const language_code = lang === "uz" ? undefined : lang;
      await telegram().setMyCommands(
        [
          { command: "start", description: t(lang, "bot.cmd_start") },
          { command: "help", description: t(lang, "bot.cmd_help") },
        ],
        { scope: { type: "all_private_chats" }, language_code },
      );
      await telegram().setMyCommands([{ command: "groupid", description: t(lang, "bot.cmd_groupid") }], {
        scope: { type: "all_group_chats" },
        language_code,
      });
    }
    return "/start, /help in private chats; /groupid in groups.";
  });

  await step(results, "Menu button", async () => {
    await telegram().setChatMenuButton({
      menu_button: { type: "web_app", text: "Ochish", web_app: { url: webAppUrl() } },
    });
    return `"Ochish" opens ${webAppUrl()}.`;
  });

  await step(results, "Group", async () => {
    const groupId = env.groupChatId;
    if (groupId === null) throw new Error("GROUP_CHAT_ID is not set. Add the bot to the group and send /groupid there.");
    const chat = await telegram().getChat(Number(groupId));
    const member = await telegram().getChatMember(Number(groupId), me.id);
    const isAdmin = member.status === "administrator";
    if (!isAdmin && !me.can_read_all_group_messages) {
      throw new Error(
        "The bot cannot see videos in the group. Make the bot a group admin, or in @BotFather: /setprivacy -> Disable, then remove and re-add the bot.",
      );
    }
    const title = "title" in chat ? chat.title : String(groupId);
    return `"${title}": the bot can see group videos (${isAdmin ? "admin" : "privacy mode off"}).`;
  });

  return results;
}

function escape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function renderSetupPage(results: StepResult[] | null, message?: string): string {
  const rows = (results ?? [])
    .map(
      (r) =>
        `<li class="${r.ok ? "ok" : "bad"}"><b>${r.ok ? "✅" : "❌"} ${escape(r.name)}</b><span>${escape(r.detail)}</span></li>`,
    )
    .join("");
  const allOk = results?.every((r) => r.ok);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Davomat setup</title><style>
body{font:16px/1.5 system-ui,sans-serif;margin:0;padding:24px;background:#f5f4fa;color:#1c1b22}
main{max-width:640px;margin:auto}h1{font-size:26px}ul{list-style:none;padding:0}
li{background:#fff;border-radius:16px;padding:14px 16px;margin:10px 0;box-shadow:0 1px 3px #0001;display:flex;flex-direction:column;gap:4px}
li.bad{border-left:4px solid #d93025}li.ok{border-left:4px solid #1e8e3e}span{color:#55536a;font-size:15px}
.big{font-size:20px;font-weight:600}
@media (prefers-color-scheme:dark){body{background:#141318;color:#eee}li{background:#1f1e25}span{color:#aaa}}
</style></head><body><main><h1>Davomat setup</h1>
${message ? `<p class="big">${escape(message)}</p>` : ""}
${results ? `<p class="big">${allOk ? "✅ Everything is ready." : "Fix the red items, then open this page again."}</p><ul>${rows}</ul>` : ""}
<p>Opening this page again is always safe.</p></main></body></html>`;
}
