// Admin: schedules, daily amounts, corrections, month lock, bonuses and fines.

import { Hono } from "hono";
import { canManageWorker, ensure, managedBranchIds } from "../../auth/permissions.ts";
import { db } from "../../lib/db.ts";
import { badRequest } from "../../lib/errors.ts";
import { isValidDate } from "../../shared/time.ts";
import { amountGrid, bulkFill, setAmounts } from "../../pay/amounts.ts";
import { addEvent, editEvent, reviewDay, voidEvent } from "../../pay/corrections.ts";
import { addAdjustment, listAdjustments, lockMonth, monthStatus, recalcMonth, unlockMonth, voidAdjustment } from "../../pay/months.ts";
import { dayDetail } from "../../reports/worker.ts";
import { clearDay, copyPreviousMonth, getSchedule, putDay, putWeek } from "../../schedule/service.ts";
import { body, intParam, type AppEnv } from "../context.ts";

export const payRoutes = new Hono<AppEnv>();

const optUser = (v: unknown): number | null => (v === undefined || v === null || v === "" ? null : intParam(String(v)));

payRoutes.get("/branches/:id/schedule", async (c) =>
  c.json(await getSchedule(c.get("actor"), intParam(c.req.param("id")), c.req.query("month") ?? "", optUser(c.req.query("userId")))),
);
payRoutes.put("/branches/:id/schedule/week", async (c) => {
  const b = await body<{ userId?: number | null; week?: unknown }>(c);
  await putWeek(c.get("actor"), intParam(c.req.param("id")), optUser(b.userId), b.week ?? null);
  return c.json({ ok: true });
});
payRoutes.put("/branches/:id/schedule/day", async (c) => {
  const b = await body<{ userId?: number | null; date?: string }>(c);
  await putDay(c.get("actor"), intParam(c.req.param("id")), optUser(b.userId), String(b.date ?? ""), b);
  return c.json({ ok: true });
});
payRoutes.delete("/branches/:id/schedule/day", async (c) => {
  await clearDay(c.get("actor"), intParam(c.req.param("id")), optUser(c.req.query("userId")), c.req.query("date") ?? "");
  return c.json({ ok: true });
});
payRoutes.post("/branches/:id/schedule/copy", async (c) => {
  const b = await body<{ userId?: number | null; month?: string }>(c);
  await copyPreviousMonth(c.get("actor"), intParam(c.req.param("id")), optUser(b.userId), String(b.month ?? ""));
  return c.json({ ok: true });
});

payRoutes.get("/branches/:id/amounts", async (c) =>
  c.json(await amountGrid(c.get("actor"), intParam(c.req.param("id")), c.req.query("month") ?? "")),
);
payRoutes.put("/branches/:id/amounts", async (c) => {
  const b = await body<{ cells?: unknown }>(c);
  await setAmounts(c.get("actor"), intParam(c.req.param("id")), b.cells);
  return c.json({ ok: true });
});
payRoutes.post("/branches/:id/amounts/bulk", async (c) => {
  const b = await body<{ month?: string; userIds?: unknown; amount?: unknown }>(c);
  return c.json(await bulkFill(c.get("actor"), intParam(c.req.param("id")), String(b.month ?? ""), b.userIds, b.amount));
});

payRoutes.get("/day", async (c) => {
  const userId = intParam(c.req.query("userId"));
  const date = c.req.query("date") ?? "";
  if (!isValidDate(date)) throw badRequest();
  const rows = await db().branchMember.findMany({ where: { userId }, select: { branchId: true } });
  ensure(canManageWorker(c.get("actor"), rows.map((r) => r.branchId)));
  return c.json(await dayDetail(userId, date, { admin: true, branchIds: managedBranchIds(c.get("actor")) }));
});
payRoutes.post("/events", async (c) => c.json(await addEvent(c.get("actor"), await body(c))));
payRoutes.patch("/events/:id", async (c) => c.json(await editEvent(c.get("actor"), intParam(c.req.param("id")), await body(c))));
payRoutes.post("/events/:id/void", async (c) => c.json(await voidEvent(c.get("actor"), intParam(c.req.param("id")), await body(c))));
payRoutes.post("/day/review", async (c) => {
  const b = await body<{ userId?: number; date?: string; comment?: string; manualEarned?: number | null }>(c);
  return c.json(await reviewDay(c.get("actor"), intParam(String(b.userId)), String(b.date ?? ""), b));
});

payRoutes.get("/months/:month", async (c) => c.json(await monthStatus(c.get("actor"), c.req.param("month"))));
payRoutes.post("/months/:month/lock", async (c) => {
  await lockMonth(c.get("actor"), c.req.param("month"));
  return c.json({ ok: true });
});
payRoutes.post("/months/:month/unlock", async (c) => {
  const b = await body<{ comment?: string }>(c);
  await unlockMonth(c.get("actor"), c.req.param("month"), b.comment);
  return c.json({ ok: true });
});
payRoutes.post("/months/:month/recalc", async (c) => {
  const b = await body<{ branchId?: number }>(c);
  await recalcMonth(c.get("actor"), c.req.param("month"), b.branchId ? intParam(String(b.branchId)) : undefined);
  return c.json({ ok: true });
});

payRoutes.get("/adjustments", async (c) =>
  c.json(await listAdjustments(c.get("actor"), c.req.query("month") ?? "", c.req.query("userId") ? intParam(c.req.query("userId")) : undefined)),
);
payRoutes.post("/adjustments", async (c) => c.json(await addAdjustment(c.get("actor"), await body(c))));
payRoutes.delete("/adjustments/:id", async (c) => {
  await voidAdjustment(c.get("actor"), intParam(c.req.param("id")));
  return c.json({ ok: true });
});
