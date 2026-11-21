// Owner: company name, currency and every setting from spec section 2.

import { useEffect, useState } from "react";
import { api, useApi } from "../../api.ts";
import { useT, type Key } from "../../i18n/index.tsx";
import { useNav } from "../../nav.tsx";
import { useSession } from "../../session.tsx";
import { BottomActions, BottomSpacer } from "../../telegram/buttons.tsx";
import { Card, ErrorState, Field, Input, ListCard, Page, SectionTitle, Segmented, SkeletonScreen, Stepper, Toggle, errorText, useToast } from "../../ui/index.ts";
import type { Me } from "../../types.ts";

type Settings = Record<string, number | boolean>;
interface CompanyData {
  name: string;
  currency: "UZS" | "USD";
  /** True once any amount is stored: the currency can no longer change. */
  currencyLocked: boolean;
  groupTitle: string | null;
  hasGroup: boolean;
  settings: Settings;
}

const NUMBERS: [string, Key, number, number, number][] = [
  // key, label, step, min, max
  ["gpsAccuracyLimitM", "co.gps_limit", 5, 5, 500],
  ["geofenceToleranceM", "co.tolerance", 5, 0, 200],
  ["earliestCheckInMin", "co.earliest", 15, 0, 720],
  ["autoCloseAfterMin", "co.autoclose", 15, 15, 720],
  ["rateLimitPer5Min", "co.rate_limit", 1, 3, 100],
];
const VIDEO: [string, Key, number, number, number][] = [
  ["videoBeforeMin", "co.video_before", 1, 0, 120],
  ["videoAfterMin", "co.video_after", 1, 0, 120],
];
const BOT: [string, Key, number, number, number][] = [
  ["remindCheckInAfterMin", "co.remind_in", 5, 0, 240],
  ["remindCheckOutAfterMin", "co.remind_out", 5, 0, 240],
];
const FINISH: [string, Key, number, number, number][] = [
  ["collectiveFinishPercent", "co.finish_percent", 5, 1, 100],
  ["collectiveFinishWindowMin", "co.finish_window", 15, 15, 480],
];
const OTHER: [string, Key, number, number, number][] = [
  ["inviteExpiryDays", "co.invite_days", 1, 1, 90],
  ["gpsRetentionMonths", "co.gps_months", 1, 1, 60],
];

export default function CompanyScreen() {
  const t = useT();
  const nav = useNav();
  const toast = useToast();
  const { me, setMe } = useSession();
  const company = useApi<CompanyData>("/admin/company");
  const [form, setForm] = useState<CompanyData | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (company.data) setForm(company.data);
  }, [company.data]);

  if (company.error) return <ErrorState error={company.error} onRetry={company.reload} />;
  if (!form) return <SkeletonScreen />;
  const set = (key: string, value: number | boolean) => setForm({ ...form, settings: { ...form.settings, [key]: value } });

  const numbers = (list: typeof NUMBERS) => (
    <div className="flex flex-col gap-4 rounded-[20px] bg-card p-4 shadow-soft">
      {list.map(([key, label, step, min, max]) => (
        <Field key={key} label={t(label)}>
          <Stepper value={Number(form.settings[key])} step={step} min={min} max={max} onChange={(v) => set(key, v)} />
        </Field>
      ))}
    </div>
  );
  const toggle = (key: string, label: Key) => <Toggle key={key} label={t(label)} checked={Boolean(form.settings[key])} onChange={(v) => set(key, v)} />;

  const save = async () => {
    setBusy(true);
    try {
      await api("/admin/company", { method: "PATCH", body: form });
      setMe(await api<Me>("/me"));
      toast(t("c.saved"));
    } catch (e) {
      toast(errorText(t, e), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page title={t("more.company")} subtitle={me.company!.name} onBack={nav.pop}>
      <div className="flex flex-col gap-4">
        <Field label={t("co.name")}>
          <Input value={form.name} maxLength={80} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label={t("co.currency")} hint={form.currencyLocked ? t("err.currency_locked") : undefined}>
          <div className={form.currencyLocked ? "pointer-events-none opacity-50" : ""} aria-disabled={form.currencyLocked}>
          <Segmented
            value={form.currency}
            onChange={(v) => setForm({ ...form, currency: v })}
            options={[
              { value: "UZS", label: "so'm" },
              { value: "USD", label: "USD $" },
            ]}
          />
          </div>
        </Field>
      </div>
      <SectionTitle>{t("d.overtime")}</SectionTitle>
      <ListCard>
        <Toggle label={t("co.overtime")} hint={t("co.overtime_hint")} checked={Boolean(form.settings.overtimeEnabled)} onChange={(v) => set("overtimeEnabled", v)} />
        {Boolean(form.settings.overtimeEnabled) && toggle("overtimeIncludeEarly", "co.overtime_early")}
      </ListCard>
      <SectionTitle>{t("co.section_group")}</SectionTitle>
      <Card>
        {form.hasGroup ? (
          <p className="text-[16px] font-medium">{t("co.group", { title: form.groupTitle ?? "" })}</p>
        ) : (
          <>
            <p className="text-[16px] font-medium text-late">{t("co.group_none")}</p>
            <p className="mt-2 text-[15px] text-hint">{t("co.group_step1")}</p>
            <p className="text-[15px] text-hint">{t("co.group_step2")}</p>
          </>
        )}
      </Card>
      <SectionTitle>{t("co.section_finish")}</SectionTitle>
      <ListCard>
        <Toggle label={t("co.finish")} hint={t("co.finish_hint")} checked={Boolean(form.settings.collectiveFinishEnabled)} onChange={(v) => set("collectiveFinishEnabled", v)} />
      </ListCard>
      {Boolean(form.settings.collectiveFinishEnabled) && <div className="mt-3">{numbers(FINISH)}</div>}
      <SectionTitle>{t("co.section_checkin")}</SectionTitle>
      {numbers(NUMBERS)}
      <SectionTitle>{t("co.section_video")}</SectionTitle>
      {numbers(VIDEO)}
      <div className="mt-3">
        <ListCard>
          {toggle("botReplyUnderVideo", "co.video_reply")}
          {toggle("flagMissingVideo", "co.flag_video")}
        </ListCard>
      </div>
      <SectionTitle>{t("co.section_bot")}</SectionTitle>
      {numbers(BOT)}
      <div className="mt-3">
        <ListCard>
          {toggle("morningSummary", "co.morning")}
          {toggle("dailyFlagSummary", "co.flag_summary")}
          {toggle("monthlyPayrollMessage", "co.payroll_msg")}
        </ListCard>
      </div>
      <SectionTitle>{t("co.section_other")}</SectionTitle>
      {numbers(OTHER)}
      <BottomSpacer />
      <BottomActions text={t("c.save")} loading={busy} onClick={save} />
    </Page>
  );
}
