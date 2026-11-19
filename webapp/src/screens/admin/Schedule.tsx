// Branch (or one worker's) schedule: weekly template + single days of a month.

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Copy, Lock } from "lucide-react";
import { minuteToHHMM, parseHHMM, shiftMonth } from "@shared/time.ts";
import { api, useApi } from "../../api.ts";
import { dayLabel, monthName, useLang, useT, type Key } from "../../i18n/index.tsx";
import { useNav } from "../../nav.tsx";
import { confirm, haptic } from "../../telegram/tg.ts";
import { Button, Card, Chip, ErrorState, Field, IconButton, Input, Page, SectionTitle, Segmented, Sheet, SkeletonScreen, errorText, useToast } from "../../ui/index.ts";
import { thisMonth } from "../worker/Month.tsx";

interface WeekDay {
  weekday: number;
  startMin: number | null;
  endMin: number | null;
  dayOff: boolean;
}
interface ScheduleData {
  branch: { id: number; name: string };
  month: string;
  locked: boolean;
  ownWeek: boolean;
  week: WeekDay[];
  days: { date: string; startMin: number | null; endMin: number | null; dayOff: boolean; holiday: boolean; overridden: boolean; note: string }[];
}

function TimeInput({ value, onChange, label }: { value: number | null; onChange: (m: number | null) => void; label: string }) {
  return (
    <Input
      type="time"
      aria-label={label}
      value={value === null ? "" : minuteToHHMM(value)}
      onChange={(e) => onChange(parseHHMM(e.target.value))}
      className="tabular min-w-0 px-2 text-center"
    />
  );
}

export default function ScheduleScreen({ branchId, userId, name }: { branchId: number; userId?: number; name?: string }) {
  const t = useT();
  const lang = useLang();
  const nav = useNav();
  const toast = useToast();
  const [month, setMonth] = useState(thisMonth);
  const data = useApi<ScheduleData>(`/admin/branches/${branchId}/schedule?month=${month}${userId ? `&userId=${userId}` : ""}`);
  const [week, setWeek] = useState<WeekDay[] | null>(null);
  const [editDay, setEditDay] = useState<ScheduleData["days"][number] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (data.data) setWeek(data.data.week);
  }, [data.data]);

  if (data.error) return <ErrorState error={data.error} onRetry={data.reload} />;
  if (!data.data || !week) return <SkeletonScreen />;
  const d = data.data;
  const personal = Boolean(userId);
  const canEditWeek = !personal || d.ownWeek;

  const run = async (work: () => Promise<unknown>, done = t("c.saved")) => {
    setBusy(true);
    try {
      await work();
      haptic.success();
      toast(done);
      data.reload();
    } catch (e) {
      toast(errorText(t, e), "error");
    } finally {
      setBusy(false);
    }
  };
  const saveWeek = (w: WeekDay[] | null) =>
    run(() =>
      api(`/admin/branches/${branchId}/schedule/week`, {
        method: "PUT",
        body: { userId: userId ?? null, week: w ? w.map((x) => (x.dayOff ? { dayOff: true } : { startMin: x.startMin, endMin: x.endMin })) : null },
      }),
    );
  const copyPrev = async () => {
    if (!(await confirm(t("sch.copy_confirm")))) return;
    await run(() => api(`/admin/branches/${branchId}/schedule/copy`, { body: { userId: userId ?? null, month } }));
  };

  const first = d.days[0]?.date;
  const offset = first ? (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7 : 0;

  return (
    <Page title={personal ? name : t("sch.weekly")} subtitle={personal ? t("mem.own_schedule") : d.branch.name} onBack={nav.pop}>
      {personal && (
        <Segmented
          value={d.ownWeek ? "own" : "branch"}
          onChange={(v) => (v === "branch" ? saveWeek(null) : saveWeek(week))}
          options={[
            { value: "branch", label: t("sch.use_branch") },
            { value: "own", label: t("sch.use_own") },
          ]}
        />
      )}

      <SectionTitle>{t("sch.weekly")}</SectionTitle>
      <Card className="flex flex-col gap-2">
        {week.map((w, i) => (
          <div key={w.weekday} className="flex min-h-[52px] items-center gap-2">
            <button
              type="button"
              disabled={!canEditWeek}
              onClick={() => {
                const next = [...week];
                next[i] = w.dayOff ? { ...w, dayOff: false, startMin: w.startMin ?? 540, endMin: w.endMin ?? 1140 } : { ...w, dayOff: true };
                setWeek(next);
              }}
              className={`w-[92px] shrink-0 rounded-xl px-2 py-2 text-left text-[15px] font-semibold ${w.dayOff ? "bg-off-soft text-off" : "bg-accent-soft text-accent"}`}
            >
              {t(`sch.wdl${w.weekday}` as Key)}
            </button>
            {w.dayOff ? (
              <span className="flex-1 text-[15px] text-hint">{t("sch.day_off")}</span>
            ) : (
              <div className="grid flex-1 grid-cols-2 gap-2">
                <TimeInput label={t("sch.start")} value={w.startMin} onChange={(m) => canEditWeek && setWeek(week.map((x, j) => (j === i ? { ...x, startMin: m } : x)))} />
                <TimeInput label={t("sch.end")} value={w.endMin} onChange={(m) => canEditWeek && setWeek(week.map((x, j) => (j === i ? { ...x, endMin: m } : x)))} />
              </div>
            )}
          </div>
        ))}
        {canEditWeek && (
          <Button loading={busy} disabled={d.locked} onClick={() => saveWeek(week)}>
            {t("c.save")}
          </Button>
        )}
      </Card>

      <SectionTitle
        action={
          <Button variant="ghost" size="sm" full={false} icon={<Copy size={16} />} disabled={d.locked} onClick={copyPrev}>
            {t("sch.copy_prev")}
          </Button>
        }
      >
        {t("sch.month")}
      </SectionTitle>
      <Card>
        <div className="mb-3 flex items-center justify-between">
          <IconButton label="‹" onClick={() => setMonth(shiftMonth(month, -1))}>
            <ChevronLeft size={24} />
          </IconButton>
          <span className="flex items-center gap-2 text-[18px] font-bold">
            {monthName(month, lang)} {d.locked && <Lock size={16} className="text-hint" />}
          </span>
          <IconButton label="›" onClick={() => setMonth(shiftMonth(month, 1))}>
            <ChevronRight size={24} />
          </IconButton>
        </div>
        <div className="mb-1 grid grid-cols-7 gap-1 text-center text-[12px] font-semibold text-hint">
          {[1, 2, 3, 4, 5, 6, 7].map((n) => (
            <span key={n}>{t(`sch.wd${n}` as Key)}</span>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: offset }, (_, i) => (
            <span key={i} />
          ))}
          {d.days.map((day) => (
            <button
              key={day.date}
              type="button"
              disabled={d.locked}
              onClick={() => setEditDay(day)}
              aria-label={dayLabel(day.date, lang)}
              className={`flex min-h-[52px] flex-col items-center justify-center rounded-xl text-center ${
                day.holiday ? "bg-bad-soft text-bad" : day.dayOff ? "bg-off-soft text-off" : "bg-accent-soft text-accent"
              } ${day.overridden ? "ring-2 ring-accent" : ""}`}
            >
              <span className="tabular text-[15px] font-bold">{Number(day.date.slice(8))}</span>
              <span className="tabular text-[10px] leading-tight">
                {day.dayOff ? (day.holiday ? "🎉" : "—") : `${minuteToHHMM(day.startMin!).replace(":00", "")}-${minuteToHHMM(day.endMin!).replace(":00", "")}`}
              </span>
            </button>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Chip tone="accent">{t("sch.working")}</Chip>
          <Chip tone="off">{t("sch.day_off")}</Chip>
          <Chip tone="bad">{t("sch.holiday")}</Chip>
        </div>
      </Card>
      <div className="h-8" />

      {editDay && (
        <DaySheet
          day={editDay}
          onClose={() => setEditDay(null)}
          onSave={(payload) => run(() => api(`/admin/branches/${branchId}/schedule/day`, { method: "PUT", body: { userId: userId ?? null, date: editDay.date, ...payload } })).then(() => setEditDay(null))}
          onReset={() =>
            run(() => api(`/admin/branches/${branchId}/schedule/day?date=${editDay.date}${userId ? `&userId=${userId}` : ""}`, { method: "DELETE" })).then(() => setEditDay(null))
          }
        />
      )}
    </Page>
  );
}

function DaySheet({
  day,
  onClose,
  onSave,
  onReset,
}: {
  day: ScheduleData["days"][number];
  onClose: () => void;
  onSave: (payload: Record<string, unknown>) => void;
  onReset: () => void;
}) {
  const t = useT();
  const lang = useLang();
  const [kind, setKind] = useState<"work" | "off" | "holiday">(day.holiday ? "holiday" : day.dayOff ? "off" : "work");
  const [start, setStart] = useState<number | null>(day.startMin ?? 540);
  const [end, setEnd] = useState<number | null>(day.endMin ?? 1140);
  const [note, setNote] = useState(day.note);
  return (
    <Sheet open onClose={onClose} title={dayLabel(day.date, lang)}>
      <div className="flex flex-col gap-4">
        <Segmented
          value={kind}
          onChange={setKind}
          options={[
            { value: "work", label: t("sch.working") },
            { value: "off", label: t("sch.day_off") },
            { value: "holiday", label: t("sch.holiday") },
          ]}
        />
        {kind === "work" && (
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("sch.start")}>
              <TimeInput label={t("sch.start")} value={start} onChange={setStart} />
            </Field>
            <Field label={t("sch.end")}>
              <TimeInput label={t("sch.end")} value={end} onChange={setEnd} />
            </Field>
          </div>
        )}
        <Field label={t("sch.note")}>
          <Input value={note} maxLength={100} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <Button
          onClick={() =>
            onSave(kind === "work" ? { startMin: start, endMin: end, note } : kind === "holiday" ? { holiday: true, note } : { dayOff: true, note })
          }
        >
          {t("c.save")}
        </Button>
        {day.overridden && (
          <Button variant="secondary" onClick={onReset}>
            {t("sch.reset_day")}
          </Button>
        )}
      </div>
    </Sheet>
  );
}
