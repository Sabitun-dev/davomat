// Platform owner: all companies, search, and "Yangi kompaniya".

import { useState } from "react";
import { Building2, Plus, Search } from "lucide-react";
import { addMonths } from "@shared/time.ts";
import { api, invalidate, useApi } from "../../api.ts";
import { dayLabel, useLang, useT } from "../../i18n/index.tsx";
import { useNav } from "../../nav.tsx";
import { haptic, shareLink } from "../../telegram/tg.ts";
import { Button, Card, Chip, EmptyState, ErrorState, Field, Input, Page, Sheet, SkeletonScreen, TextArea, errorText, useToast } from "../../ui/index.ts";
import type { PlatformCompany } from "../../types.ts";
import { Copy, Share2 } from "lucide-react";

/** Device-local "today" as YYYY-MM-DD. */
export function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Status chip: Faol / N kun qoldi (≤7) / Muddati tugagan / To'xtatilgan. */
export function CompanyChip({ c }: { c: Pick<PlatformCompany, "state" | "daysLeft"> }) {
  const t = useT();
  if (c.state === "suspended") return <Chip tone="bad">{t("pl.chip_suspended")}</Chip>;
  if (c.state === "expired") return <Chip tone="bad">{t("pl.chip_expired")}</Chip>;
  if (c.daysLeft !== null && c.daysLeft <= 7) return <Chip tone="late">{t("pl.chip_soon", { n: c.daysLeft })}</Chip>;
  return <Chip tone="ok">{t("pl.chip_ok")}</Chip>;
}

/** The "the bot can't write to them yet" box with the link, Copy and Share. */
export function OwnerLinkBox({ link }: { link: string }) {
  const t = useT();
  const toast = useToast();
  return (
    <div className="rounded-2xl bg-late-soft p-4">
      <p className="text-[15px] font-medium text-late">{t("pl.cant_message")}</p>
      <p className="mt-2 rounded-xl bg-card px-3 py-2 text-[15px] break-all">{link}</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button
          variant="secondary"
          size="sm"
          icon={<Copy size={16} />}
          onClick={() => {
            void navigator.clipboard?.writeText(link);
            toast(t("c.copied"));
          }}
        >
          {t("c.copy")}
        </Button>
        <Button variant="secondary" size="sm" icon={<Share2 size={16} />} onClick={() => shareLink(link, t("pl.share_text"))}>
          {t("c.share")}
        </Button>
      </div>
    </div>
  );
}

type Preset = "1m" | "3m" | "6m" | "1y" | "none" | "pick";

/** Paid-until picker: +1 oy, +3 oy, +6 oy, +1 yil, Muddatsiz, Sana tanlash. */
export function PaidUntilPicker({
  value,
  onChange,
  editing,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  /** Editing a saved date: start on "Sana tanlash" (or "Muddatsiz"), not on a quick chip. */
  editing?: boolean;
}) {
  const t = useT();
  const lang = useLang();
  const [preset, setPreset] = useState<Preset>(() => (editing ? (value === null ? "none" : "pick") : "1m"));
  const presets: [Preset, string, number][] = [
    ["1m", t("pl.plus_1m"), 1],
    ["3m", t("pl.plus_3m"), 3],
    ["6m", t("pl.plus_6m"), 6],
    ["1y", t("pl.plus_1y"), 12],
  ];
  const pick = (p: Preset, months?: number) => {
    haptic.select();
    setPreset(p);
    if (months) onChange(addMonths(todayStr(), months));
    if (p === "none") onChange(null);
    if (p === "pick" && value === null) onChange(addMonths(todayStr(), 1));
  };
  const chip = (p: Preset, label: string, months?: number) => (
    <button
      key={p}
      type="button"
      onClick={() => pick(p, months)}
      className={`min-h-[40px] rounded-full px-4 text-[15px] font-semibold ${preset === p ? "bg-accent-strong text-accent-ink" : "bg-card text-ink shadow-soft"}`}
    >
      {label}
    </button>
  );
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {presets.map(([p, label, m]) => chip(p, label, m))}
        {chip("none", t("pl.no_end"))}
        {chip("pick", t("pl.pick_date"))}
      </div>
      {preset === "pick" ? (
        <Input type="date" value={value ?? ""} min={todayStr()} onChange={(e) => onChange(e.target.value || null)} />
      ) : (
        <p className="px-1 text-[15px] text-hint">{value ? t("pl.until", { date: dayLabel(value, lang) }) : t("pl.no_end")}</p>
      )}
    </div>
  );
}

function NewCompanySheet({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: number) => void }) {
  const t = useT();
  const toast = useToast();
  const [name, setName] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [paidUntil, setPaidUntil] = useState<string | null>(() => addMonths(todayStr(), 1));
  const [maxWorkers, setMaxWorkers] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<{ id: number; link: string } | null>(null);

  const reset = () => {
    setName("");
    setOwnerId("");
    setPaidUntil(addMonths(todayStr(), 1));
    setMaxWorkers("");
    setNote("");
    setError(null);
    setLink(null);
  };
  const close = () => {
    reset();
    onClose();
  };
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ company: PlatformCompany; notified: boolean; link: string }>("/platform/companies", {
        body: { name, ownerTelegramId: ownerId, paidUntil, maxWorkers: maxWorkers ? Number(maxWorkers) : null, note },
      });
      invalidate("/platform");
      haptic.success();
      if (r.notified) {
        toast(t("pl.created"));
        reset();
        onCreated(r.company.id);
      } else setLink({ id: r.company.id, link: r.link });
    } catch (e) {
      haptic.error();
      setError(errorText(t, e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={close} title={t("pl.new")}>
      {link ? (
        <div className="flex flex-col gap-4">
          <OwnerLinkBox link={link.link} />
          <Button
            onClick={() => {
              const id = link.id;
              reset();
              onCreated(id);
            }}
          >
            {t("c.done")}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <Field label={t("pl.name")}>
            <Input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label={t("pl.owner_id")} hint={t("pl.owner_id_hint")}>
            <Input inputMode="numeric" value={ownerId} maxLength={15} placeholder="123456789" onChange={(e) => setOwnerId(e.target.value.replace(/\D/g, ""))} className="tabular" />
          </Field>
          <Field label={t("pl.paid_until")}>
            <PaidUntilPicker value={paidUntil} onChange={setPaidUntil} />
          </Field>
          <Field label={t("pl.max_workers")} hint={t("pl.max_workers_hint")}>
            <Input inputMode="numeric" value={maxWorkers} maxLength={6} onChange={(e) => setMaxWorkers(e.target.value.replace(/\D/g, ""))} className="tabular" />
          </Field>
          <Field label={t("pl.note")}>
            <TextArea value={note} maxLength={1000} placeholder={t("pl.note_ph")} onChange={(e) => setNote(e.target.value)} />
          </Field>
          {error && <p className="px-1 text-[15px] text-bad">{error}</p>}
          <Button loading={busy} disabled={!name.trim() || ownerId.length < 5} onClick={save}>
            {t("pl.create")}
          </Button>
        </div>
      )}
    </Sheet>
  );
}

export default function PlatformScreen({ onClose }: { onClose?: () => void }) {
  const t = useT();
  const lang = useLang();
  const nav = useNav();
  const list = useApi<PlatformCompany[]>("/platform/companies");
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);

  const q = query.trim().toLowerCase();
  const shown = (list.data ?? []).filter(
    (c) => !q || c.name.toLowerCase().includes(q) || c.owners.some((o) => (o.name ?? "").toLowerCase().includes(q) || o.telegramId.includes(q)),
  );

  return (
    <Page
      title={t("pl.title")}
      subtitle={t("pl.subtitle")}
      onBack={onClose ?? (nav.stack.length > 1 ? nav.pop : undefined)}
      right={
        <Button full={false} size="sm" icon={<Plus size={18} />} aria-label={t("pl.new")} onClick={() => setAdding(true)}>
          {t("pl.new_short")}
        </Button>
      }
    >
      {list.error && <ErrorState error={list.error} onRetry={list.reload} />}
      {!list.data && !list.error && <SkeletonScreen />}
      {list.data && list.data.length > 0 && (
        <div className="relative mb-3">
          <Search size={18} className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-hint" />
          <Input value={query} placeholder={t("pl.search")} onChange={(e) => setQuery(e.target.value)} className="pl-11" />
        </div>
      )}
      {list.data?.length === 0 && <EmptyState picture="branch" text={t("pl.none")} />}
      <div className="flex flex-col gap-3">
        {shown.map((c) => {
          const owner = c.owners[0];
          return (
            <Card key={c.id} onClick={() => nav.push("platformCompany", { id: c.id })}>
              <div className="flex items-start gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-accent-soft text-accent">
                  <Building2 size={22} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[17px] font-semibold">{c.name}</p>
                  <div className="mt-1 flex min-w-0 items-center gap-2">
                    <CompanyChip c={c} />
                    <span className={`truncate text-[14px] ${owner?.opened ? "text-hint" : "text-late"}`}>
                      {owner ? (owner.opened && owner.name ? owner.name : `${owner.telegramId} · ${t("pl.owner_not_opened")}`) : "—"}
                    </span>
                  </div>
                  <p className="tabular mt-1 text-[14px] text-hint">
                    {c.paidUntil ? t("pl.until", { date: dayLabel(c.paidUntil, lang) }) : t("pl.no_end")} ·{" "}
                    {c.maxWorkers ? t("pl.workers", { used: c.workers, max: c.maxWorkers }) : t("pl.workers_unlimited", { used: c.workers })}
                  </p>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
      <div className="h-8" />
      <NewCompanySheet
        open={adding}
        onClose={() => setAdding(false)}
        onCreated={(id) => {
          setAdding(false);
          list.reload();
          nav.push("platformCompany", { id });
        }}
      />
    </Page>
  );
}
