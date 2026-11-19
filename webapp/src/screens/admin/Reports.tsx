// "Hisobot": month (per worker, branch totals, ranking, day-by-day) and year, plus exports and lock.

import { lazy, Suspense, useState } from "react";
import { ChevronLeft, ChevronRight, FileSpreadsheet, FileText, Lock, LockOpen, RefreshCw, TriangleAlert } from "lucide-react";
import { formatMoney, type Currency } from "@shared/money.ts";
import { shiftMonth } from "@shared/time.ts";
import { api, invalidate, useApi } from "../../api.ts";
import { monthName, useLang, useT } from "../../i18n/index.tsx";
import { useNav } from "../../nav.tsx";
import { useSession } from "../../session.tsx";
import { canDownloadFile, confirm, downloadFile } from "../../telegram/tg.ts";
import { Button, Card, Chip, ErrorState, IconButton, ListCard, ListRow, Page, SectionTitle, Segmented, Sheet, Skeleton, StatTile, TextArea, errorText, useToast, CalendarCell, lookOf, type DayLook } from "../../ui/index.ts";
import { thisMonth } from "../worker/Month.tsx";
import { BranchChips } from "./Dashboard.tsx";
import { DayDrawer } from "./DayDrawer.tsx";

const YearView = lazy(() => import("./YearView.tsx"));

export interface Totals {
  daysWorked: number;
  absent: number;
  timesLate: number;
  lateMin: number;
  earlyMin: number;
  overageMin: number;
  overtimeMin: number;
  workedMin: number;
  earned: number;
  max: number;
  bonus: number;
  fine: number;
  salary: number;
  missingAmounts: number;
  reviewDays: number;
}
interface MonthReport {
  month: string;
  currency: Currency;
  locked: boolean;
  rows: (Totals & { userId: number; name: string; branchName: string; position: string })[];
  branches: (Totals & { id: number; name: string; punctuality: number | null; workers: number })[];
  company: Totals & { punctuality: number | null; workers: number };
  ranking: { userId: number; name: string; branchName: string; timesLate: number; lateMin: number }[];
}

export const hoursText = (min: number) => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")}`;

export default function Reports() {
  const t = useT();
  const [view, setView] = useState<"month" | "year">("month");
  return (
    <Page title={t("r.title")}>
      <Segmented
        value={view}
        onChange={setView}
        options={[
          { value: "month", label: t("r.month") },
          { value: "year", label: t("r.year") },
        ]}
      />
      <div className="mt-3">
        {view === "month" ? (
          <MonthView />
        ) : (
          <Suspense fallback={<Skeleton className="h-64 w-full rounded-[20px]" />}>
            <YearView />
          </Suspense>
        )}
      </div>
    </Page>
  );
}

function MonthView() {
  const t = useT();
  const lang = useLang();
  const nav = useNav();
  const toast = useToast();
  const { me } = useSession();
  const [month, setMonth] = useState(thisMonth);
  const [branchId, setBranchId] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const report = useApi<MonthReport>(`/admin/reports/month?month=${month}${branchId ? `&branchId=${branchId}` : ""}`);
  const [busy, setBusy] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState(false);
  const [comment, setComment] = useState("");

  const r = report.data;
  const money = (n: number) => formatMoney(n, r?.currency ?? me.company.currency, lang);

  const act = async (key: string, work: () => Promise<unknown>, done = t("c.saved")) => {
    setBusy(key);
    try {
      await work();
      toast(done);
      invalidate("/admin");
    } catch (e) {
      toast(errorText(t, e), "error");
    } finally {
      setBusy(null);
    }
  };
  const exportFile = (kind: "payroll" | "attendance", format: "xlsx" | "csv" | "pdf") =>
    act(
      `${kind}-${format}`,
      async () => {
        const res = await api<{ url: string; filename: string }>("/admin/exports", { body: { kind, format, month, branchId } });
        if (canDownloadFile()) downloadFile(res.url, res.filename);
      },
      t("r.export_sent"),
    );

  return (
    <>
      <BranchChips value={branchId} onChange={setBranchId} />
      <div className="mb-3 flex items-center justify-between">
        <IconButton label="‹" onClick={() => setMonth(shiftMonth(month, -1))}>
          <ChevronLeft size={24} />
        </IconButton>
        <span className="flex items-center gap-2 text-[18px] font-bold">
          {monthName(month, lang)} {r?.locked && <Lock size={16} className="text-hint" />}
        </span>
        <IconButton label="›" onClick={() => setMonth(shiftMonth(month, 1))}>
          <ChevronRight size={24} />
        </IconButton>
      </div>
      {report.error && <ErrorState error={report.error} onRetry={report.reload} />}
      {!r && !report.error && <Skeleton className="h-64 w-full rounded-[20px]" />}
      {r && (
        <>
          <StatTile label={t("r.payroll_total")} value={money(r.company.salary)} tone="accent" />
          <div className="mt-3 grid grid-cols-2 gap-3">
            <StatTile label={t("r.punctuality")} value={r.company.punctuality === null ? "—" : `${r.company.punctuality}%`} tone="ok" />
            <StatTile label={t("r.times_late")} value={r.company.timesLate} hint={t("c.min", { n: r.company.lateMin })} tone={r.company.timesLate ? "late" : undefined} />
            <StatTile label={t("r.absent")} value={r.company.absent} tone={r.company.absent ? "bad" : undefined} />
            <StatTile label={t("r.worked_hours")} value={hoursText(r.company.workedMin)} />
          </div>
          {(r.company.missingAmounts > 0 || r.company.reviewDays > 0) && (
            <div className="mt-3 flex flex-wrap gap-2">
              {r.company.missingAmounts > 0 && (
                <Chip tone="late" icon={<TriangleAlert size={14} />}>
                  {t("r.warn_amounts", { n: r.company.missingAmounts })}
                </Chip>
              )}
              {r.company.reviewDays > 0 && (
                <button type="button" onClick={() => nav.push("review")}>
                  <Chip tone="late" icon={<TriangleAlert size={14} />}>
                    {t("r.warn_review", { n: r.company.reviewDays })}
                  </Chip>
                </button>
              )}
            </div>
          )}

          {!branchId && r.branches.length > 1 && (
            <>
              <SectionTitle>{t("b.title")}</SectionTitle>
              <ListCard>
                {r.branches.map((b) => (
                  <ListRow
                    key={b.id}
                    title={b.name}
                    subtitle={`${t("r.punctuality")}: ${b.punctuality === null ? "—" : `${b.punctuality}%`} · ${t("r.times_late")}: ${b.timesLate}`}
                    right={<span className="tabular font-semibold text-ink">{money(b.salary)}</span>}
                    onClick={() => setBranchId(b.id)}
                  />
                ))}
              </ListCard>
            </>
          )}

          <SectionTitle
            action={
              branchId ? (
                <Button variant="ghost" size="sm" full={false} onClick={() => setTable(!table)}>
                  {table ? t("r.workers") : t("r.day_table")}
                </Button>
              ) : undefined
            }
          >
            {t("r.workers")}
          </SectionTitle>
          {table && branchId ? (
            <DayTable month={month} branchId={branchId} />
          ) : r.rows.length === 0 ? (
            <p className="px-1 text-hint">{t("r.no_data")}</p>
          ) : (
            <div className="flex flex-col gap-3">
              {r.rows.map((w) => (
                <Card key={`${w.userId}-${w.branchName}`} onClick={() => nav.push("workerReport", { userId: w.userId, name: w.name, month })}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-[17px] font-semibold">{w.name}</p>
                      <p className="truncate text-[14px] text-hint">{[w.branchName, w.position].filter(Boolean).join(" · ")}</p>
                    </div>
                    <p className="tabular shrink-0 text-right text-[18px] font-bold text-accent">{money(w.salary)}</p>
                  </div>
                  <div className="mt-3 grid grid-cols-4 gap-2 text-center">
                    {[
                      [t("r.short_days"), w.daysWorked, ""],
                      [t("r.absent"), w.absent, w.absent ? "text-bad" : ""],
                      [t("r.times_late"), w.timesLate, w.timesLate ? "text-late" : ""],
                      [t("r.short_hours"), hoursText(w.workedMin), ""],
                    ].map(([label, value, cls]) => (
                      <div key={String(label)} className="rounded-xl bg-bg px-1 py-2">
                        <div className={`tabular text-[16px] font-bold ${cls}`}>{value}</div>
                        <div className="truncate text-[11px] text-hint">{label}</div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-sep" aria-hidden>
                    <div className="h-full rounded-full bg-accent" style={{ width: `${w.max ? Math.min(100, Math.round((w.earned / w.max) * 100)) : 0}%` }} />
                  </div>
                  <p className="mt-1 text-[12px] text-hint">
                    {money(w.earned)} / {money(w.max)}
                    {w.bonus ? ` · +${money(w.bonus)}` : ""}
                    {w.fine ? ` · −${money(w.fine)}` : ""}
                  </p>
                </Card>
              ))}
            </div>
          )}

          {r.ranking.length > 0 && (
            <>
              <SectionTitle>{t("r.ranking")}</SectionTitle>
              <ListCard>
                {r.ranking.map((x, i) => (
                  <ListRow
                    key={x.userId}
                    icon={<span className="tabular font-bold">{i + 1}</span>}
                    title={x.name}
                    subtitle={x.branchName}
                    right={<span className="tabular">{`${x.timesLate}× · ${t("c.min", { n: x.lateMin })}`}</span>}
                  />
                ))}
              </ListCard>
            </>
          )}

          <SectionTitle>{t("r.export")}</SectionTitle>
          <Card className="flex flex-col gap-3">
            <p className="text-[15px] font-semibold">{t("r.export_payroll")}</p>
            <div className="grid grid-cols-3 gap-2">
              <Button variant="soft" size="sm" icon={<FileSpreadsheet size={16} />} loading={busy === "payroll-xlsx"} onClick={() => exportFile("payroll", "xlsx")}>
                XLSX
              </Button>
              <Button variant="soft" size="sm" loading={busy === "payroll-csv"} onClick={() => exportFile("payroll", "csv")}>
                CSV
              </Button>
              <Button variant="soft" size="sm" icon={<FileText size={16} />} loading={busy === "payroll-pdf"} onClick={() => exportFile("payroll", "pdf")}>
                PDF
              </Button>
            </div>
            <p className="text-[15px] font-semibold">{t("r.export_attendance")}</p>
            <div className="grid grid-cols-3 gap-2">
              <Button variant="soft" size="sm" icon={<FileSpreadsheet size={16} />} loading={busy === "attendance-xlsx"} onClick={() => exportFile("attendance", "xlsx")}>
                XLSX
              </Button>
              <Button variant="soft" size="sm" loading={busy === "attendance-csv"} onClick={() => exportFile("attendance", "csv")}>
                CSV
              </Button>
            </div>
          </Card>

          <div className="mt-4 flex flex-col gap-3">
            {!r.locked && (
              <Button variant="secondary" icon={<RefreshCw size={18} />} loading={busy === "recalc"} onClick={() => act("recalc", () => api(`/admin/months/${month}/recalc`, { body: { branchId } }).then(report.reload), t("r.recalc_done"))}>
                {t("r.recalc")}
              </Button>
            )}
            {!r.locked ? (
              <Button
                variant="secondary"
                icon={<Lock size={18} />}
                loading={busy === "lock"}
                onClick={async () => {
                  if (await confirm(t("r.lock_confirm"))) await act("lock", () => api(`/admin/months/${month}/lock`, { body: {} }).then(report.reload));
                }}
              >
                {t("r.lock")}
              </Button>
            ) : (
              <>
                <Chip tone="off" icon={<Lock size={14} />}>
                  {t("r.locked")}
                </Chip>
                {me.role === "OWNER" && (
                  <Button variant="danger" icon={<LockOpen size={18} />} onClick={() => setUnlocking(true)}>
                    {t("r.unlock")}
                  </Button>
                )}
              </>
            )}
          </div>
        </>
      )}
      <div className="h-6" />
      <Sheet open={unlocking} onClose={() => setUnlocking(false)} title={t("r.unlock")}>
        <TextArea value={comment} placeholder={t("c.comment_required")} onChange={(e) => setComment(e.target.value)} />
        <div className="mt-4">
          <Button
            variant="danger"
            disabled={comment.trim().length < 2}
            onClick={() =>
              act("unlock", () => api(`/admin/months/${month}/unlock`, { body: { comment } })).then(() => {
                setUnlocking(false);
                setComment("");
                report.reload();
              })
            }
          >
            {t("r.unlock")}
          </Button>
        </div>
      </Sheet>
    </>
  );
}

interface TableData {
  dates: string[];
  today: string;
  workers: { userId: number; name: string; days: { date: string; status: string; lateMin: number; needsReview: boolean; reviewedAt: string | null }[] }[];
}

function DayTable({ month, branchId }: { month: string; branchId: number }) {
  const data = useApi<TableData>(`/admin/reports/table?month=${month}&branchId=${branchId}`);
  const [open, setOpen] = useState<{ userId: number; date: string } | null>(null);
  if (!data.data) return <Skeleton className="h-48 w-full rounded-[20px]" />;
  return (
    <Card padded={false} className="overflow-hidden">
      <div className="scroll-x">
        <table className="border-separate border-spacing-0 text-[12px]">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 min-w-[110px] bg-card px-3 py-2 text-left" />
              {data.data.dates.map((d) => (
                <th key={d} className="tabular min-w-[40px] px-0.5 py-2 text-center font-semibold text-hint">
                  {Number(d.slice(8))}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.data.workers.map((w) => (
              <tr key={w.userId}>
                <td className="sticky left-0 z-10 max-w-[110px] truncate border-t border-sep bg-card px-3 py-1 text-[13px] font-medium">{w.name}</td>
                {w.days.map((d) => {
                  const look: DayLook = d.status === "FUTURE" ? "FUTURE" : d.status === "NOT_STARTED" ? "NOT_STARTED" : lookOf(d);
                  const clickable = !["FUTURE", "DAY_OFF"].includes(d.status);
                  return (
                    <td key={d.date} className="border-t border-sep p-0.5">
                      <CalendarCell day={Number(d.date.slice(8))} look={look} today={d.date === data.data!.today} label={`${w.name} ${d.date}`} onClick={clickable ? () => setOpen({ userId: w.userId, date: d.date }) : undefined} />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {open && <DayDrawer userId={open.userId} date={open.date} onClose={() => setOpen(null)} />}
    </Card>
  );
}
