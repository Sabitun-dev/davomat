// "Mening oyim": calendar with an icon + colour per day, and the month totals.

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { formatMoney, type Currency } from "@shared/money.ts";
import { shiftMonth } from "@shared/time.ts";
import { useApi } from "../../api.ts";
import { dayLabel, monthName, useLang, useT } from "../../i18n/index.tsx";
import { useNav } from "../../nav.tsx";
import { CalendarCell, Card, ErrorState, IconButton, Page, SectionTitle, Skeleton, StatTile, StatusChip, dayLooks, lookOf, type DayLook } from "../../ui/index.ts";

interface MonthData {
  month: string;
  today: string;
  days: { date: string; status: string; needsReview: boolean; reviewedAt: string | null; lateMin: number; earned: number }[];
  totals: { timesLate: number; lateMin: number; earned: number; max: number; workedDays: number; absentDays: number };
  currency: Currency;
}

export function thisMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function MonthCalendar({
  data,
  onDay,
}: {
  data: Pick<MonthData, "days" | "today">;
  onDay?: (date: string) => void;
}) {
  const t = useT();
  const lang = useLang();
  const first = data.days[0]?.date;
  const offset = first ? (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7 : 0;
  return (
    <div>
      <div className="mb-1 grid grid-cols-7 gap-1 text-center text-[12px] font-semibold text-hint">
        {[1, 2, 3, 4, 5, 6, 7].map((d) => (
          <span key={d}>{t(`sch.wd${d}` as "sch.wd1")}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: offset }, (_, i) => (
          <span key={`e${i}`} />
        ))}
        {data.days.map((d) => {
          const look: DayLook = d.status === "FUTURE" ? "FUTURE" : d.status === "NOT_STARTED" ? "NOT_STARTED" : lookOf(d);
          const hasData = !["FUTURE", "NOT_STARTED", "DAY_OFF"].includes(d.status) || d.date === data.today;
          return (
            <CalendarCell
              key={d.date}
              day={Number(d.date.slice(8))}
              look={look}
              today={d.date === data.today}
              label={`${dayLabel(d.date, lang)}: ${t(dayLooks[look].label)}`}
              onClick={onDay && hasData ? () => onDay(d.date) : undefined}
            />
          );
        })}
      </div>
    </div>
  );
}

export function Legend() {
  const looks: DayLook[] = ["ON_TIME", "LATE", "ABSENT", "DAY_OFF", "REVIEW", "EXTRA_DAY"];
  return (
    <div className="flex flex-wrap gap-2">
      {looks.map((l) => (
        <StatusChip key={l} look={l} />
      ))}
    </div>
  );
}

export default function MonthScreen() {
  const t = useT();
  const lang = useLang();
  const nav = useNav();
  const [month, setMonth] = useState(thisMonth);
  const data = useApi<MonthData>(`/worker/month?month=${month}`);
  const money = (n: number) => formatMoney(n, data.data?.currency ?? "UZS", lang);
  return (
    <Page title={t("m.title")} onBack={nav.pop}>
      <Card>
        <div className="mb-3 flex items-center justify-between">
          <IconButton label="‹" onClick={() => setMonth(shiftMonth(month, -1))}>
            <ChevronLeft size={24} />
          </IconButton>
          <span className="text-[18px] font-bold">{monthName(month, lang)}</span>
          <IconButton label="›" onClick={() => setMonth(shiftMonth(month, 1))}>
            <ChevronRight size={24} />
          </IconButton>
        </div>
        {data.error && <ErrorState error={data.error} onRetry={data.reload} />}
        {(!data.data || data.data.month !== month) && !data.error && <Skeleton className="h-72 w-full" />}
        {data.data && data.data.month === month && <MonthCalendar data={data.data} onDay={(date) => nav.push("day", { date })} />}
      </Card>
      {data.data && data.data.month === month && (
        <>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <StatTile label={t("m.times_late")} value={data.data.totals.timesLate} tone={data.data.totals.timesLate ? "late" : "ok"} />
            <StatTile label={t("m.late_minutes")} value={t("c.min", { n: data.data.totals.lateMin })} />
            <StatTile label={t("m.worked_days")} value={data.data.totals.workedDays} />
            <StatTile label={t("m.absent")} value={data.data.totals.absentDays} tone={data.data.totals.absentDays ? "bad" : undefined} />
          </div>
          <div className="mt-3">
            <StatTile label={t("m.earned")} value={money(data.data.totals.earned)} hint={t("w.month_max", { max: money(data.data.totals.max) })} tone="accent" />
          </div>
        </>
      )}
      <SectionTitle>{t("m.legend")}</SectionTitle>
      <Legend />
      <div className="h-8" />
    </Page>
  );
}
