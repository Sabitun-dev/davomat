// One branch: workers, QR, invites, schedule and settings, as tabs.

import { useState } from "react";
import { CalendarDays, Coins, Copy, Download, FileText, Image, Link, MapPin, Pencil, RefreshCw, Share2, Tablet, Trash2, UserPlus } from "lucide-react";
import { formatMoney } from "@shared/money.ts";
import { api, invalidate, useApi } from "../../api.ts";
import { dayLabel, useLang, useT } from "../../i18n/index.tsx";
import { useNav } from "../../nav.tsx";
import { useSession } from "../../session.tsx";
import { BottomSpacer } from "../../telegram/buttons.tsx";
import { canDownloadFile, confirm, downloadFile, haptic, shareLink } from "../../telegram/tg.ts";
import {
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorState,
  Field,
  Input,
  ListCard,
  ListRow,
  Page,
  SectionTitle,
  Segmented,
  Sheet,
  SkeletonScreen,
  Stepper,
  Toggle,
  errorText,
  useToast,
} from "../../ui/index.ts";
import type { BranchDetail as Detail, Device, Invite, Member } from "../../types.ts";
import { MemberSheet } from "./MemberSheet.tsx";

type Tab = "workers" | "qr" | "invites" | "settings";

export default function BranchDetail({ id, tab: initialTab }: { id: number; tab?: Tab }) {
  const t = useT();
  const nav = useNav();
  const branch = useApi<Detail>(`/admin/branches/${id}`);
  const [tab, setTab] = useState<Tab>(initialTab ?? "workers");

  if (branch.error) return <ErrorState error={branch.error} onRetry={branch.reload} />;
  if (!branch.data) return <SkeletonScreen />;
  const b = branch.data;

  return (
    <Page
      title={b.name}
      subtitle={b.address || undefined}
      onBack={nav.pop}
      right={
        <button
          type="button"
          aria-label={t("b.edit")}
          onClick={() => nav.push("branchEditor", { branch: b })}
          className="flex h-12 w-12 items-center justify-center rounded-full text-accent active:bg-sep"
        >
          <Pencil size={22} />
        </button>
      }
    >
      <div className="scroll-x -mx-4 px-4">
        <div className="min-w-[400px]">
          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              { value: "workers", label: t("b.tab_workers") },
              { value: "qr", label: t("b.tab_qr") },
              { value: "invites", label: t("b.tab_invites") },
              { value: "settings", label: t("b.tab_settings") },
            ]}
          />
        </div>
      </div>
      <div className="mt-4">
        {tab === "workers" && <WorkersTab branch={b} />}
        {tab === "qr" && <QrTab branch={b} reload={branch.reload} />}
        {tab === "invites" && <InvitesTab branch={b} />}
        {tab === "settings" && <SettingsTab branch={b} reload={branch.reload} />}
      </div>
      <BottomSpacer />
    </Page>
  );
}

function WorkersTab({ branch }: { branch: Detail }) {
  const t = useT();
  const nav = useNav();
  const { me } = useSession();
  const members = useApi<Member[]>(`/admin/branches/${branch.id}/members`);
  const [open, setOpen] = useState<Member | null>(null);
  if (members.error) return <ErrorState error={members.error} onRetry={members.reload} />;
  if (!members.data) return <SkeletonScreen />;
  const active = members.data.filter((m) => m.active);
  const inactive = members.data.filter((m) => !m.active);
  const row = (m: Member) => (
    <ListRow
      key={m.memberId}
      icon={<span className="text-[16px] font-bold">{m.name.slice(0, 1)}</span>}
      title={m.name}
      subtitle={[m.position, m.defaultDailyAmount !== null ? formatMoney(m.defaultDailyAmount, me.company.currency) : null].filter(Boolean).join(" · ") || m.phone}
      onClick={() => setOpen(m)}
    />
  );
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <Button variant="secondary" icon={<CalendarDays size={20} />} onClick={() => nav.push("schedule", { branchId: branch.id })}>
          {t("b.tab_schedule")}
        </Button>
        <Button variant="secondary" icon={<Coins size={20} />} onClick={() => nav.push("amounts", { branchId: branch.id })}>
          {t("amt.title")}
        </Button>
      </div>
      <SectionTitle>{t("mem.title")} · {active.length}</SectionTitle>
      {active.length === 0 ? (
        <EmptyState picture="team" text={t("mem.none")} />
      ) : (
        <ListCard>{active.map(row)}</ListCard>
      )}
      {inactive.length > 0 && (
        <>
          <SectionTitle>{t("mem.inactive_list")}</SectionTitle>
          <ListCard>{inactive.map(row)}</ListCard>
        </>
      )}
      {open && (
        <MemberSheet
          member={open}
          branchId={branch.id}
          onClose={() => setOpen(null)}
          onChanged={() => {
            setOpen(null);
            members.reload();
          }}
        />
      )}
    </>
  );
}

function QrTab({ branch, reload }: { branch: Detail; reload: () => void }) {
  const t = useT();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  const send = async (kind: "png" | "poster") => {
    setBusy(kind);
    try {
      await api(`/admin/branches/${branch.id}/qr/send`, { body: { kind } });
      toast(t("c.sent_to_chat"));
    } catch (e) {
      toast(errorText(t, e), "error");
    } finally {
      setBusy(null);
    }
  };

  const regenerate = async () => {
    if (!(await confirm(t("qr.regenerate_confirm")))) return;
    setBusy("regen");
    try {
      await api(`/admin/branches/${branch.id}/qr/regenerate`, { body: {} });
      haptic.success();
      toast(t("qr.regenerated"));
      reload();
    } catch (e) {
      toast(errorText(t, e), "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <Card className="flex flex-col items-center gap-3">
        <div className="w-full max-w-[260px] rounded-2xl bg-white p-3" dangerouslySetInnerHTML={{ __html: branch.qr.svg }} />
        <Chip tone={branch.qrMode === "ROTATING" ? "brk" : "accent"}>
          {branch.qrMode === "ROTATING" ? t("qr.mode_rotating") : t("qr.version", { n: branch.qr.version })}
        </Chip>
      </Card>
      {branch.qrMode === "ROTATING" && <p className="mt-3 px-1 text-[14px] text-late">{t("qr.rotating_hint")}</p>}
      <div className="mt-4 flex flex-col gap-3">
        <Button icon={<FileText size={20} />} loading={busy === "poster"} onClick={() => send("poster")}>
          {t("qr.send_poster")}
        </Button>
        <Button variant="secondary" icon={<Image size={20} />} loading={busy === "png"} onClick={() => send("png")}>
          {t("qr.send_png")}
        </Button>
        {canDownloadFile() && (
          <Button variant="ghost" icon={<Download size={20} />} onClick={() => downloadFile(branch.qr.posterUrl, `${branch.qr.fileBase}-poster.pdf`)}>
            {t("qr.download")}
          </Button>
        )}
        <Button variant="danger" icon={<RefreshCw size={20} />} loading={busy === "regen"} onClick={regenerate}>
          {t("qr.regenerate")}
        </Button>
      </div>
      {branch.qrMode === "ROTATING" && <DevicesCard branchId={branch.id} />}
    </>
  );
}

function DevicesCard({ branchId }: { branchId: number }) {
  const t = useT();
  const toast = useToast();
  const devices = useApi<Device[]>(`/admin/branches/${branchId}/devices`);
  const [created, setCreated] = useState<{ url: string; name: string } | null>(null);
  const [name, setName] = useState("");
  const [adding, setAdding] = useState(false);

  const add = async () => {
    try {
      const d = await api<{ url: string; name: string }>(`/admin/branches/${branchId}/devices`, { body: { name } });
      setCreated(d);
      setAdding(false);
      setName("");
      devices.reload();
    } catch (e) {
      toast(errorText(t, e), "error");
    }
  };
  const revoke = async (id: number) => {
    if (!(await confirm(t("qr.revoke_confirm")))) return;
    await api(`/admin/devices/${id}`, { method: "DELETE" }).catch((e) => toast(errorText(t, e), "error"));
    devices.reload();
  };

  return (
    <>
      <SectionTitle
        action={
          <Button variant="ghost" size="sm" full={false} onClick={() => setAdding(true)}>
            {t("qr.new_device")}
          </Button>
        }
      >
        {t("qr.devices")}
      </SectionTitle>
      {devices.data && devices.data.length === 0 && <p className="px-1 text-hint">{t("qr.no_devices")}</p>}
      {devices.data && devices.data.length > 0 && (
        <ListCard>
          {devices.data.map((d) => (
            <ListRow
              key={d.id}
              icon={<Tablet size={20} />}
              title={d.name}
              subtitle={d.lastSeenAt ? t("qr.last_seen", { time: new Date(d.lastSeenAt).toLocaleString() }) : undefined}
              right={
                <button type="button" aria-label={t("qr.revoke")} onClick={() => revoke(d.id)} className="flex h-11 w-11 items-center justify-center text-bad">
                  <Trash2 size={20} />
                </button>
              }
            />
          ))}
        </ListCard>
      )}
      <Sheet open={adding} onClose={() => setAdding(false)} title={t("qr.new_device")}>
        <Field label={t("qr.device_name")}>
          <Input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        </Field>
        <div className="mt-4">
          <Button onClick={add}>{t("c.add")}</Button>
        </div>
      </Sheet>
      <Sheet open={Boolean(created)} onClose={() => setCreated(null)} title={created?.name}>
        <p className="text-[15px] text-hint">{t("qr.device_link")}</p>
        <p className="mt-3 rounded-2xl bg-card p-3 text-[14px] break-all shadow-soft">{created?.url}</p>
        <div className="mt-4">
          <Button
            icon={<Copy size={20} />}
            onClick={() => {
              void navigator.clipboard?.writeText(created!.url);
              toast(t("c.copied"));
            }}
          >
            {t("c.copy")}
          </Button>
        </div>
      </Sheet>
    </>
  );
}

function InvitesTab({ branch }: { branch: Detail }) {
  const t = useT();
  const lang = useLang();
  const toast = useToast();
  const { me } = useSession();
  const invites = useApi<Invite[]>(`/admin/branches/${branch.id}/invites`);
  const [single, setSingle] = useState(true);
  const [days, setDays] = useState(7);
  const [role, setRole] = useState<"WORKER" | "ADMIN">("WORKER");
  const [busy, setBusy] = useState(false);

  const share = (inv: Invite) => shareLink(inv.link, t("inv.share_text", { branch: branch.name }));

  const create = async () => {
    setBusy(true);
    try {
      const inv = await api<Invite>(`/admin/branches/${branch.id}/invites`, { body: { singleUse: single, days, role } });
      invites.reload();
      haptic.success();
      share(inv);
    } catch (e) {
      toast(errorText(t, e), "error");
    } finally {
      setBusy(false);
    }
  };
  const revoke = async (id: number) => {
    if (!(await confirm(t("inv.revoke_confirm")))) return;
    await api(`/admin/invites/${id}`, { method: "DELETE" }).catch((e) => toast(errorText(t, e), "error"));
    invites.reload();
  };

  return (
    <>
      <Card className="flex flex-col gap-4">
        <h3 className="text-[18px] font-bold">{t("inv.new")}</h3>
        <Segmented
          value={single ? "single" : "multi"}
          onChange={(v) => setSingle(v === "single")}
          options={[
            { value: "single", label: t("inv.single") },
            { value: "multi", label: t("inv.multi") },
          ]}
        />
        {me.role === "OWNER" && (
          <Segmented
            value={role}
            onChange={setRole}
            options={[
              { value: "WORKER", label: t("inv.role_worker") },
              { value: "ADMIN", label: t("inv.role_admin") },
            ]}
          />
        )}
        <Field label={t("inv.expiry")}>
          <Stepper value={days} min={1} max={90} onChange={setDays} suffix={t("inv.days", { n: "" }).trim()} />
        </Field>
        <Button icon={<Share2 size={20} />} loading={busy} onClick={create}>
          {t("inv.create")}
        </Button>
      </Card>
      <SectionTitle>{t("inv.title")}</SectionTitle>
      {invites.data && invites.data.length === 0 && <p className="px-1 text-hint">{t("inv.none")}</p>}
      {invites.data && invites.data.length > 0 && (
        <ListCard>
          {invites.data.map((inv) => (
            <ListRow
              key={inv.id}
              icon={inv.role === "ADMIN" ? <UserPlus size={20} /> : <Link size={20} />}
              title={inv.maxUses ? t("inv.uses", { uses: inv.uses, max: inv.maxUses }) : t("inv.uses_multi", { uses: inv.uses })}
              subtitle={`${inv.role === "ADMIN" ? t("inv.role_admin") + " · " : ""}${t("inv.until", { date: dayLabel(inv.expiresAt.slice(0, 10), lang) })}`}
              right={
                <span className="flex">
                  <button type="button" aria-label={t("c.share")} onClick={() => share(inv)} className="flex h-11 w-11 items-center justify-center text-accent">
                    <Share2 size={20} />
                  </button>
                  <button type="button" aria-label={t("inv.revoke")} onClick={() => revoke(inv.id)} className="flex h-11 w-11 items-center justify-center text-bad">
                    <Trash2 size={20} />
                  </button>
                </span>
              }
            />
          ))}
        </ListCard>
      )}
    </>
  );
}

function SettingsTab({ branch, reload }: { branch: Detail; reload: () => void }) {
  const t = useT();
  const nav = useNav();
  const toast = useToast();
  const [breakMin, setBreakMin] = useState(branch.breakAllowanceMin);
  const [grace, setGrace] = useState(branch.graceMin);
  const [mode, setMode] = useState(branch.graceMode);
  const [qrMode, setQrMode] = useState(branch.qrMode);
  const [active, setActive] = useState(branch.active);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await api(`/admin/branches/${branch.id}`, {
        method: "PATCH",
        body: { breakAllowanceMin: breakMin, graceMin: grace, graceMode: mode, qrMode, active },
      });
      invalidate("/admin/branches");
      toast(t("c.saved"));
      reload();
    } catch (e) {
      toast(errorText(t, e), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-4">
        <Field label={t("b.break_allowance")}>
          <Stepper value={breakMin} step={5} min={0} max={480} onChange={setBreakMin} suffix={t("c.min", { n: "" }).trim()} />
        </Field>
        <Field label={t("b.grace")}>
          <Stepper value={grace} min={0} max={180} onChange={setGrace} suffix={t("c.min", { n: "" }).trim()} />
        </Field>
        <Field label={t("b.grace_mode")}>
          <Segmented
            value={mode}
            onChange={setMode}
            options={[
              { value: "FULL", label: t("b.grace_full") },
              { value: "AFTER_GRACE", label: t("b.grace_after") },
            ]}
          />
        </Field>
      </Card>
      <Card className="flex flex-col gap-3">
        <span className="text-[14px] font-medium text-hint">{t("qr.mode")}</span>
        <Segmented
          value={qrMode}
          onChange={setQrMode}
          options={[
            { value: "STATIC", label: t("qr.mode_static") },
            { value: "ROTATING", label: t("qr.mode_rotating") },
          ]}
        />
      </Card>
      <ListCard>
        <Toggle checked={active} onChange={setActive} label={t("b.active")} />
        <ListRow
          icon={<MapPin size={20} />}
          title={t("b.location")}
          subtitle={`${t("b.radius")} ${branch.radiusM} m · ${t("b.diameter")} ${branch.radiusM * 2} m`}
          onClick={() => nav.push("branchEditor", { branch })}
        />
      </ListCard>
      <Button loading={busy} onClick={save}>
        {t("c.save")}
      </Button>
    </div>
  );
}
