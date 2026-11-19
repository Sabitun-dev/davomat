import { Hono } from "hono";
import { sendText } from "../../bot/api.ts";
import { t } from "../../i18n/index.ts";
import { botUsername } from "../../lib/appConfig.ts";
import { db } from "../../lib/db.ts";
import { ensureCompany, updateProfile } from "../../users/service.ts";
import { body, type AppEnv } from "../context.ts";
import type { User } from "../../generated/prisma/client.ts";
import type { Actor } from "../../auth/permissions.ts";

export const meRoutes = new Hono<AppEnv>();

export async function mePayload(user: User, actor: Actor, startParam: string | null) {
  const company = await ensureCompany();
  const branches = await db().branch.findMany({
    where: { id: { in: actor.memberBranchIds } },
    select: { id: true, name: true, timezone: true },
    orderBy: { name: "asc" },
  });
  return {
    user: {
      id: user.id,
      telegramName: [user.firstName, user.lastName].filter(Boolean).join(" "),
      fullName: user.fullName,
      phone: user.phone,
      language: user.language,
      introSeen: user.introSeen,
      writeAccess: user.writeAccess,
    },
    needs: {
      consent: !user.consentAt,
      phone: !user.phone,
      name: !user.nameConfirmedAt,
    },
    role: actor.role,
    isStaff: actor.role === "OWNER" || actor.role === "ADMIN",
    company: { id: company.id, name: company.name, currency: company.currency },
    branches,
    adminBranchIds: actor.adminBranchIds,
    startParam,
    botUsername: await botUsername(),
  };
}

meRoutes.get("/", async (c) => c.json(await mePayload(c.get("user"), c.get("actor"), c.get("init").startParam)));

// Fallback for old Telegram apps without requestContact: the bot sends a "share phone" button.
meRoutes.post("/request-phone", async (c) => {
  const user = c.get("user");
  const result = await sendText(user.telegramId, t(user.language, "bot.share_phone_prompt"), {
    reply_markup: {
      keyboard: [[{ text: t(user.language, "bot.share_phone_button"), request_contact: true }]],
      resize_keyboard: true,
      one_time_keyboard: true,
    },
  });
  return c.json({ sent: result === "ok" });
});

meRoutes.post("/", async (c) => {
  const b = await body<{
    consent?: boolean;
    fullName?: string;
    language?: string;
    introSeen?: string;
    writeAccess?: boolean;
  }>(c);
  const user = await updateProfile(c.get("user").id, {
    consent: b.consent === true,
    fullName: b.fullName,
    language: b.language,
    introSeen: b.introSeen,
    writeAccess: typeof b.writeAccess === "boolean" ? b.writeAccess : undefined,
  });
  return c.json(await mePayload(user, c.get("actor"), c.get("init").startParam));
});
