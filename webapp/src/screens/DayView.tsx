// One day: summary, events with distance and the group video. Admins get more in the day drawer.

import { Video } from "lucide-react";
import { formatMoney } from "@shared/money.ts";
import { minuteToHHMM } from "@shared/time.ts";
import { useApi } from "../api.ts";
import { dayLabel, useLang, useT, type Key } from "../i18n/index.tsx";
import { useNav } from "../nav.tsx";
import { useSession } from "../session.tsx";
import { openTelegramLink } from "../telegram/tg.ts";
import { Card, Chip, ErrorState, ListCard, ListRow, Page, SectionTitle, SkeletonScreen, StatusChip, lookOf } from "../ui/index.ts";
import type { DayResult, EventItem } from "../types.ts";

export interface DayData {
  date: string;
  userName: string;
  branchName: string | null;
  branchId: number | null;
  timezone: string;
  result: DayResult | null;
  events: EventItem[];
  audit: { id: number; action: string; comment: string; at: string; actor: string }[];
}

export function DaySummary({ day }: { day: DayData }) {
  const t = useT();
  const lang = useLang();
  const { me } = useSession();
  const r = day.result;
  if (!r) return null;
  const rows: [string, string, string?][] = [];
  if (r.startMin !== null && r.endMin !== null) rows.push([t("d.scheduled"), `${minuteToHHMM(r.startMin)}–${minuteToHHMM(r.endMin)}`]);
  rows.push([t("w.late"), r.lateMin ? t("w.late_min", { n: r.lateMin }) : t("w.on_time"), r.lateMin ? "text-late" : "text-ok"]);
  if (r.earlyMin) rows.push([t("d.early"), t("c.min", { n: r.earlyMin }), "text-late"]);
  rows.push([t("w.break"), t("c.min", { n: r.breakMin })]);
  if (r.overageMin) rows.push([t("d.overage"), t("c.min", { n: r.overageMin }), "text-late"]);
  if (r.overtimeMin) rows.push([t("d.overtime"), `+${t("c.min", { n: r.overtimeMin })}`, "text-ok"]);
  rows.push([t("d.worked"), `${Math.floor(r.workedMin / 60)}:${String(r.workedMin % 60).padStart(2, "0")}`]);
  rows.push([t("d.amount"), r.amount === null ? "—" : formatMoney(r.amount, me.company!.currency, lang)]);
  return (
    <Card>
      <div className="mb-3 flex items-center justify-between gap-2">
        <StatusChip look={lookOf(r)} />
        <span className="tabular text-[22px] font-bold text-accent">{formatMoney(r.earned, me.company!.currency, lang)}</span>
      </div>
      <dl className="grid grid-cols-2 gap-y-2 text-[15px]">
        {rows.map(([k, v, cls]) => (
          <div key={k} className="contents">
            <dt className="text-hint">{k}</dt>
            <dd className={`tabular text-right font-semibold ${cls ?? ""}`}>{v}</dd>
          </div>
        ))}
      </dl>
      {r.manualEarned !== null && <p className="mt-3 text-[13px] text-hint">{t("d.manual")}</p>}
      {r.flags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {r.flags.map((f) => (
            <Chip key={f} tone={f === "missing_amount" ? "off" : "late"}>
              {t(`flag.${f}` as Key)}
            </Chip>
          ))}
        </div>
      )}
    </Card>
  );
}

export function EventList({ events }: { events: EventItem[] }) {
  const t = useT();
  return (
    <ListCard>
      {events.map((e) => (
        <ListRow
          key={e.id}
          title={
            <span className={e.voided || e.status === "REJECTED" ? "text-hint line-through" : ""}>
              <span className="tabular font-semibold">{e.localTime}</span> · {t(`evp.${e.type}`)}
            </span>
          }
          subtitle={[
            e.distanceM !== null ? t("c.m", { n: e.distanceM }) : null,
            e.accuracy !== null ? `±${e.accuracy} m` : null,
            e.source === "AUTO" ? t("ev.auto") : e.source === "ADMIN" ? t("ev.admin") : null,
            e.status === "REJECTED" ? `${t("d.rejected_one")}${e.rejectReason ? ` (${e.rejectReason})` : ""}` : null,
            ...e.flags.map((f) => t(`flag.${f}` as Key)),
          ]
            .filter(Boolean)
            .join(" · ")}
          right={
            e.videoUrl ? (
              <button
                type="button"
                aria-label={t("d.open_video")}
                onClick={() => openTelegramLink(e.videoUrl!)}
                className="flex h-11 items-center gap-1 rounded-xl bg-accent-soft px-3 text-[14px] font-semibold text-accent"
              >
                <Video size={18} /> {t("d.open_video")}
              </button>
            ) : undefined
          }
        />
      ))}
    </ListCard>
  );
}

export default function DayView({ date }: { date: string }) {
  const t = useT();
  const lang = useLang();
  const nav = useNav();
  const day = useApi<DayData>(`/worker/day?date=${date}`);
  if (day.error) return <ErrorState error={day.error} onRetry={day.reload} />;
  if (!day.data) return <SkeletonScreen />;
  return (
    <Page title={dayLabel(date, lang)} subtitle={day.data.branchName ?? undefined} onBack={nav.pop}>
      <DaySummary day={day.data} />
      {day.data.events.length > 0 && (
        <>
          <SectionTitle>{t("d.events")}</SectionTitle>
          <EventList events={day.data.events} />
        </>
      )}
      <div className="h-8" />
    </Page>
  );
}
