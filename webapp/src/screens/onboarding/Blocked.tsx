// Full screen when the current company is paused by the platform owner or its paid-until date passed.
// Data is never deleted; the person can still switch to another company they belong to.

import { useState } from "react";
import { Building2, Shield } from "lucide-react";
import { api, invalidate } from "../../api.ts";
import { dayLabel, useLang, useT } from "../../i18n/index.tsx";
import { useSession } from "../../session.tsx";
import { haptic } from "../../telegram/tg.ts";
import { Button, ListCard, ListRow, Picture, SectionTitle, errorText, useToast } from "../../ui/index.ts";
import type { Me } from "../../types.ts";

/** Switches the current company on the server and reloads the app's data. */
export function useSwitchCompany() {
  const t = useT();
  const toast = useToast();
  const { setMe } = useSession();
  const [busy, setBusy] = useState<number | null>(null);
  const run = async (companyId: number) => {
    setBusy(companyId);
    try {
      const me = await api<Me>("/me/company", { body: { companyId } });
      invalidate("");
      haptic.success();
      toast(t("set.switched"));
      setMe(me);
    } catch (e) {
      toast(errorText(t, e), "error");
    } finally {
      setBusy(null);
    }
  };
  return { switchTo: run, busy };
}

export function BlockedScreen({ onPlatform }: { onPlatform?: () => void }) {
  const t = useT();
  const lang = useLang();
  const { me } = useSession();
  const { switchTo, busy } = useSwitchCompany();
  const company = me.company!;
  const others = me.companies.filter((c) => c.id !== company.id);
  return (
    <div className="mx-auto flex max-w-[480px] flex-col gap-4 px-6 pt-14 pb-10 safe-top animate-fade-up">
      <Picture name="wait" size={140} />
      <div className="text-center">
        <h1 className="text-[26px] leading-tight font-bold">{t("blk.title")}</h1>
        <p className="mt-2 text-[17px] text-hint">{t("blk.text")}</p>
        <p className="mt-1 text-[15px] text-hint">{company.name}</p>
        {me.role === "OWNER" && (
          <p className="mt-4 rounded-2xl bg-bad-soft px-4 py-3 text-[15px] font-medium text-bad">
            {company.state === "expired" && company.paidUntil
              ? t("blk.reason_expired", { date: dayLabel(company.paidUntil, lang) })
              : t("blk.reason_suspended")}
          </p>
        )}
      </div>
      {others.length > 0 && (
        <>
          <SectionTitle>{t("blk.other_company")}</SectionTitle>
          <ListCard>
            {others.map((c) => (
              <ListRow
                key={c.id}
                icon={<Building2 size={20} />}
                title={c.name}
                subtitle={t(`role.${c.role}`)}
                right={busy === c.id ? "…" : undefined}
                onClick={() => switchTo(c.id)}
              />
            ))}
          </ListCard>
        </>
      )}
      {me.platform && onPlatform && (
        <Button variant="secondary" icon={<Shield size={20} />} onClick={onPlatform}>
          {t("pl.title")}
        </Button>
      )}
    </div>
  );
}
