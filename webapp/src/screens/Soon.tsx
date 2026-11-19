// Placeholder for screens that arrive in a later build phase.
import { useNav } from "../nav.tsx";
import { EmptyState, Page } from "../ui/index.ts";

export default function Soon() {
  const nav = useNav();
  return (
    <Page onBack={nav.pop} title="…">
      <EmptyState picture="wait" text="…" />
    </Page>
  );
}
