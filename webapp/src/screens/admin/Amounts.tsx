// Daily amount grid: rows = workers, columns = days. The table scrolls inside its card.

import { useState } from "react";
import { ChevronLeft, ChevronRight, Lock, TriangleAlert } from "lucide-react";
import { formatMoney, type Currency } from "@shared/money.ts";
import { shiftMonth, weekdayOf } from "@shared/time.ts";
import { api, useApi } from "../../api.ts";
import { dayLabel, monthName, useLang, useT, type Key } from "../../i18n/index.tsx";
import { useNav } from "../../nav.tsx";
import { haptic } from "../../telegram/tg.ts";
import { Button, Card, Chip, ErrorState, Field, IconButton, Page, Sheet, SkeletonScreen, errorText, useToast } from "../../ui/index.ts";
import { MoneyInput } from "../../ui/MoneyInput.tsx";
import { thisMonth } from "../worker/Month.tsx";

interface Grid {
  month: string;
  currency: Currency;
  locked: boolean;
  dates: string[];
  missing: number;
  workers: {
    userId: number;
    name: string;
    defaultDailyAmount: number | null;
    cells: { date: string; working: boolean; amount: number | null; effective: number | null }[];
  }[];
}

function compact(n: number, currency: Currency): string {
  if (currency === "USD") return `$${(n / 100).toFixed(n % 100 ? 2 : 0)}`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

export default function AmountsScreen({ branchId }: { branchId: number }) {
  const t = useT();
  const lang = useLang();
  const nav = useNav();
  const toast = useToast();
  const [month, setMonth] = useState(thisMonth);
  const grid = useApi<Grid>(`/admin/branches/${branchId}/amounts?month=${month}`);
  const [selected, setSelected] = useState<number[]>([]);
  const [cell, setCell] = useState<{ userId: number; name: string; date: string; amount: number | null } | null>(null);
  const [bulk, setBulk] = useState(false);
  const [value, setValue] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  if (grid.error) return <ErrorState error={grid.error} onRetry={grid.reload} />;
  if (!grid.data) return <SkeletonScreen />;
  const g = grid.data;

  const save = async (work: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await work();
      haptic.success();
      toast(t("c.saved"));
      setCell(null);
      setBulk(false);
      grid.reload();
    } catch (e) {
      toast(errorText(t, e), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page title={t("amt.title")} onBack={nav.pop}>
      <div className="mb-3 flex items-center justify-between">
        <IconButton label="‹" onClick={() => setMonth(shiftMonth(month, -1))}>
          <ChevronLeft size={24} />
        </IconButton>
        <span className="flex items-center gap-2 text-[18px] font-bold">
          {monthName(month, lang)} {g.locked && <Lock size={16} className="text-hint" />}
        </span>
        <IconButton label="›" onClick={() => setMonth(shiftMonth(month, 1))}>
          <ChevronRight size={24} />
        </IconButton>
      </div>
      {g.missing > 0 && (
        <div className="mb-3">
          <Chip tone="late" icon={<TriangleAlert size={14} />}>
            {t("amt.missing", { n: g.missing })}
          </Chip>
        </div>
      )}

      <Card padded={false} className="overflow-hidden">
        <div className="scroll-x">
          <table className="border-separate border-spacing-0 text-[13px]">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 min-w-[132px] bg-card px-3 py-2 text-left">
                  <label className="flex items-center gap-2 font-semibold">
                    <input
                      type="checkbox"
                      className="h-5 w-5 accent-[var(--app-accent)]"
                      checked={selected.length === g.workers.length && g.workers.length > 0}
                      onChange={(e) => setSelected(e.target.checked ? g.workers.map((w) => w.userId) : [])}
                      aria-label={t("amt.select_all")}
                    />
                    {t("r.worker")}
                  </label>
                </th>
                {g.dates.map((date) => {
                  const wd = weekdayOf(date);
                  return (
                    <th key={date} className="min-w-[48px] px-1 py-2 text-center font-semibold text-hint">
                      <div className="tabular text-ink">{Number(date.slice(8))}</div>
                      <div className="text-[11px]">{t(`sch.wd${wd}` as Key)}</div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {g.workers.map((w) => (
                <tr key={w.userId}>
                  <td className="sticky left-0 z-10 border-t border-sep bg-card px-3 py-1">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        className="h-5 w-5 shrink-0 accent-[var(--app-accent)]"
                        checked={selected.includes(w.userId)}
                        onChange={(e) => setSelected(e.target.checked ? [...selected, w.userId] : selected.filter((id) => id !== w.userId))}
                      />
                      <span className="max-w-[96px] truncate text-[14px] font-medium">{w.name}</span>
                    </label>
                  </td>
                  {w.cells.map((c) => {
                    const missing = c.working && c.effective === null;
                    return (
                      <td key={c.date} className="border-t border-sep p-0.5">
                        <button
                          type="button"
                          disabled={g.locked}
                          onClick={() => {
                            setValue(c.amount ?? c.effective);
                            setCell({ userId: w.userId, name: w.name, date: c.date, amount: c.amount });
                          }}
                          aria-label={t("amt.cell", { name: w.name, date: dayLabel(c.date, lang) })}
                          className={`tabular h-11 w-full min-w-[46px] rounded-lg text-[12px] font-semibold ${
                            !c.working ? "bg-off-soft text-off" : missing ? "bg-late-soft text-late" : c.amount !== null ? "bg-accent-soft text-accent" : "text-ink"
                          }`}
                        >
                          {c.effective !== null ? compact(c.effective, g.currency) : missing ? "!" : "·"}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="mt-4">
        <Button disabled={!selected.length || g.locked} onClick={() => (setValue(null), setBulk(true))}>
          {t("amt.bulk")} {selected.length ? `(${selected.length})` : ""}
        </Button>
      </div>
      <div className="h-8" />

      <Sheet open={Boolean(cell)} onClose={() => setCell(null)} title={cell ? t("amt.cell", { name: cell.name, date: dayLabel(cell.date, lang) }) : ""}>
        <Field label={t("d.amount")}>
          <MoneyInput value={value} currency={g.currency} onChange={(v) => setValue(v)} />
        </Field>
        <div className="mt-4 flex flex-col gap-3">
          <Button loading={busy} disabled={value === null} onClick={() => save(() => api(`/admin/branches/${branchId}/amounts`, { method: "PUT", body: { cells: [{ userId: cell!.userId, date: cell!.date, amount: value }] } }))}>
            {t("c.save")}
          </Button>
          {cell?.amount !== null && (
            <Button variant="secondary" onClick={() => save(() => api(`/admin/branches/${branchId}/amounts`, { method: "PUT", body: { cells: [{ userId: cell!.userId, date: cell!.date, amount: null }] } }))}>
              {t("amt.clear")}
            </Button>
          )}
        </div>
      </Sheet>

      <Sheet open={bulk} onClose={() => setBulk(false)} title={t("amt.bulk")}>
        <p className="mb-3 text-[15px] text-hint">{t("amt.bulk_text")}</p>
        <MoneyInput value={value} currency={g.currency} onChange={(v) => setValue(v)} />
        {value !== null && <p className="mt-2 px-1 text-[15px] font-semibold">{formatMoney(value, g.currency, lang)}</p>}
        <div className="mt-4">
          <Button loading={busy} disabled={value === null} onClick={() => save(() => api(`/admin/branches/${branchId}/amounts/bulk`, { body: { month, userIds: selected, amount: value } }))}>
            {t("amt.bulk_ok")}
          </Button>
        </div>
      </Sheet>
    </Page>
  );
}
