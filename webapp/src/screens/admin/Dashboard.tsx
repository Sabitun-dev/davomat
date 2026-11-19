import { useT } from "../../i18n/index.tsx";
import { useSession } from "../../session.tsx";
import { EmptyState, Page } from "../../ui/index.ts";

export default function Dashboard() {
  const t = useT();
  const { me } = useSession();
  return (
    <Page title={t("a.tab_today")} subtitle={me.company.name}>
      <EmptyState picture="chart" text={t("dash.all_branches")} />
    </Page>
  );
}
