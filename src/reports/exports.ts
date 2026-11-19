// Payroll and attendance exports as XLSX / CSV, and monthly payroll as PDF (spec 8).

import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { visibleBranchIds, type Actor } from "../auth/permissions.ts";
import { db } from "../lib/db.ts";
import { badRequest, forbidden } from "../lib/errors.ts";
import { loadFont } from "../lib/fonts.ts";
import { formatMoney, type Currency } from "../shared/money.ts";
import { isValidMonth, minuteToHHMM, toLocal } from "../shared/time.ts";
import { t, type MessageKey } from "../i18n/index.ts";
import { finalEarned } from "../pay/recalc.ts";
import { displayName } from "../users/service.ts";
import { monthReport } from "./admin.ts";
import { buildCsv, buildXlsx, type Cell } from "./xlsx.ts";

export type ExportKind = "payroll" | "attendance";
export type ExportFormat = "xlsx" | "csv" | "pdf";

export interface ExportFile {
  data: Uint8Array;
  filename: string;
  type: string;
  title: string;
}

/** Money as a plain number for spreadsheets: so'm as is, dollars with cents. */
const num = (amount: number, currency: Currency) => (currency === "USD" ? amount / 100 : amount);
const hours = (min: number) => Math.round((min / 60) * 100) / 100;

async function payrollTable(actor: Actor, month: string, branchId: number | undefined, lang: string) {
  const r = await monthReport(actor, month, branchId);
  const c = r.currency;
  const header = [
    "col.worker", "col.branch", "col.position", "col.days_worked", "col.absent", "col.times_late", "col.late_min",
    "col.early_min", "col.overage_min", "col.overtime_min", "col.worked_hours", "col.earned", "col.max", "col.bonus", "col.fine", "col.salary",
  ].map((k) => t(lang, k as MessageKey));
  const rows: Cell[][] = r.rows.map((w) => [
    w.name, w.branchName, w.position, w.daysWorked, w.absent, w.timesLate, w.lateMin, w.earlyMin, w.overageMin, w.overtimeMin,
    hours(w.workedMin), num(w.earned, c), num(w.max, c), num(w.bonus, c), num(w.fine, c), num(w.salary, c),
  ]);
  const s = r.company;
  rows.push([
    t(lang, "col.total"), "", "", s.daysWorked, s.absent, s.timesLate, s.lateMin, s.earlyMin, s.overageMin, s.overtimeMin,
    hours(s.workedMin), num(s.earned, c), num(s.max, c), num(s.bonus, c), num(s.fine, c), num(s.salary, c),
  ]);
  return { header, rows, report: r };
}

async function attendanceTable(actor: Actor, month: string, branchId: number | undefined, lang: string) {
  const all = await db().branch.findMany({ where: { companyId: actor.companyId! } });
  const visible = visibleBranchIds(actor, all.map((b) => b.id));
  if (branchId && !visible.includes(branchId)) throw forbidden();
  const ids = branchId ? [branchId] : visible;
  const company = await db().company.findUniqueOrThrow({ where: { id: actor.companyId! } });
  const results = await db().dailyResult.findMany({
    where: { branchId: { in: ids }, date: { startsWith: month } },
    include: { user: { select: { fullName: true, firstName: true, lastName: true } }, branch: { select: { name: true, timezone: true } } },
    orderBy: [{ date: "asc" }, { userId: "asc" }],
  });
  const header = [
    "col.date", "col.worker", "col.branch", "col.status", "col.check_in", "col.check_out", "col.break", "col.late_min",
    "col.early_min", "col.overage_min", "col.overtime_min", "col.worked_min", "col.amount", "col.earned", "col.flags",
  ].map((k) => t(lang, k as MessageKey));
  const time = (d: Date | null, tz: string) => (d ? minuteToHHMM(toLocal(d, tz).minute) : "");
  const rows: Cell[][] = results.map((r) => [
    r.date, displayName(r.user), r.branch.name, t(lang, `status.${r.status}` as MessageKey), time(r.checkInAt, r.branch.timezone),
    time(r.checkOutAt, r.branch.timezone), r.breakMin, r.lateMin, r.earlyMin, r.overageMin, r.overtimeMin, r.workedMin,
    r.amount === null ? null : num(r.amount, company.currency), num(finalEarned(r), company.currency), r.flags.join(" "),
  ]);
  return { header, rows };
}

async function payrollPdf(actor: Actor, month: string, branchId: number | undefined, lang: string): Promise<Uint8Array> {
  const { report } = await payrollTable(actor, month, branchId, lang);
  const c = report.currency;
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(loadFont(false), { subset: true });
  const bold = await pdf.embedFont(loadFont(true), { subset: true });
  const W = 841.89;
  const H = 595.28;
  const cols: { key: string; w: number; right?: boolean }[] = [
    { key: "col.worker", w: 150 }, { key: "col.branch", w: 100 }, { key: "col.days_worked", w: 50, right: true },
    { key: "col.times_late", w: 50, right: true }, { key: "col.late_min", w: 55, right: true }, { key: "col.worked_hours", w: 55, right: true },
    { key: "col.earned", w: 85, right: true }, { key: "col.bonus", w: 70, right: true }, { key: "col.fine", w: 70, right: true },
    { key: "col.salary", w: 90, right: true },
  ];
  const money = (n: number) => formatMoney(n, c, lang).replace(/ /g, " ");
  let page = pdf.addPage([W, H]);
  let y = H - 50;
  const ink = rgb(0.1, 0.1, 0.12);
  const fit = (text: string, f: typeof font, size: number, width: number) => {
    let s = text;
    while (s.length > 1 && f.widthOfTextAtSize(s, size) > width - 6) s = s.slice(0, -2) + "…";
    return s;
  };
  const header = () => {
    page.drawText(`${t(lang, "export.payroll")} · ${month}`, { x: 40, y, size: 18, font: bold, color: ink });
    page.drawText(t(lang, "pdf.generated", { date: new Date().toISOString().slice(0, 10) }), { x: W - 200, y, size: 9, font, color: rgb(0.45, 0.45, 0.5) });
    y -= 28;
    let x = 40;
    page.drawRectangle({ x: 36, y: y - 5, width: W - 72, height: 20, color: rgb(0.94, 0.93, 0.98) });
    for (const col of cols) {
      const label = fit(t(lang, col.key as MessageKey), bold, 8, col.w);
      const tw = bold.widthOfTextAtSize(label, 8);
      page.drawText(label, { x: col.right ? x + col.w - tw - 4 : x + 2, y, size: 8, font: bold, color: ink });
      x += col.w;
    }
    y -= 20;
  };
  header();
  const line = (values: string[], f = font) => {
    if (y < 50) {
      page = pdf.addPage([W, H]);
      y = H - 50;
      header();
    }
    let x = 40;
    values.forEach((v, i) => {
      const col = cols[i];
      const text = fit(v, f, 9, col.w);
      const tw = f.widthOfTextAtSize(text, 9);
      page.drawText(text, { x: col.right ? x + col.w - tw - 4 : x + 2, y, size: 9, font: f, color: ink });
      x += col.w;
    });
    page.drawLine({ start: { x: 36, y: y - 5 }, end: { x: W - 36, y: y - 5 }, thickness: 0.4, color: rgb(0.88, 0.88, 0.9) });
    y -= 18;
  };
  for (const w of report.rows) {
    line([w.name, w.branchName, String(w.daysWorked), String(w.timesLate), String(w.lateMin), String(hours(w.workedMin)), money(w.earned), money(w.bonus), money(w.fine), money(w.salary)]);
  }
  const s = report.company;
  line([t(lang, "col.total"), "", String(s.daysWorked), String(s.timesLate), String(s.lateMin), String(hours(s.workedMin)), money(s.earned), money(s.bonus), money(s.fine), money(s.salary)], bold);
  return pdf.save();
}

export async function buildExport(actor: Actor, kind: ExportKind, format: ExportFormat, month: string, branchId: number | undefined, lang: string): Promise<ExportFile> {
  if (!isValidMonth(month)) throw badRequest();
  if (!["payroll", "attendance"].includes(kind) || !["xlsx", "csv", "pdf"].includes(format)) throw badRequest();
  if (format === "pdf" && kind !== "payroll") throw badRequest();
  const title = t(lang, kind === "payroll" ? "export.payroll" : "export.attendance");
  const base = `${kind === "payroll" ? "payroll" : "attendance"}-${month}`;
  if (format === "pdf") return { data: await payrollPdf(actor, month, branchId, lang), filename: `${base}.pdf`, type: "application/pdf", title };
  const table = kind === "payroll" ? await payrollTable(actor, month, branchId, lang) : await attendanceTable(actor, month, branchId, lang);
  if (format === "csv") return { data: buildCsv(table.header, table.rows), filename: `${base}.csv`, type: "text/csv; charset=utf-8", title };
  return {
    data: buildXlsx(`${title} ${month}`, table.header, table.rows),
    filename: `${base}.xlsx`,
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    title,
  };
}
