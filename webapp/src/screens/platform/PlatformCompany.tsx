// Platform owner: one company — numbers, +1 oy, pause/activate, edit fields, owners. No delete button.

import { useEffect, useState } from "react";
import { CalendarPlus, Pause, Play, UserPlus, Users } from "lucide-react";
import { api, invalidate, useApi } from "../../api.ts";
import { dayLabel, useLang, useT } from "../../i18n/index.tsx";
import { useNav } from "../../nav.tsx";
import { confirm, haptic } from "../../telegram/tg.ts";
import { Button, Card, ErrorState, Field, Input, ListCard, ListRow, Page, SectionTitle, SkeletonScreen, StatTile, TextArea, errorText, useToast } from "../../ui/index.ts";
import type { PlatformCompany } from "../../types.ts";
import { CompanyChip, OwnerLinkBox, PaidUntilPicker } from "./Platform.tsx";

export default function PlatformCompanyScreen({ id }: { id: number }) {
  const t = useT();
  const lang = useLang();
  const nav = useNav();
  const toast = useToast();
  const company = useApi<PlatformCompany>(`/platform/companies/${id}`);
  const [name, setName] = useState("");
  const [paidUntil, setPaidUntil] = useState<string | null>(null);
  const [maxWorkers, setMaxWorkers] = useState("");
  const [note, setNote] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    const c = company.data;
    if (!c) return;
    setName(c.name);
    setPaidUntil(c.paidUntil);
    setMaxWorkers(c.maxWorkers ? String(c.maxWorkers) : "");
    setNote(c.note);
  }, [company.data]);

  if (company.error) return <ErrorState error={company.error} onRetry={company.reload} />;
  if (!company.data) return <SkeletonScreen />;
  const c = company.data;

  const run = async (key: string, work: () => Promise<PlatformCompany | { company: PlatformCompany; notified: boolean; link: string }>, done?: (r: PlatformCompany) => string) => {
    setBusy(key);
    try {
      const r = await work();
      const updated = "company" in r ? r.company : r;
      company.setData(updated);
      invalidate("/platform/companies");
      haptic.success();
      if ("company" in r && !r.notified) setLink(r.link);
      toast(done ? done(updated) : t("c.saved"));
    } catch (e) {
      toast(errorText(t, e), "error");
    } finally {
      setBusy(null);
    }
  };

  const suspended = !c.active;
  return (
    <Page title={c.name} subtitle={<CompanyChip c={c} />} onBack={nav.pop}>
      <div className="grid grid-cols-2 gap-3">
        <StatTile label={t("pl.branches")} value={c.stats?.branches ?? 0} />
        <StatTile label={t("pl.active_workers")} value={c.maxWorkers ? `${c.workers} / ${c.maxWorkers}` : c.workers} icon={<Users size={15} />} />
        <StatTile label={t("pl.checkins30")} value={c.stats?.checkIns30 ?? 0} />
        <StatTile
          label={t("pl.last_activity")}
          value={c.stats?.lastActivity ? dayLabel(c.stats.lastActivity.slice(0, 10), lang) : t("pl.never")}
        />
      </div>

      <Card className="mt-3 flex flex-col gap-3">
        <p className="text-[15px] text-hint">{c.paidUntil ? t("pl.until", { date: dayLabel(c.paidUntil, lang) }) : t("pl.no_end")}</p>
        <Button icon={<CalendarPlus size={20} />} loading={busy === "extend"} onClick={() => run("extend", () => api(`/platform/companies/${id}/extend`, { body: { months: 1 } }), (u) => t("pl.extended", { date: dayLabel(u.paidUntil!, lang) }))}>
          {t("pl.extend")}
        </Button>
        <Button
          variant={suspended ? "soft" : "danger"}
          icon={suspended ? <Play size={20} /> : <Pause size={20} />}
          loading={busy === "active"}
          onClick={async () => {
            if (!(await confirm(t(suspended ? "pl.activate_confirm" : "pl.suspend_confirm")))) return;
            await run("active", () => api(`/platform/companies/${id}/active`, { body: { active: suspended } }));
          }}
        >
          {suspended ? t("pl.activate") : t("pl.suspend")}
        </Button>
      </Card>

      <SectionTitle>{t("pl.details")}</SectionTitle>
      <Card className="flex flex-col gap-4">
        <Field label={t("pl.name")}>
          <Input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t("pl.paid_until")}>
          <PaidUntilPicker key={c.paidUntil ?? "none"} editing value={paidUntil} onChange={setPaidUntil} />
        </Field>
        <Field label={t("pl.max_workers")} hint={t("pl.max_workers_hint")}>
          <Input inputMode="numeric" value={maxWorkers} maxLength={6} onChange={(e) => setMaxWorkers(e.target.value.replace(/\D/g, ""))} className="tabular" />
        </Field>
        <Field label={t("pl.note")}>
          <TextArea value={note} maxLength={1000} placeholder={t("pl.note_ph")} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <Button
          loading={busy === "save"}
          disabled={!name.trim()}
          onClick={() =>
            run("save", () =>
              api(`/platform/companies/${id}`, { method: "PATCH", body: { name, paidUntil, maxWorkers: maxWorkers ? Number(maxWorkers) : null, note } }),
            )
          }
        >
          {t("c.save")}
        </Button>
      </Card>

      <SectionTitle>{t("pl.owners")}</SectionTitle>
      <ListCard>
        {c.owners.map((o) => (
          <ListRow key={o.userId} title={o.opened && o.name ? o.name : o.telegramId} subtitle={o.opened ? o.telegramId : t("pl.owner_not_opened")} />
        ))}
      </ListCard>
      <div className="mt-3 flex gap-2">
        <Input inputMode="numeric" value={ownerId} maxLength={15} placeholder={t("pl.owner_id")} onChange={(e) => setOwnerId(e.target.value.replace(/\D/g, ""))} className="tabular" />
        <Button
          full={false}
          variant="soft"
          aria-label={t("pl.add_owner")}
          icon={<UserPlus size={20} />}
          loading={busy === "owner"}
          disabled={ownerId.length < 5}
          onClick={() =>
            run("owner", async () => {
              const r = await api<{ company: PlatformCompany; notified: boolean; link: string }>(`/platform/companies/${id}/owners`, { body: { telegramId: ownerId } });
              setOwnerId("");
              return r;
            })
          }
          className="shrink-0 px-4"
        />
      </div>
      <p className="mt-1 px-1 text-[13px] text-hint">{t("pl.add_owner")} · {t("pl.owner_id_hint")}</p>
      {link && (
        <div className="mt-3">
          <OwnerLinkBox link={link} />
        </div>
      )}

      <SectionTitle>{t("pl.group")}</SectionTitle>
      <Card>
        <p className="text-[15px]">{c.groupTitle ? t("co.group", { title: c.groupTitle }) : t("co.group_none")}</p>
      </Card>
      <div className="h-8" />
    </Page>
  );
}
