import { Suspense, useCallback, useEffect, useState } from "react";
import { api, ApiError } from "./api.ts";
import { I18nProvider, toLang, useT } from "./i18n/index.tsx";
import { NavBackButton, NavProvider, useNav } from "./nav.tsx";
import { SessionContext } from "./session.tsx";
import { inTelegram, telegramLanguage } from "./telegram/tg.ts";
import { ErrorState, Picture, SkeletonScreen, ToastProvider } from "./ui/index.ts";
import { ConsentScreen, IntroScreen, NameScreen, NoBranchScreen, PhoneScreen } from "./screens/onboarding/Onboarding.tsx";
import { InviteScreen } from "./screens/onboarding/Invite.tsx";
import { screens } from "./screens/registry.tsx";
import type { Me } from "./types.ts";

const MOCK = import.meta.env.VITE_MOCK === "1";

function OpenInTelegram() {
  const t = useT();
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-5 px-8 text-center">
      <Picture name="phone" />
      <p className="text-[17px]">{t("c.open_in_telegram")}</p>
    </div>
  );
}

function Stack() {
  const { stack, push } = useNav();
  // Screenshot review build only: open ?screen=<name>&p=<json params> straight away.
  useEffect(() => {
    if (!MOCK) return;
    const q = new URLSearchParams(location.search);
    const screen = q.get("screen");
    if (screen) push(screen, JSON.parse(q.get("p") ?? "{}"));
  }, []);
  const top = stack[stack.length - 1];
  const Screen = screens[top.name];
  return (
    <>
      <NavBackButton />
      <Suspense fallback={<SkeletonScreen />}>
        <Screen key={stack.length} {...(top.params ?? {})} />
      </Suspense>
    </>
  );
}

/** Decides what to show: first-open steps, invite, intro, then the home screen for the role. */
function Gate({ me }: { me: Me }) {
  const [inviteDone, setInviteDone] = useState(false);
  if (me.needs.consent) return <ConsentScreen />;
  if (me.needs.phone) return <PhoneScreen />;
  if (me.needs.name) return <NameScreen />;
  const invite = me.startParam?.startsWith("inv_") ? me.startParam.slice(4) : null;
  if (invite && !inviteDone) return <InviteScreen token={invite} onDone={() => setInviteDone(true)} />;
  const introRole = me.isStaff ? "admin" : "worker";
  if ((me.isStaff || me.branches.length > 0) && !me.user.introSeen.includes(introRole)) return <IntroScreen role={introRole} />;
  if (!me.isStaff && me.branches.length === 0) return <NoBranchScreen />;
  return (
    <NavProvider root={{ name: me.isStaff ? "adminHome" : "workerHome" }}>
      <Stack />
    </NavProvider>
  );
}

export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<unknown>(null);
  const refresh = useCallback(async () => {
    const fresh = await api<Me>("/me");
    setMe(fresh);
    return fresh;
  }, []);
  const load = useCallback(() => {
    setError(null);
    refresh().catch((e) => setError(e));
  }, [refresh]);

  useEffect(() => {
    if (inTelegram || MOCK) load();
  }, [load]);

  const lang = toLang(me?.user.language ?? telegramLanguage());
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  let content;
  if (!inTelegram && !MOCK) content = <OpenInTelegram />;
  else if (error) content = <ErrorState error={error instanceof ApiError ? error : new ApiError("network", 0)} onRetry={load} />;
  else if (!me) content = <SkeletonScreen />;
  else
    content = (
      <SessionContext.Provider value={{ me, setMe, refresh }}>
        <Gate me={me} />
      </SessionContext.Provider>
    );

  return (
    <I18nProvider lang={lang}>
      <ToastProvider>{content}</ToastProvider>
    </I18nProvider>
  );
}
