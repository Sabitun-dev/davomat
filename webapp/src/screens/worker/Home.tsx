// Worker home: "What do I do now?" — today's state and only the valid next action.

import { useEffect, useState } from "react";
import { Briefcase, CalendarDays, ChevronDown, Coffee, Flame, History, LogOut, Moon, Settings, Sun } from "lucide-react";
import { formatMoney } from "@shared/money.ts";
import { minuteToHHMM } from "@shared/time.ts";
import type { EventType } from "@shared/attendance.ts";
import { useApi } from "../../api.ts";
import { dayLabel, useLang, useT } from "../../i18n/index.tsx";
import { useNav } from "../../nav.tsx";
import { useSession } from "../../session.tsx";
import { BottomActions, BottomSpacer } from "../../telegram/buttons.tsx";
import { confirm } from "../../telegram/tg.ts";
import { Button, Card, ErrorState, IconButton, ListCard, ListRow, Page, Ring, Sheet, SkeletonScreen, StatTile, StatusChip, Toggle, lookOf } from "../../ui/index.ts";
import type { Today } from "../../types.ts";

const stateStyle = {
  NOT_STARTED: { Icon: Sun, ring: "accent", bg: "bg-accent-soft text-accent" },
  WORKING: { Icon: Briefcase, ring: "ok", bg: "bg-ok-soft text-ok" },
  ON_BREAK: { Icon: Coffee, ring: "brk", bg: "bg-brk-soft text-brk" },
  FINISHED: { Icon: LogOut, ring: "ok", bg: "bg-ok-soft text-ok" },
} as const;

function useNowMinute(tz: string | undefined) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  if (!tz) return 0;
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return get("hour") * 60 + get("minute");
}

export default function WorkerHome() {
  const t = useT();
  const lang = useLang();
  const nav = useNav();
  const { me } = useSession();
  const [branchId, setBranchId] = useState<number | null>(null);
  const today = useApi<Today & { branches: { id: number; name: string }[] }>(`/worker/today${branchId ? `?branchId=${branchId}` : ""}`);
  const [picking, setPicking] = useState(false);
  const [checkingOut, setCheckingOut] = useState(false);
  const [workOver, setWorkOver] = useState(false);
  const nowMin = useNowMinute(today.data?.branch?.timezone);
  const onBreak = today.data?.state === "ON_BREAK";
  useEffect(() => {
    if (!onBreak) return;
    const id = window.setInterval(() => void today.reload(), 60_000);
    return () => window.clearInterval(id);
  }, [onBreak, today.reload]);
  const firstName = (me.user.fullName ?? me.user.telegramName).split(" ")[0];

  if (today.error && !today.data) return <ErrorState error={today.error} onRetry={today.reload} />;
  if (!today.data) return <SkeletonScreen />;
  const d = today.data;
  const style = stateStyle[d.state];
  const firstIn = d.events.find((e) => e.type === "CHECK_IN");
  const lastOut = [...d.events].reverse().find((e) => e.type === "CHECK_OUT");
  const breakStart = [...d.events].reverse().find((e) => e.type === "BREAK_START");
  const money = (n: number) => formatMoney(n, d.currency, lang);

  const canTick = d.schedule !== null && d.workOverFromMin !== null && nowMin >= d.workOverFromMin && nowMin < d.schedule.endMin;
  const go = async (type: EventType) => {
    if (type === "CHECK_OUT" && canTick) return setCheckingOut(true);
    if (type === "CHECK_OUT" && !(await confirm(t("w.confirm_checkout")))) return;
    nav.push("scan", { eventType: type });
  };
  const [main, second] = d.actions;
  const tooEarly = main === "CHECK_IN" && d.earliestCheckInMin !== null && nowMin < d.earliestCheckInMin;

  // The server counts the open break up to the moment of loading; the screen refreshes every minute.
  const breakUsed = d.result?.breakMin ?? 0;

  let headline = t(`w.state_${d.state}`);
  let detail: string | null = null;
  if (d.state === "WORKING" && firstIn) detail = t("w.since", { time: firstIn.localTime });
  if (d.state === "ON_BREAK" && breakStart) detail = t("w.since", { time: breakStart.localTime });
  if (d.state === "NOT_STARTED") {
    if (!d.schedule) headline = t("w.today_off");
    else detail = t("w.today_schedule", { start: minuteToHHMM(d.schedule.startMin), end: minuteToHHMM(d.schedule.endMin) });
  }

  const weekValue = d.week.workDays ? d.week.onTime / d.week.workDays : 0;
  const monthValue = d.month.max ? d.month.earned / d.month.max : 0;

  return (
    <Page
      title={t("w.hello", { name: firstName })}
      subtitle={
        d.branches.length > 1 ? (
          <button type="button" className="inline-flex items-center gap-1 text-accent" onClick={() => setPicking(true)}>
            {d.branch?.name} <ChevronDown size={16} />
          </button>
        ) : (
          `${d.branch?.name ?? ""} · ${dayLabel(d.date, lang)}`
        )
      }
      onBack={nav.stack.length > 1 ? nav.pop : undefined}
      right={
        <IconButton label={t("set.title")} onClick={() => nav.push("settings")}>
          <Settings size={22} />
        </IconButton>
      }
    >
      <Card className="flex flex-col gap-4 p-5">
        <div className="flex items-center gap-4">
          <span className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-[22px] ${d.schedule || d.state !== "NOT_STARTED" ? style.bg : "bg-off-soft text-off"}`}>
            {!d.schedule && d.state === "NOT_STARTED" ? <Moon size={32} /> : <style.Icon size={32} />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[24px] leading-tight font-bold">{headline}</p>
            {detail && <p className="tabular mt-1 text-[16px] text-hint">{detail}</p>}
          </div>
        </div>

        {d.state === "ON_BREAK" && (
          <div className="flex items-center gap-3 rounded-2xl bg-brk-soft p-3 text-brk">
            <Coffee size={20} />
            <span className="tabular text-[16px] font-semibold">{t("w.break_used", { used: breakUsed, allowed: d.breakAllowanceMin })}</span>
          </div>
        )}

        {d.state === "WORKING" && d.result && (
          <div className="flex flex-wrap gap-2">
            <StatusChip look={d.result.lateMin > 0 ? "LATE" : "ON_TIME"} text={d.result.lateMin > 0 ? t("w.late_min", { n: d.result.lateMin }) : t("w.on_time")} />
            {d.result.breakMin > 0 && <StatusChip look="ON_BREAK" text={t("w.break_used", { used: d.result.breakMin, allowed: d.breakAllowanceMin })} />}
          </div>
        )}

        {d.state === "FINISHED" && d.result && (
          <dl className="grid grid-cols-2 gap-y-2.5 text-[16px]">
            <dt className="text-hint">{t("w.arrived")}</dt>
            <dd className="tabular text-right font-semibold">{firstIn?.localTime ?? "—"}</dd>
            <dt className="text-hint">{t("w.left")}</dt>
            <dd className="tabular text-right font-semibold">{lastOut?.localTime ?? "—"}</dd>
            <dt className="text-hint">{t("w.break")}</dt>
            <dd className="tabular text-right font-semibold">{t("c.min", { n: d.result.breakMin })}</dd>
            <dt className="text-hint">{t("w.late")}</dt>
            <dd className={`text-right font-semibold ${d.result.lateMin ? "text-late" : "text-ok"}`}>
              {d.result.lateMin ? t("w.late_min", { n: d.result.lateMin }) : t("w.on_time")}
            </dd>
            <dt className="text-hint">{t("w.earned_today")}</dt>
            <dd className="tabular text-right text-[18px] font-bold text-accent">{d.result.amount === null ? "—" : money(d.result.earned)}</dd>
          </dl>
        )}

        {tooEarly && d.earliestCheckInMin !== null && (
          <p className="text-[15px] text-hint">{t("w.check_in_from", { time: minuteToHHMM(d.earliestCheckInMin) })}</p>
        )}
      </Card>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <div className="flex flex-col justify-between gap-2 rounded-[20px] bg-card p-4 shadow-soft">
          <span className="flex items-center gap-1.5 text-[13px] font-medium text-hint">
            <Flame size={16} className="text-late" /> {t("w.streak_label")}
          </span>
          <span className="tabular text-[28px] leading-none font-bold">{d.streak}</span>
          <span className="text-[13px] leading-snug text-hint">{d.streak > 0 ? t("w.streak_days") : t("w.streak_zero")}</span>
        </div>
        <div className="flex items-center gap-3 rounded-[20px] bg-card p-4 shadow-soft">
          <Ring value={weekValue} size={64} tone="ok" label={t("w.week")}>
            <span className="tabular text-[15px] font-bold">
              {d.week.onTime}/{d.week.workDays}
            </span>
          </Ring>
          <span className="text-[13px] leading-snug text-hint">{t("w.week")}</span>
        </div>
      </div>

      <div className="mt-3">
        <StatTile
          label={t("w.month_earned")}
          value={money(d.month.earned)}
          hint={
            <span className="block">
              <span className="mt-1 block h-2 overflow-hidden rounded-full bg-sep">
                <span className="block h-full rounded-full bg-accent transition-all" style={{ width: `${Math.min(100, Math.round(monthValue * 100))}%` }} />
              </span>
              <span className="mt-1.5 block">{t("w.month_max", { max: money(d.month.max) })}</span>
            </span>
          }
          tone="accent"
        />
      </div>

      <div className="mt-3">
        <ListCard>
          <ListRow icon={<CalendarDays size={20} />} title={t("w.calendar")} onClick={() => nav.push("month")} />
          <ListRow icon={<History size={20} />} title={t("w.history")} onClick={() => nav.push("history")} />
        </ListCard>
      </div>
      {d.result && d.state === "FINISHED" && (
        <p className="mt-4 text-center">
          <StatusChip look={lookOf(d.result)} />
        </p>
      )}

      <BottomSpacer double={Boolean(second)} />
      {main && (
        <BottomActions
          text={t(`ev.${main}`)}
          disabled={tooEarly}
          onClick={() => void go(main)}
          secondary={second ? { text: t(`ev.${second}`), onClick: () => void go(second) } : undefined}
        />
      )}

      <Sheet open={checkingOut} onClose={() => setCheckingOut(false)} title={t("w.confirm_checkout")}>
        <ListCard>
          <Toggle
            checked={workOver}
            onChange={setWorkOver}
            label={t("w.work_over")}
            hint={t("w.work_over_hint", { p: d.workOverPercent, end: d.schedule ? minuteToHHMM(d.schedule.endMin) : "" })}
          />
        </ListCard>
        <div className="mt-4">
          <Button
            onClick={() => {
              setCheckingOut(false);
              nav.push("scan", { eventType: "CHECK_OUT", workOver });
            }}
          >
            {t("ev.CHECK_OUT")}
          </Button>
        </div>
      </Sheet>

      <Sheet open={picking} onClose={() => setPicking(false)} title={t("w.choose_branch")}>
        <ListCard>
          {d.branches.map((b) => (
            <ListRow
              key={b.id}
              title={b.name}
              right={b.id === d.branch?.id ? "✓" : undefined}
              onClick={() => {
                setBranchId(b.id);
                setPicking(false);
              }}
            />
          ))}
        </ListCard>
      </Sheet>
    </Page>
  );
}
