import { useState } from "react";
import { Globe, Phone, User, Shield } from "lucide-react";
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
