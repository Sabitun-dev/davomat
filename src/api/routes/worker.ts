import { Hono } from "hono";
import { recordAttempt } from "../../attendance/service.ts";
import { AppError, badRequest } from "../../lib/errors.ts";
import { isValidDate, isValidMonth } from "../../shared/time.ts";
import { dayDetail, workerHistory, workerMonth, workerToday } from "../../reports/worker.ts";
import { body, type AppEnv } from "../context.ts";

export const workerRoutes = new Hono<AppEnv>();

workerRoutes.post("/attendance", async (c) => {
  const actor = c.get("actor");
  if (actor.companyId === null || actor.memberBranchIds.length === 0) throw new AppError("not_member", 403);
  const result = await recordAttempt(c.get("user"), actor.companyId, await body(c), {
    userAgent: c.req.header("user-agent"),
  });
  return c.json(result);
});

workerRoutes.get("/today", async (c) => {
  const branchId = Number(c.req.query("branchId")) || undefined;
  return c.json(await workerToday(c.get("user").id, branchId));
});

workerRoutes.get("/month", async (c) => {
  const month = c.req.query("month") ?? "";
  if (!isValidMonth(month)) throw badRequest();
  return c.json(await workerMonth(c.get("user").id, month));
});

workerRoutes.get("/history", async (c) => {
  const before = c.req.query("before");
  if (before && !isValidDate(before)) throw badRequest();
  return c.json(await workerHistory(c.get("user").id, before));
});

workerRoutes.get("/day", async (c) => {
  const date = c.req.query("date") ?? "";
  if (!isValidDate(date)) throw badRequest();
  return c.json(await dayDetail(c.get("user").id, date, { admin: false }));
});
