import { Hono } from "hono";
import { sendFile } from "../../bot/api.ts";
import { AppError, badRequest } from "../../lib/errors.ts";
import { signedUrl } from "../../lib/signedUrl.ts";
import { dashboard, monthReport, monthTable, reviewList, yearReport } from "../../reports/admin.ts";
import { buildExport, type ExportFormat, type ExportKind } from "../../reports/exports.ts";
import { t } from "../../i18n/index.ts";
import { canManageWorker, ensure } from "../../auth/permissions.ts";
import { db } from "../../lib/db.ts";
import { isValidMonth } from "../../shared/time.ts";
import { workerMonth } from "../../reports/worker.ts";
import { getCompany, updateCompany } from "../../users/company.ts";
import { body, intParam, type AppEnv } from "../context.ts";

export const reportRoutes = new Hono<AppEnv>();

const optId = (v: string | undefined) => (v ? intParam(v) : undefined);

reportRoutes.get("/dashboard", async (c) => c.json(await dashboard(c.get("actor"), optId(c.req.query("branchId")))));
reportRoutes.get("/reports/month", async (c) =>
  c.json(await monthReport(c.get("actor"), c.req.query("month") ?? "", optId(c.req.query("branchId")), optId(c.req.query("userId")))),
);
reportRoutes.get("/reports/table", async (c) =>
  c.json(await monthTable(c.get("actor"), c.req.query("month") ?? "", intParam(c.req.query("branchId")))),
);
reportRoutes.get("/reports/year", async (c) =>
  c.json(await yearReport(c.get("actor"), Number(c.req.query("year")), optId(c.req.query("branchId")), optId(c.req.query("userId")))),
);
reportRoutes.get("/reports/worker-days", async (c) => {
  const userId = intParam(c.req.query("userId"));
  const month = c.req.query("month") ?? "";
  if (!isValidMonth(month)) throw badRequest();
  const rows = await db().branchMember.findMany({ where: { userId }, select: { branchId: true } });
  ensure(canManageWorker(c.get("actor"), rows.map((r) => r.branchId)));
  return c.json(await workerMonth(userId, month));
});
reportRoutes.get("/company", async (c) => c.json(await getCompany(c.get("actor"))));
reportRoutes.patch("/company", async (c) => c.json(await updateCompany(c.get("actor"), await body(c))));
reportRoutes.get("/review", async (c) => c.json(await reviewList(c.get("actor"))));

/** The bot sends the file to the admin's chat; a signed link is returned for downloadFile. */
reportRoutes.post("/exports", async (c) => {
  const actor = c.get("actor");
  const user = c.get("user");
  const b = await body<{ kind?: ExportKind; format?: ExportFormat; month?: string; branchId?: number }>(c);
  if (!b.kind || !b.format || !b.month) throw badRequest();
  const branchId = b.branchId ? intParam(String(b.branchId)) : undefined;
  const file = await buildExport(actor, b.kind, b.format, b.month, branchId, user.language);
  const sent = await sendFile(user.telegramId, file.data, file.filename, t(user.language, "file.export_caption", { title: file.title, period: b.month }));
  if (sent !== "ok") throw new AppError("send_failed", 400);
  const url = signedUrl("export", { u: String(user.id), k: b.kind, f: b.format, m: b.month, ...(branchId ? { b: String(branchId) } : {}) });
  return c.json({ sent: true, url, filename: file.filename });
});
