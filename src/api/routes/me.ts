import { Hono } from "hono";
import { sendText } from "../../bot/api.ts";
import { t } from "../../i18n/index.ts";
import { botUsername } from "../../lib/appConfig.ts";
import { db } from "../../lib/db.ts";
import { loadActor, switchCompany, updateProfile } from "../../users/service.ts";
import { body, type AppEnv } from "../context.ts";
import type { User } from "../../generated/prisma/client.ts";
import type { Actor } from "../../auth/permissions.ts";

export const meRoutes = new Hono<AppEnv>();

export async function mePayload(user: User, actor: Actor, startParam: string | null) {
  const company = actor.companyId ? await db().company.findUnique({ where: { id: actor.companyId } }) : null;
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
    // The current company (null = none yet). Owners also see why it is blocked and until when it is paid.
    company: company
      ? {
          id: company.id,
          name: company.name,
          currency: company.currency,
          state: actor.companyState,
          paidUntil: actor.role === "OWNER" ? company.paidUntil : null,
        }
      : null,
    companies: actor.companies,
    platform: actor.platform,
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

/** Switches the current company (only to one where the user is an active member). */
meRoutes.post("/company", async (c) => {
  const b = await body<{ companyId?: number }>(c);
  await switchCompany(c.get("user").id, b.companyId);
  const user = await db().user.findUniqueOrThrow({ where: { id: c.get("user").id } });
  return c.json(await mePayload(user, await loadActor(user), c.get("init").startParam));
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
