import { useState } from "react";
import { Building2, Check, Globe, Phone, User, Shield } from "lucide-react";
import { useSwitchCompany } from "./onboarding/Blocked.tsx";
import { api } from "../api.ts";
import { useT, type Lang } from "../i18n/index.tsx";
import { useNav } from "../nav.tsx";
import { useSession } from "../session.tsx";
import { ListCard, ListRow, Page, SectionTitle, Segmented, errorText, useToast } from "../ui/index.ts";
import type { Me } from "../types.ts";

export default function SettingsScreen() {
  const t = useT();
  const nav = useNav();
  const toast = useToast();
  const { me, setMe } = useSession();
  const [lang, setLang] = useState(me.user.language as Lang);
  const { switchTo, busy } = useSwitchCompany();

  const changeLang = async (value: Lang) => {
    setLang(value);
    try {
      setMe(await api<Me>("/me", { body: { language: value } }));
    } catch (e) {
      toast(errorText(t, e), "error");
    }
  };

  return (
    <Page title={t("set.title")} onBack={nav.pop}>
      <SectionTitle>
        <span className="inline-flex items-center gap-1.5">
          <Globe size={14} /> {t("set.language")}
        </span>
      </SectionTitle>
      <Segmented
        value={lang}
        onChange={changeLang}
        options={(["uz", "ru", "en"] as Lang[]).map((l) => ({ value: l, label: t(`lang.${l}`) }))}
      />
      {me.companies.length > 1 && (
        <>
          <SectionTitle>{t("set.companies")}</SectionTitle>
          <ListCard>
            {me.companies.map((c) => (
              <ListRow
                key={c.id}
                icon={<Building2 size={20} />}
                title={c.name}
                subtitle={t(`role.${c.role}`)}
                right={c.id === me.company?.id ? <Check size={20} className="text-accent" /> : busy === c.id ? "…" : undefined}
                onClick={c.id === me.company?.id ? undefined : () => switchTo(c.id)}
              />
            ))}
          </ListCard>
        </>
      )}
      {me.platform && (
        <>
          <SectionTitle>{t("pl.title")}</SectionTitle>
          <ListCard>
            <ListRow icon={<Globe size={20} />} title={t("pl.title")} subtitle={t("pl.subtitle")} onClick={() => nav.push("platform")} />
          </ListCard>
        </>
      )}
      <SectionTitle>{t("set.title")}</SectionTitle>
      <ListCard>
        <ListRow icon={<User size={20} />} title={me.user.fullName ?? me.user.telegramName} subtitle={t("set.name")} />
        <ListRow icon={<Phone size={20} />} title={me.user.phone ?? "—"} subtitle={t("set.phone")} />
        <ListRow icon={<Shield size={20} />} title={t(`role.${me.role}`)} subtitle={t("set.role")} />
      </ListCard>
      <p className="mt-6 px-1 text-center text-[13px] text-hint">{t("ob.consent_text")}</p>
    </Page>
  );
}
