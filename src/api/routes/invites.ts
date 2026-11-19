import { Hono } from "hono";
import { acceptInvite, previewInvite } from "../../invites/service.ts";
import { badRequest } from "../../lib/errors.ts";
import { body, type AppEnv } from "../context.ts";

export const inviteRoutes = new Hono<AppEnv>();

function token(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9]{10,40}$/.test(value)) throw badRequest("invite_invalid");
  return value;
}

inviteRoutes.get("/preview", async (c) => c.json(await previewInvite(token(c.req.query("token")), c.get("user").id)));

inviteRoutes.post("/accept", async (c) => {
  const b = await body<{ token?: string }>(c);
  return c.json(await acceptInvite(token(b.token), c.get("user").id));
});
