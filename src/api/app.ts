// The HTTP API. Route files only read input, check permissions and call the modules in src/.

import { Hono } from "hono";
import { AppError } from "../lib/errors.ts";
import { logError } from "../lib/env.ts";
import { requireTelegram, type AppEnv } from "./context.ts";
import { meRoutes } from "./routes/me.ts";

export function createApp() {
  const app = new Hono<AppEnv>().basePath("/api");

  app.onError((err, c) => {
    if (err instanceof AppError) return c.json({ error: err.code, params: err.params }, err.status as 400);
    logError("api", err);
    return c.json({ error: "server_error" }, 500);
  });
  app.notFound((c) => c.json({ error: "not_found" }, 404));

  app.get("/health", (c) => c.json({ ok: true }));

  // Everything below needs a valid Telegram initData.
  app.use("/me/*", requireTelegram);
  app.use("/me", requireTelegram);
  app.route("/me", meRoutes);

  return app;
}

export const app = createApp();
