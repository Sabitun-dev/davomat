import { useT } from "../../i18n/index.tsx";
import { EmptyState, Page } from "../../ui/index.ts";

export default function Reports() {
  const t = useT();
  return (
    <Page title={t("r.title")}>
      <EmptyState picture="chart" text={t("r.no_data")} />
    </Page>
  );
}
