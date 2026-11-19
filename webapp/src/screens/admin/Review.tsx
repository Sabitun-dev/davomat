// Days flagged for review: no check-out, missing video, suspicious location patterns.

import { useState } from "react";
import { useApi } from "../../api.ts";
import { dayLabel, useLang, useT, type Key } from "../../i18n/index.tsx";
import { useNav } from "../../nav.tsx";
import { EmptyState, ErrorState, ListCard, ListRow, Page, SkeletonScreen } from "../../ui/index.ts";
import { DayDrawer } from "./DayDrawer.tsx";

export default function ReviewScreen() {
  const t = useT();
  const lang = useLang();
  const nav = useNav();
  const list = useApi<{ userId: number; name: string; branchName: string; date: string; flags: string[] }[]>("/admin/review");
  const [open, setOpen] = useState<{ userId: number; date: string } | null>(null);
  if (list.error) return <ErrorState error={list.error} onRetry={list.reload} />;
  if (!list.data) return <SkeletonScreen />;
  return (
    <Page title={t("rev.title")} onBack={nav.pop}>
      {list.data.length === 0 ? (
        <EmptyState picture="privacy" text={t("rev.empty")} />
      ) : (
        <ListCard>
          {list.data.map((r) => (
            <ListRow
              key={`${r.userId}-${r.date}`}
              title={`${r.name} · ${dayLabel(r.date, lang)}`}
              subtitle={r.flags.filter((f) => f !== "missing_amount").map((f) => t(`flag.${f}` as Key)).join(" · ")}
              onClick={() => setOpen({ userId: r.userId, date: r.date })}
            />
          ))}
        </ListCard>
      )}
      {open && (
        <DayDrawer
          userId={open.userId}
          date={open.date}
          onClose={() => {
            setOpen(null);
            list.reload();
          }}
        />
      )}
    </Page>
  );
}
