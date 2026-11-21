// One worker's month for an admin: calendar, totals, bonuses/fines, and the day drawer.

import { useState } from "react";
import { ChevronLeft, ChevronRight, Minus, Plus, Trash2 } from "lucide-react";
import { formatMoney } from "@shared/money.ts";
import { shiftMonth } from "@shared/time.ts";
import { api, invalidate, useApi } from "../../api.ts";
import { monthName, useLang, useT } from "../../i18n/index.tsx";
import { useNav } from "../../nav.tsx";
import { useSession } from "../../session.tsx";
import { confirm } from "../../telegram/tg.ts";
import { Button, Card, Field, IconButton, ListCard, ListRow, Page, SectionTitle, Sheet, Skeleton, StatTile, TextArea, errorText, useToast } from "../../ui/index.ts";
import { MoneyInput } from "../../ui/MoneyInput.tsx";
import { MonthCalendar, thisMonth } from "../worker/Month.tsx";
import { DayDrawer } from "./DayDrawer.tsx";
import { hoursText, type Totals } from "./Reports.tsx";

interface Adjustment {
  id: number;
  kind: "BONUS" | "FINE";
  amount: number;
  comment: string;
}

export default function WorkerReport({ userId, name, month: initial }: { userId: number; name: string; month?: string }) {
  const t = useT();
  const lang = useLang();
  const nav = useNav();
  const toast = useToast();
  const { me } = useSession();
  const [month, setMonth] = useState(initial ?? thisMonth());
  const report = useApi<{ rows: Totals[]; locked: boolean }>(`/admin/reports/month?month=${month}&userId=${userId}`);
  const table = useApi<{ today: string; days: { date: string; status: string; needsReview: boolean; reviewedAt: string | null; lateMin: number; earned: number }[] }>(
    `/admin/reports/worker-days?month=${month}&userId=${userId}`,
  );
  const adjustments = useApi<Adjustment[]>(`/admin/adjustments?month=${month}&userId=${userId}`);
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState<"BONUS" | "FINE" | null>(null);
  const [amount, setAmount] = useState<number | null>(null);
  const [comment, setComment] = useState("");

  const money = (n: number) => formatMoney(n, me.company!.currency, lang);
  // A worker can have rows in two branches; add them up.
  const rows = report.data?.rows ?? [];
  const sum = (k: keyof Totals) => rows.reduce((s, r) => s + (r[k] as number), 0);
  const days = table.data?.days;

  const add = async () => {
    try {
      await api("/admin/adjustments", { body: { userId, month, kind: adding, amount, comment } });
      toast(t("c.saved"));
      setAdding(null);
      setAmount(null);
      setComment("");
      invalidate("/admin");
    } catch (e) {
      toast(errorText(t, e), "error");
    }
  };
  const remove = async (id: number) => {
    if (!(await confirm(`${t("c.delete")}?`))) return;
    await api(`/admin/adjustments/${id}`, { method: "DELETE" }).catch((e) => toast(errorText(t, e), "error"));
    invalidate("/admin");
  };

  return (
    <Page title={name} onBack={nav.pop}>
      <div className="mb-3 flex items-center justify-between">
        <IconButton label="‹" onClick={() => setMonth(shiftMonth(month, -1))}>
          <ChevronLeft size={24} />
        </IconButton>
        <span className="text-[18px] font-bold">{monthName(month, lang)}</span>
        <IconButton label="›" onClick={() => setMonth(shiftMonth(month, 1))}>
          <ChevronRight size={24} />
        </IconButton>
      </div>
      <Card>{days && table.data ? <MonthCalendar data={{ days, today: table.data.today }} onDay={setOpen} /> : <Skeleton className="h-72 w-full" />}</Card>
      {report.data && (
        <>
          <div className="mt-3">
            <StatTile label={t("r.salary")} value={money(sum("salary"))} hint={`${money(sum("earned"))} / ${money(sum("max"))}`} tone="accent" />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <StatTile label={t("r.worked_hours")} value={hoursText(sum("workedMin"))} hint={`${t("r.days_worked")}: ${sum("daysWorked")}`} />
            <StatTile label={t("r.times_late")} value={sum("timesLate")} hint={t("c.min", { n: sum("lateMin") })} tone={sum("timesLate") ? "late" : undefined} />
            <StatTile label={t("r.absent")} value={sum("absent")} tone={sum("absent") ? "bad" : undefined} />
            <StatTile label={t("r.early_min")} value={t("c.min", { n: sum("earlyMin") })} />
            <StatTile label={t("r.overage_min")} value={t("c.min", { n: sum("overageMin") })} />
            <StatTile label={t("r.overtime_min")} value={t("c.min", { n: sum("overtimeMin") })} tone={sum("overtimeMin") ? "ok" : undefined} />
          </div>
        </>
      )}
      <SectionTitle>{t("r.adjustments")}</SectionTitle>
      {adjustments.data && adjustments.data.length > 0 && (
        <ListCard>
          {adjustments.data.map((a) => (
            <ListRow
              key={a.id}
              icon={a.kind === "BONUS" ? <Plus size={20} /> : <Minus size={20} />}
              danger={a.kind === "FINE"}
              title={`${a.kind === "BONUS" ? "+" : "−"}${money(a.amount)}`}
              subtitle={a.comment}
              right={
                !report.data?.locked ? (
                  <button type="button" aria-label={t("c.delete")} onClick={() => remove(a.id)} className="flex h-11 w-11 items-center justify-center text-bad">
                    <Trash2 size={20} />
                  </button>
                ) : undefined
              }
            />
          ))}
        </ListCard>
      )}
      {!report.data?.locked && (
        <div className="mt-3 grid grid-cols-2 gap-3">
          <Button variant="soft" icon={<Plus size={18} />} onClick={() => setAdding("BONUS")}>
            {t("r.add_bonus")}
          </Button>
          <Button variant="danger" icon={<Minus size={18} />} onClick={() => setAdding("FINE")}>
            {t("r.add_fine")}
          </Button>
        </div>
      )}
      <div className="h-8" />
      <Sheet open={Boolean(adding)} onClose={() => setAdding(null)} title={adding === "BONUS" ? t("r.add_bonus") : t("r.add_fine")}>
        <div className="flex flex-col gap-4">
          <Field label={t("r.amount")}>
            <MoneyInput value={amount} currency={me.company!.currency} onChange={(v) => setAmount(v)} />
          </Field>
          <Field label={t("c.comment_required")}>
            <TextArea value={comment} onChange={(e) => setComment(e.target.value)} />
          </Field>
          <Button disabled={!amount || comment.trim().length < 2} onClick={add}>
            {t("c.save")}
          </Button>
        </div>
      </Sheet>
      {open && <DayDrawer userId={userId} date={open} onClose={() => setOpen(null)} />}
    </Page>
  );
}
