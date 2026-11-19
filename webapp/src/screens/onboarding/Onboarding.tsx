// First open: consent → phone → name, then a short intro. One question per screen.

import { useEffect, useRef, useState } from "react";
import { api } from "../../api.ts";
import { useT } from "../../i18n/index.tsx";
import { useSession } from "../../session.tsx";
import { BottomActions, BottomSpacer } from "../../telegram/buttons.tsx";
import { atLeast, haptic, openTelegramLink, requestContact, requestWriteAccess } from "../../telegram/tg.ts";
import { Button, Field, Input, Picture, errorText, useToast, type PictureName } from "../../ui/index.ts";
import type { Me } from "../../types.ts";
import type { Key } from "../../i18n/index.tsx";

function Centered({ picture, title, text, children }: { picture: PictureName; title: string; text: string; children?: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-[80vh] max-w-[480px] flex-col items-center justify-center gap-5 px-6 pt-10 text-center safe-top animate-fade-up">
      <Picture name={picture} size={148} />
      <h1 className="text-[28px] leading-tight font-bold">{title}</h1>
      <p className="text-[17px] leading-relaxed text-hint">{text}</p>
      {children}
    </div>
  );
}

export function ConsentScreen() {
  const t = useT();
  const { setMe } = useSession();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Centered picture="privacy" title={t("ob.consent_title")} text={t("ob.consent_text")} />
      <BottomActions
        text={t("ob.consent_ok")}
        loading={busy}
        onClick={async () => {
          setBusy(true);
          try {
            setMe(await api<Me>("/me", { body: { consent: true } }));
          } catch (e) {
            toast(errorText(t, e), "error");
          } finally {
            setBusy(false);
          }
        }}
      />
      <BottomSpacer />
    </>
  );
}

export function PhoneScreen() {
  const t = useT();
  const { me, refresh, setMe } = useSession();
  const toast = useToast();
  const [waiting, setWaiting] = useState(false);
  const [fallback, setFallback] = useState(false);
  const polling = useRef(false);

  const poll = async () => {
    if (polling.current) return;
    polling.current = true;
    try {
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        const fresh = await refresh().catch(() => null);
        if (fresh && !fresh.needs.phone) return;
      }
    } finally {
      polling.current = false;
      setWaiting(false);
    }
  };

  // Coming back from the bot chat: check again.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && fallback) void poll();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [fallback]);

  const share = async () => {
    setWaiting(true);
    // Lets the bot message people who opened the app by link without pressing Start.
    if (!me.user.writeAccess) {
      const granted = await requestWriteAccess();
      if (granted) setMe(await api<Me>("/me", { body: { writeAccess: true } }).catch(() => me));
    }
    if (atLeast("6.9")) {
      const shared = await requestContact();
      if (!shared) {
        setWaiting(false);
        haptic.warning();
        toast(t("ob.phone_declined"), "info");
        return;
      }
    } else {
      await api("/me/request-phone", { body: {} }).catch(() => undefined);
      setFallback(true);
    }
    void poll();
  };

  return (
    <>
      <Centered picture="phone" title={t("ob.phone_title")} text={fallback ? t("ob.phone_fallback") : t("ob.phone_text")}>
        {waiting && <p className="text-[15px] text-hint">{t("ob.phone_waiting")}</p>}
        {fallback && me.botUsername && (
          <Button variant="soft" full={false} onClick={() => openTelegramLink(`https://t.me/${me.botUsername}`)}>
            {t("ob.phone_open_bot")}
          </Button>
        )}
      </Centered>
      <BottomActions text={t("ob.phone_button")} loading={waiting} onClick={share} />
      <BottomSpacer />
    </>
  );
}

export function NameScreen() {
  const t = useT();
  const { me, setMe } = useSession();
  const [name, setName] = useState(me.user.fullName || me.user.telegramName);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      setMe(await api<Me>("/me", { body: { fullName: name } }));
      haptic.success();
    } catch (e) {
      setError(errorText(t, e));
      haptic.error();
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="mx-auto flex max-w-[480px] flex-col gap-5 px-6 pt-12 safe-top animate-fade-up">
        <Picture name="hello" size={120} />
        <div className="text-center">
          <h1 className="text-[28px] font-bold">{t("ob.name_title")}</h1>
          <p className="mt-2 text-[17px] text-hint">{t("ob.name_text")}</p>
        </div>
        <Field error={error}>
          <Input
            value={name}
            autoComplete="name"
            placeholder={t("ob.name_placeholder")}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
        </Field>
      </div>
      <BottomActions text={t("ob.name_ok")} loading={busy} disabled={name.trim().length < 2} onClick={submit} />
      <BottomSpacer />
    </>
  );
}

const INTRO: Record<"worker" | "admin", { picture: PictureName; title: Key; text: Key }[]> = {
  worker: [
    { picture: "scan", title: "intro.w1_title", text: "intro.w1_text" },
    { picture: "privacy", title: "intro.w2_title", text: "intro.w2_text" },
    { picture: "streak", title: "intro.w3_title", text: "intro.w3_text" },
  ],
  admin: [
    { picture: "branch", title: "intro.a1_title", text: "intro.a1_text" },
    { picture: "calendar", title: "intro.a2_title", text: "intro.a2_text" },
    { picture: "chart", title: "intro.a3_title", text: "intro.a3_text" },
  ],
};

export function IntroScreen({ role }: { role: "worker" | "admin" }) {
  const t = useT();
  const { setMe, me } = useSession();
  const [step, setStep] = useState(0);
  const slides = INTRO[role];
  const slide = slides[step];
  const finish = async () => {
    setMe({ ...me, user: { ...me.user, introSeen: [...me.user.introSeen, role] } });
    await api<Me>("/me", { body: { introSeen: role } }).catch(() => undefined);
  };
  return (
    <>
      <div className="flex justify-end px-2 pt-2 safe-top">
        <Button variant="ghost" full={false} size="sm" onClick={finish}>
          {t("c.skip")}
        </Button>
      </div>
      <div key={step}>
        <Centered picture={slide.picture} title={t(slide.title)} text={t(slide.text)}>
          <div className="mt-2 flex gap-2" aria-hidden>
            {slides.map((_, i) => (
              <span key={i} className={`h-2 rounded-full transition-all ${i === step ? "w-6 bg-accent" : "w-2 bg-sep"}`} />
            ))}
          </div>
        </Centered>
      </div>
      <BottomActions
        text={step < slides.length - 1 ? t("c.next") : t("c.start")}
        onClick={() => (step < slides.length - 1 ? setStep(step + 1) : finish())}
      />
      <BottomSpacer />
    </>
  );
}

export function NoBranchScreen() {
  const t = useT();
  return <Centered picture="team" title={t("ob.no_branch_title")} text={t("ob.no_branch_text")} />;
}
