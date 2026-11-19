// Admin day drawer: event times with distance, video, flags, corrections and the audit trail.

import { useState } from "react";
import { CircleCheck, Pencil, Plus } from "lucide-react";
import { formatMoney, moneyToInput } from "@shared/money.ts";
import type { EventType } from "@shared/attendance.ts";
import { api, invalidate, useApi } from "../../api.ts";
import { dayLabel, useLang, useT } from "../../i18n/index.tsx";
import { useSession } from "../../session.tsx";
import { Button, Field, Input, ListCard, ListRow, Segmented, SectionTitle, Select, Sheet, Skeleton, TextArea, errorText, useToast } from "../../ui/index.ts";
import { MoneyInput } from "../../ui/MoneyInput.tsx";
import { DaySummary, EventList, type DayData } from "../DayView.tsx";
import type { EventItem } from "../../types.ts";

type Mode = { kind: "view" } | { kind: "edit"; event: EventItem } | { kind: "add" } | { kind: "review" };

export function DayDrawer({ userId, date, onClose }: { userId: number; date: string; onClose: () => void }) {
  const t = useT();
  const lang = useLang();
  const toast = useToast();
  const { me } = useSession();
  const day = useApi<DayData>(`/admin/day?userId=${userId}&date=${date}`);
  const [mode, setMode] = useState<Mode>({ kind: "view" });
  const [comment, setComment] = useState("");
  const [time, setTime] = useState("09:00");
  const [type, setType] = useState<EventType>("CHECK_IN");
  const [manual, setManual] = useState<number | null>(null);
  const [useManual, setUseManual] = useState<"formula" | "manual">("formula");
  const [busy, setBusy] = useState(false);

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await work();
      toast(t("c.saved"));
      setMode({ kind: "view" });
      setComment("");
      invalidate("/admin");
      day.reload();
    } catch (e) {
      toast(errorText(t, e), "error");
    } finally {
      setBusy(false);
    }
  };

  const d = day.data;
  const accepted = d?.events.filter((e) => e.status === "ACCEPTED") ?? [];
  const rejected = d?.events.filter((e) => e.status === "REJECTED") ?? [];

  return (
    <Sheet open onClose={onClose} title={`${d?.userName ?? ""} · ${dayLabel(date, lang)}`}>
      {!d && <Skeleton className="h-64 w-full rounded-[20px]" />}
      {d && mode.kind === "view" && (
        <>
          <DaySummary day={d} />
          <SectionTitle
            action={
              <Button variant="ghost" size="sm" full={false} icon={<Plus size={16} />} onClick={() => setMode({ kind: "add" })}>
                {t("d.add_event")}
              </Button>
            }
          >
            {t("d.events")}
          </SectionTitle>
          {accepted.length > 0 ? <EventList events={accepted} /> : <p className="px-1 text-hint">{t("c.none")}</p>}
          {accepted.some((e) => !e.voided) && (
            <div className="mt-2 flex flex-wrap gap-2">
              {accepted
                .filter((e) => !e.voided)
                .map((e) => (
                  <Button
                    key={e.id}
                    variant="secondary"
                    size="sm"
                    full={false}
                    icon={<Pencil size={14} />}
                    onClick={() => {
                      setTime(e.localTime);
                      setMode({ kind: "edit", event: e });
                    }}
                  >
                    {e.localTime}
                  </Button>
                ))}
            </div>
          )}
          {rejected.length > 0 && (
            <>
              <SectionTitle>{t("d.rejected")}</SectionTitle>
              <EventList events={rejected} />
            </>
          )}
          {d.result && (
            <div className="mt-4">
              {d.result.reviewedAt ? (
                <p className="mb-2 flex items-center gap-2 text-ok">
                  <CircleCheck size={18} /> {t("d.reviewed")}
                </p>
              ) : null}
              <Button
                variant={d.result.needsReview && !d.result.reviewedAt ? "primary" : "secondary"}
                onClick={() => {
                  setManual(d.result!.manualEarned ?? d.result!.earned);
                  setUseManual(d.result!.manualEarned !== null ? "manual" : "formula");
                  setMode({ kind: "review" });
                }}
              >
                {t("d.confirm_review")}
              </Button>
            </div>
          )}
          {d.audit.length > 0 && (
            <>
              <SectionTitle>{t("d.audit")}</SectionTitle>
              <ListCard>
                {d.audit.map((a) => (
                  <ListRow key={a.id} title={`${a.actor} · ${a.action}`} subtitle={`${new Date(a.at).toLocaleString()}${a.comment ? ` · ${a.comment}` : ""}`} />
                ))}
              </ListCard>
            </>
          )}
        </>
      )}

      {d && mode.kind !== "view" && (
        <div className="flex flex-col gap-4">
          {mode.kind === "add" && (
            <Field label={t("d.event_type")}>
              <Select value={type} onChange={(e) => setType(e.target.value as EventType)}>
                {(["CHECK_IN", "BREAK_START", "BREAK_END", "CHECK_OUT"] as EventType[]).map((x) => (
                  <option key={x} value={x}>
                    {t(`evp.${x}`)}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {(mode.kind === "add" || mode.kind === "edit") && (
            <Field label={t("d.event_time")}>
              <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="tabular" />
            </Field>
          )}
          {mode.kind === "review" && d.result && (
            <>
              <Segmented
                value={useManual}
                onChange={setUseManual}
                options={[
                  { value: "formula", label: `${t("d.clear_earned")} (${formatMoney(d.result.computedEarned, me.company.currency, lang)})` },
                  { value: "manual", label: t("d.set_earned") },
                ]}
              />
              {useManual === "manual" && <MoneyInput value={manual} currency={me.company.currency} onChange={(v) => setManual(v)} placeholder={moneyToInput(d.result.earned, me.company.currency)} />}
            </>
          )}
          <Field label={t("c.comment_required")}>
            <TextArea value={comment} maxLength={500} onChange={(e) => setComment(e.target.value)} />
          </Field>
          <Button
            loading={busy}
            disabled={comment.trim().length < 2}
            onClick={() => {
              if (mode.kind === "edit") return run(() => api(`/admin/events/${mode.event.id}`, { method: "PATCH", body: { time, comment } }));
              if (mode.kind === "add")
                return run(() => api("/admin/events", { body: { userId, date, type, time, comment, branchId: d.branchId } }));
              return run(() =>
                api("/admin/day/review", { body: { userId, date, comment, ...(useManual === "manual" ? { manualEarned: manual } : { manualEarned: null }) } }),
              );
            }}
          >
            {t("c.save")}
          </Button>
          {mode.kind === "edit" && (
            <Button variant="danger" disabled={comment.trim().length < 2} onClick={() => run(() => api(`/admin/events/${mode.event.id}/void`, { body: { comment } }))}>
              {t("d.void_event")}
            </Button>
          )}
          <Button variant="ghost" onClick={() => setMode({ kind: "view" })}>
            {t("c.cancel")}
          </Button>
        </div>
      )}
    </Sheet>
  );
}
