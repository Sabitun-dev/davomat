import { Settings } from "lucide-react";
import { useT } from "../../i18n/index.tsx";
import { useNav } from "../../nav.tsx";
import { useSession } from "../../session.tsx";
import { Card, IconButton, Page } from "../../ui/index.ts";

export default function WorkerHome() {
  const t = useT();
  const nav = useNav();
  const { me } = useSession();
  return (
    <Page
      title={t("w.hello", { name: (me.user.fullName ?? me.user.telegramName).split(" ")[0] })}
      right={
        <IconButton label={t("set.title")} onClick={() => nav.push("settings")}>
          <Settings size={22} />
        </IconButton>
      }
    >
      <Card>{me.branches.map((b) => b.name).join(", ")}</Card>
    </Page>
  );
}
