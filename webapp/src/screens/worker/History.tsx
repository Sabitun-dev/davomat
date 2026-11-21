import { useEffect, useState } from "react";
import { formatMoney } from "@shared/money.ts";
import { api } from "../../api.ts";
import { dayLabel, useLang, useT } from "../../i18n/index.tsx";
import { useNav } from "../../nav.tsx";
import { useSession } from "../../session.tsx";
import { Button, EmptyState, ErrorState, ListCard, ListRow, Page, SkeletonScreen, StatusChip, lookOf } from "../../ui/index.ts";
import type { DayResult } from "../../types.ts";

type Row = DayResult & { branchName: string; checkIn: string | null; checkOut: string | null };

export default function HistoryScreen() {
  const t = useT();
  const lang = useLang();
  const nav = useNav();
  const { me } = useSession();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [more, setMore] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = async (before?: string) => {
    setBusy(true);
    try {
      const page = await api<Row[]>(`/worker/history${before ? `?before=${before}` : ""}`);
      setRows((r) => [...(before ? (r ?? []) : []), ...page]);
      setMore(page.length === 30);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);

  if (error && !rows) return <ErrorState error={error} onRetry={() => load()} />;
  if (!rows) return <SkeletonScreen />;
  return (
    <Page title={t("h.title")} onBack={nav.pop}>
      {rows.length === 0 && <EmptyState picture="calendar" text={t("h.empty")} />}
      {rows.length > 0 && (
        <ListCard>
          {rows.map((r) => (
            <ListRow
              key={r.date}
              title={dayLabel(r.date, lang)}
              subtitle={[r.checkIn && r.checkOut ? `${r.checkIn}–${r.checkOut}` : r.checkIn, r.amount !== null ? formatMoney(r.earned, me.company!.currency, lang) : null].filter(Boolean).join(" · ") || r.branchName}
              right={<StatusChip look={lookOf(r)} text={r.lateMin > 0 && lookOf(r) === "LATE" ? t("w.late_min", { n: r.lateMin }) : undefined} />}
              onClick={() => nav.push("day", { date: r.date })}
            />
          ))}
        </ListCard>
      )}
      {more && rows.length > 0 && (
        <div className="mt-4">
          <Button variant="secondary" loading={busy} onClick={() => load(rows[rows.length - 1].date)}>
            {t("h.more")}
          </Button>
        </div>
      )}
      <div className="h-8" />
    </Page>
  );
}
