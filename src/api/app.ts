// The HTTP API. Route files only read input, check permissions and call the modules in src/.

import { Hono, type MiddlewareHandler } from "hono";
import { isStaff } from "../auth/permissions.ts";
import { AppError, forbidden } from "../lib/errors.ts";
import { logError } from "../lib/env.ts";
import { requireTelegram, type AppEnv } from "./context.ts";
import { branchRoutes } from "./routes/branches.ts";
import { inviteRoutes } from "./routes/invites.ts";
import { meRoutes } from "./routes/me.ts";
import { publicRoutes } from "./routes/public.ts";

const requireStaff: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!isStaff(c.get("actor"))) throw forbidden();
  await next();
};

export function createApp() {
  const app = new Hono<AppEnv>().basePath("/api");

  app.onError((err, c) => {
    if (err instanceof AppError) return c.json({ error: err.code, params: err.params }, err.status as 400);
    logError("api", err);
    return c.json({ error: "server_error" }, 500);
  });
  app.notFound((c) => c.json({ error: "not_found" }, 404));

  app.get("/health", (c) => c.json({ ok: true }));
  // No Telegram login: the tablet page and signed download links check their own keys.
  app.route("/", publicRoutes);

  // Everything below needs a valid Telegram initData.
  for (const prefix of ["/me", "/invites", "/admin"]) {
    app.use(prefix, requireTelegram);
    app.use(`${prefix}/*`, requireTelegram);
  }
  app.use("/admin/*", requireStaff);

  app.route("/me", meRoutes);
  app.route("/invites", inviteRoutes);
  app.route("/admin", branchRoutes);

  return app;
}

export const app = createApp();
