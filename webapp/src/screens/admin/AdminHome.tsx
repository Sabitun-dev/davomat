// Admin root: four tabs at the bottom (Today, Branches, Reports, More).

import { lazy, Suspense, useState } from "react";
import { Building2, ChartColumn, ChevronRight, Ellipsis, MapPin, Plus, Settings, Shield, SlidersHorizontal, Sun, UserRound } from "lucide-react";
import { useApi } from "../../api.ts";
import { useT } from "../../i18n/index.tsx";
import { useNav } from "../../nav.tsx";
import { useSession } from "../../session.tsx";
import { haptic } from "../../telegram/tg.ts";
import { Button, Card, Chip, EmptyState, ErrorState, ListCard, ListRow, Page, SkeletonScreen } from "../../ui/index.ts";
import type { Branch } from "../../types.ts";

const Dashboard = lazy(() => import("./Dashboard.tsx"));
const Reports = lazy(() => import("./Reports.tsx"));

type Tab = "today" | "branches" | "reports" | "more";

export default function AdminHome() {
  const t = useT();
  const [tab, setTab] = useState<Tab>(() => (sessionStorage.getItem("adminTab") as Tab) || "today");
  const pick = (v: Tab) => {
    haptic.select();
    setTab(v);
    try {
      sessionStorage.setItem("adminTab", v);
    } catch {
      // ignore
    }
    window.scrollTo(0, 0);
  };
  const tabs: { id: Tab; label: string; Icon: typeof Sun }[] = [
    { id: "today", label: t("a.tab_today"), Icon: Sun },
    { id: "branches", label: t("a.tab_branches"), Icon: Building2 },
    { id: "reports", label: t("a.tab_reports"), Icon: ChartColumn },
    { id: "more", label: t("a.tab_more"), Icon: Ellipsis },
  ];
  return (
    <>
      <div className="pb-24">
        <Suspense fallback={<SkeletonScreen />}>
          {tab === "today" && <Dashboard />}
          {tab === "branches" && <BranchesTab />}
          {tab === "reports" && <Reports />}
          {tab === "more" && <MoreTab />}
        </Suspense>
      </div>
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-sep bg-card/95 backdrop-blur safe-bottom" style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0px), 6px)" }}>
        <div className="mx-auto grid max-w-[560px] grid-cols-4">
          {tabs.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              aria-current={tab === id ? "page" : undefined}
              onClick={() => pick(id)}
              className={`flex min-h-[56px] flex-col items-center justify-center gap-0.5 text-[12px] font-semibold ${tab === id ? "text-accent" : "text-hint"}`}
            >
              <Icon size={24} strokeWidth={tab === id ? 2.4 : 2} />
              {label}
            </button>
          ))}
        </div>
      </nav>
    </>
  );
}

function BranchesTab() {
  const t = useT();
  const nav = useNav();
  const branches = useApi<Branch[]>("/admin/branches");
  return (
    <Page
      title={t("b.title")}
      right={
        <Button full={false} size="sm" icon={<Plus size={18} />} onClick={() => nav.push("branchEditor")}>
          {t("b.new")}
        </Button>
      }
    >
      {branches.error && <ErrorState error={branches.error} onRetry={branches.reload} />}
      {!branches.data && !branches.error && <SkeletonScreen />}
      {branches.data?.length === 0 && (
        <EmptyState
          picture="branch"
          text={t("dash.no_branches")}
          action={
            <Button full={false} className="min-w-[200px]" onClick={() => nav.push("branchEditor")}>
              {t("dash.create_branch")}
            </Button>
          }
        />
      )}
      <div className="flex flex-col gap-3">
        {branches.data?.map((b) => (
          <Card key={b.id} onClick={() => nav.push("branch", { id: b.id })}>
            <div className="flex items-center gap-3">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-accent-soft text-accent">
                <MapPin size={24} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[17px] font-semibold">{b.name}</span>
                <span className="block truncate text-[14px] text-hint">{b.address || b.timezone}</span>
              </span>
              <span className="flex flex-col items-end gap-1">
                <Chip tone={b.active ? "accent" : "off"}>{b.active ? t("b.workers_count", { n: b.workerCount ?? 0 }) : t("b.inactive")}</Chip>
              </span>
              <ChevronRight size={20} className="text-hint" />
            </div>
          </Card>
        ))}
      </div>
    </Page>
  );
}

function MoreTab() {
  const t = useT();
  const nav = useNav();
  const { me } = useSession();
  return (
    <Page title={t("more.title")} subtitle={`${me.company.name} · ${t(`role.${me.role}`)}`}>
      <ListCard>
        {me.branches.length > 0 && (
          <ListRow icon={<UserRound size={20} />} title={t("a.my_attendance")} onClick={() => nav.push("workerHome")} />
        )}
        {me.role === "OWNER" && <ListRow icon={<Shield size={20} />} title={t("more.admins")} onClick={() => nav.push("admins")} />}
        {me.role === "OWNER" && (
          <ListRow icon={<SlidersHorizontal size={20} />} title={t("more.company")} onClick={() => nav.push("company")} />
        )}
        <ListRow icon={<Settings size={20} />} title={t("more.settings")} onClick={() => nav.push("settings")} />
      </ListCard>
    </Page>
  );
}
