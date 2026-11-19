// Year view: 12-month charts (one measure per chart, one axis each) and year totals per worker.
// Recharts loads only here.

import { useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { formatMoney, type Currency } from "@shared/money.ts";
import { useApi } from "../../api.ts";
import { shortMonth, useLang, useT } from "../../i18n/index.tsx";
import { Card, ErrorState, IconButton, ListCard, ListRow, SectionTitle, Skeleton, StatTile } from "../../ui/index.ts";
import { BranchChips } from "./Dashboard.tsx";
import { hoursText, type Totals } from "./Reports.tsx";

interface YearData {
  year: number;
  currency: Currency;
  months: (Totals & { month: string })[];
  workers: (Totals & { userId: number; name: string })[];
}

function MonthBars({
  data,
  dataKey,
  format,
  label,
}: {
  data: { name: string; value: number }[];
  dataKey: "value";
  format: (n: number) => string;
  label: string;
}) {
  return (
    <Card>
      <p className="mb-2 text-[15px] font-semibold">{label}</p>
      <div className="h-[180px]" role="img" aria-label={label}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }} barCategoryGap={4}>
            <CartesianGrid vertical={false} stroke="var(--app-sep)" />
            <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fill: "var(--app-hint)", fontSize: 11 }} interval={0} />
            <YAxis tickLine={false} axisLine={false} width={44} tick={{ fill: "var(--app-hint)", fontSize: 11 }} tickFormatter={(v: number) => (v >= 1e6 ? `${Math.round(v / 1e5) / 10}M` : v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} />
            <Tooltip
              cursor={{ fill: "var(--app-sep)" }}
              contentStyle={{ background: "var(--app-card)", border: "none", borderRadius: 12, boxShadow: "var(--app-shadow)", color: "var(--app-text)" }}
              formatter={(v) => [format(Number(v)), label]}
            />
            <Bar dataKey={dataKey} fill="var(--app-accent)" radius={[4, 4, 0, 0]} maxBarSize={22} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

export default function YearView() {
  const t = useT();
  const lang = useLang();
  const [year, setYear] = useState(new Date().getFullYear());
  const [branchId, setBranchId] = useState<number | null>(null);
  const data = useApi<YearData>(`/admin/reports/year?year=${year}${branchId ? `&branchId=${branchId}` : ""}`);
  const d = data.data;
  // Charts take whole units of money (dollars, not cents).
  const unit = (n: number) => (d?.currency === "USD" ? n / 100 : n);
  const money = (n: number) => formatMoney(n, d?.currency ?? "UZS", lang);
  const total = d?.months.reduce(
    (s, m) => ({ salary: s.salary + m.salary, lateMin: s.lateMin + m.lateMin, timesLate: s.timesLate + m.timesLate, absent: s.absent + m.absent }),
    { salary: 0, lateMin: 0, timesLate: 0, absent: 0 },
  );

  return (
    <>
      <BranchChips value={branchId} onChange={setBranchId} />
      <div className="mb-3 flex items-center justify-between">
        <IconButton label="‹" onClick={() => setYear(year - 1)}>
          <ChevronLeft size={24} />
        </IconButton>
        <span className="tabular text-[18px] font-bold">{year}</span>
        <IconButton label="›" onClick={() => setYear(year + 1)}>
          <ChevronRight size={24} />
        </IconButton>
      </div>
      {data.error && <ErrorState error={data.error} onRetry={data.reload} />}
      {!d && !data.error && <Skeleton className="h-64 w-full rounded-[20px]" />}
      {d && total && (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <StatTile label={t("r.year_total")} value={money(total.salary)} tone="accent" />
            <StatTile label={t("r.times_late")} value={total.timesLate} hint={t("c.min", { n: total.lateMin })} tone={total.timesLate ? "late" : undefined} />
          </div>
          <MonthBars
            label={t("r.salary")}
            dataKey="value"
            data={d.months.map((m, i) => ({ name: shortMonth(i + 1, lang), value: unit(m.salary) }))}
            format={(v) => money(d.currency === "USD" ? Math.round(v * 100) : v)}
          />
          <MonthBars
            label={t("r.late_min")}
            dataKey="value"
            data={d.months.map((m, i) => ({ name: shortMonth(i + 1, lang), value: m.lateMin }))}
            format={(v) => t("c.min", { n: v })}
          />
          <SectionTitle>{t("r.workers")}</SectionTitle>
          {d.workers.length === 0 ? (
            <p className="px-1 text-hint">{t("r.no_data")}</p>
          ) : (
            <ListCard>
              {d.workers.map((w) => (
                <ListRow
                  key={w.userId}
                  title={w.name}
                  subtitle={`${t("r.days_worked")}: ${w.daysWorked} · ${t("r.times_late")}: ${w.timesLate} · ${hoursText(w.workedMin)}`}
                  right={<span className="tabular font-semibold text-ink">{money(w.salary)}</span>}
                />
              ))}
            </ListCard>
          )}
        </div>
      )}
    </>
  );
}
