import { Settings } from "lucide-react";
import { useT } from "../../i18n/index.tsx";
import { useNav } from "../../nav.tsx";
import { useSession } from "../../session.tsx";
import { EmptyState, IconButton, Page } from "../../ui/index.ts";

export default function AdminHome() {
  const t = useT();
  const nav = useNav();
  const { me } = useSession();
  return (
    <Page
      title={me.company.name}
      subtitle={t(`role.${me.role}`)}
      right={
        <IconButton label={t("set.title")} onClick={() => nav.push("settings")}>
          <Settings size={22} />
        </IconButton>
      }
    >
      <EmptyState picture="branch" text={t("dash.no_branches")} />
    </Page>
  );
}
