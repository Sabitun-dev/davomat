import { useState } from "react";
import { api, useApi } from "../../api.ts";
import { useT } from "../../i18n/index.tsx";
import { useSession } from "../../session.tsx";
import { BottomActions, BottomSpacer } from "../../telegram/buttons.tsx";
import { haptic } from "../../telegram/tg.ts";
import { Button, ErrorState, Picture, SkeletonScreen, errorText, useToast } from "../../ui/index.ts";

interface Preview {
  valid: boolean;
  branchName: string;
  role: "WORKER" | "ADMIN";
  alreadyMember: boolean;
}

export function InviteScreen({ token, onDone }: { token: string; onDone: () => void }) {
  const t = useT();
  const toast = useToast();
  const { refresh } = useSession();
  const preview = useApi<Preview>(`/invites/preview?token=${encodeURIComponent(token)}`);
  const [busy, setBusy] = useState(false);

  if (preview.error) return <ErrorState error={preview.error} onRetry={preview.reload} />;
  if (!preview.data) return <SkeletonScreen />;
  const p = preview.data;

  if (!p.valid || p.alreadyMember) {
    return (
      <div className="mx-auto flex min-h-[80vh] max-w-[480px] flex-col items-center justify-center gap-5 px-6 text-center animate-fade-up">
        <Picture name={p.alreadyMember ? "team" : "error"} />
        <p className="text-[17px]">{p.alreadyMember ? t("ob.invite_joined", { branch: p.branchName }) : t("err.invite_invalid")}</p>
        <Button full={false} className="min-w-[200px]" onClick={onDone}>
          {t("c.home")}
        </Button>
      </div>
    );
  }

  const join = async () => {
    setBusy(true);
    try {
      await api("/invites/accept", { body: { token } });
      haptic.success();
      toast(t("ob.invite_joined", { branch: p.branchName }));
      await refresh();
      onDone();
    } catch (e) {
      toast(errorText(t, e), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="mx-auto flex min-h-[80vh] max-w-[480px] flex-col items-center justify-center gap-5 px-6 text-center animate-fade-up">
        <Picture name="branch" size={148} />
        <h1 className="text-[28px] font-bold">{t("ob.invite_title")}</h1>
        <p className="text-[17px] text-hint">
          {t(p.role === "ADMIN" ? "ob.invite_admin_text" : "ob.invite_text", { branch: p.branchName })}
        </p>
      </div>
      <BottomActions text={t("ob.invite_join")} loading={busy} onClick={join} />
      <BottomSpacer />
    </>
  );
}
