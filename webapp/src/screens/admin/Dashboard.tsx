// "Bugun": who is working, on break, late, not arrived, and what needs review.

import { useState } from "react";
import { Briefcase, Clock, Coffee, Flag, UserX } from "lucide-react";
import { useApi } from "../../api.ts";
import { useT } from "../../i18n/index.tsx";
import { useNav } from "../../nav.tsx";
import { useSession } from "../../session.tsx";
import { haptic } from "../../telegram/tg.ts";
import { Badge, Card, EmptyState, ErrorState, ListCard, ListRow, Page, SectionTitle, SkeletonScreen, StatTile } from "../../ui/index.ts";
import type { Branch } from "../../types.ts";
import { DayDrawer } from "./DayDrawer.tsx";

interface Person {
  userId: number;
  name: string;
  branch: string;
}
interface Dash {
  working: (Person & { since: string })[];
  onBreak: (Person & { since: string })[];
  late: (Person & { lateMin: number; time: string })[];
  notArrived: (Person & { start: string })[];
  reviewCount: number;
  dates: Record<number, string>;
}

export function BranchChips({ value, onChange }: { value: number | null; onChange: (id: number | null) => void }) {
  const t = useT();
  const branches = useApi<Branch[]>("/admin/branches");
  const list = branches.data?.filter((b) => b.active) ?? [];
  if (list.length < 2) return null;
  const chip = (id: number | null, label: string) => (
    <button
      key={id ?? "all"}
      type="button"
      onClick={() => {
        haptic.select();
        onChange(id);
      }}
      className={`min-h-[40px] shrink-0 rounded-full px-4 text-[15px] font-semibold ${value === id ? "bg-accent-strong text-accent-ink" : "bg-card text-ink shadow-soft"}`}
    >
      {label}
    </button>
  );
  return (
    <div className="scroll-x -mx-4 mb-3 flex gap-2 px-4 py-1">
      {chip(null, t("dash.all_branches"))}
      {list.map((b) => chip(b.id, b.name))}
    </div>
  );
}

export default function Dashboard() {
  const t = useT();
  const nav = useNav();
  const { me } = useSession();
  const [branchId, setBranchId] = useState<number | null>(null);
  const dash = useApi<Dash>(`/admin/dashboard${branchId ? `?branchId=${branchId}` : ""}`);
  const branches = useApi<Branch[]>("/admin/branches");
  const [open, setOpen] = useState<{ userId: number; date: string } | null>(null);

  const today = dash.data ? Object.values(dash.data.dates)[0] : undefined;
  const openDay = (userId: number) => today && setOpen({ userId, date: today });

  if (branches.data && branches.data.length === 0)
    return (
      <Page title={t("a.tab_today")} subtitle={me.company.name}>
        <EmptyState picture="branch" text={t("dash.no_branches")} />
      </Page>
    );

  const list = (items: (Person & { right: string })[]) =>
    items.length === 0 ? (
      <p className="px-1 text-[15px] text-hint">{t("dash.nobody")}</p>
    ) : (
      <ListCard>
        {items.map((p) => (
          <ListRow key={`${p.userId}-${p.branch}`} title={p.name} subtitle={p.branch} right={<span className="tabular">{p.right}</span>} onClick={() => openDay(p.userId)} />
        ))}
      </ListCard>
    );

  return (
    <Page title={t("a.tab_today")} subtitle={me.company.name}>
      <BranchChips value={branchId} onChange={setBranchId} />
      {dash.error && <ErrorState error={dash.error} onRetry={dash.reload} />}
      {!dash.data && !dash.error && <SkeletonScreen />}
      {dash.data && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <StatTile label={t("dash.working")} value={dash.data.working.length} tone="ok" icon={<Briefcase size={15} />} />
            <StatTile label={t("dash.on_break")} value={dash.data.onBreak.length} tone="brk" icon={<Coffee size={15} />} />
            <StatTile label={t("dash.late")} value={dash.data.late.length} tone={dash.data.late.length ? "late" : undefined} icon={<Clock size={15} />} />
            <StatTile label={t("dash.not_arrived")} value={dash.data.notArrived.length} tone={dash.data.notArrived.length ? "bad" : undefined} icon={<UserX size={15} />} />
          </div>
          {dash.data.reviewCount > 0 && (
            <div className="mt-3">
              <Card onClick={() => nav.push("review")}>
                <div className="flex items-center gap-3">
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-late-soft text-late">
                    <Flag size={22} />
                  </span>
                  <span className="flex-1 text-[17px] font-semibold">{t("dash.flags")}</span>
                  <Badge tone="late">{dash.data.reviewCount}</Badge>
                </div>
              </Card>
            </div>
          )}
          <SectionTitle>{t("dash.late")}</SectionTitle>
          {list(dash.data.late.map((p) => ({ ...p, right: `${p.time} · +${p.lateMin}` })))}
          <SectionTitle>{t("dash.not_arrived")}</SectionTitle>
          {list(dash.data.notArrived.map((p) => ({ ...p, right: p.start })))}
          <SectionTitle>{t("dash.on_break")}</SectionTitle>
          {list(dash.data.onBreak.map((p) => ({ ...p, right: p.since })))}
          <SectionTitle>{t("dash.working")}</SectionTitle>
          {list(dash.data.working.map((p) => ({ ...p, right: p.since })))}
        </>
      )}
      {open && <DayDrawer userId={open.userId} date={open.date} onClose={() => setOpen(null)} />}
    </Page>
  );
}
