// Tap → live QR scan → GPS → server decides → success or a guided failure.

import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { MapPin } from "lucide-react";
import type { EventType } from "@shared/attendance.ts";
import { api, ApiError, invalidate } from "../../api.ts";
import { useT, type Key } from "../../i18n/index.tsx";
import { useNav } from "../../nav.tsx";
import { BottomActions, BottomSpacer } from "../../telegram/buttons.tsx";
import { canNativeScan, deviceId, getLocation, haptic, nativeScan, openLocationSettings } from "../../telegram/tg.ts";
import { Button, Card, CheckMark, PhoneSettingsPicture, Picture, type PictureName } from "../../ui/index.ts";
import type { AttemptResult } from "../../types.ts";

const CameraScanner = lazy(() => import("./CameraScanner.tsx"));

/** Quick client-side check so a random QR gets "not a branch QR" at once. The server checks for real. */
export function looksLikeBranchQr(text: string): boolean {
  return /[?&]startapp=[qr]_[0-9a-z_]+/i.test(text) || /^[qr]_[0-9a-z_]+$/i.test(text.trim());
}

function newKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

type Phase =
  | { kind: "scanning" }
  | { kind: "locating" }
  | { kind: "sending" }
  | { kind: "done"; result: AttemptResult }
  | { kind: "failed"; reason: string; params: Record<string, string | number> };

const failurePicture: Record<string, PictureName> = {
  too_far: "far",
  weak_gps: "gps",
  no_location: "location",
  location_denied: "location",
  bad_qr: "qr",
  other_branch: "qr",
  old_qr: "qr",
  qr_expired: "qr",
  offline: "offline",
  network: "offline",
  rate_limited: "wait",
  too_early: "wait",
};

export default function Scan({ eventType, workOver }: { eventType: EventType; workOver?: boolean }) {
  const t = useT();
  const nav = useNav();
  const [phase, setPhase] = useState<Phase>({ kind: "scanning" });
  const [camera, setCamera] = useState(false);
  const pending = useRef<{ key: string; body: Record<string, unknown> } | null>(null);
  const locationDenied = useRef(false);

  const send = useCallback(async () => {
    if (!pending.current) return;
    setPhase({ kind: "sending" });
    try {
      const result = await api<AttemptResult>("/worker/attendance", { body: pending.current.body });
      invalidate("/worker");
      if (result.ok) {
        haptic.success();
        setPhase({ kind: "done", result });
      } else {
        haptic.error();
        const reason = result.reason === "no_location" && locationDenied.current ? "location_denied" : (result.reason ?? "bad_qr");
        setPhase({ kind: "failed", reason, params: result.params ?? {} });
      }
      pending.current = null;
    } catch (e) {
      haptic.error();
      // Keep the same key: if the server did store it, retrying returns the same answer.
      setPhase({ kind: "failed", reason: e instanceof ApiError ? e.code : "network", params: e instanceof ApiError ? e.params : {} });
    }
  }, []);

  const afterScan = useCallback(
    async (code: string) => {
      setCamera(false);
      setPhase({ kind: "locating" });
      const [loc, device] = await Promise.all([getLocation(15000), deviceId()]);
      locationDenied.current = !loc.ok && loc.reason === "denied";
      pending.current = {
        key: newKey(),
        body: {
          eventType,
          qrToken: code,
          lat: loc.ok ? loc.lat : null,
          lng: loc.ok ? loc.lng : null,
          accuracy: loc.ok ? loc.accuracy : null,
          deviceId: device,
          ...(eventType === "CHECK_OUT" && workOver ? { workOver: true } : {}),
        },
      };
      pending.current.body.idempotencyKey = pending.current.key;
      if (!navigator.onLine) {
        haptic.error();
        return setPhase({ kind: "failed", reason: "offline", params: {} });
      }
      await send();
    },
    [eventType, send],
  );

  const startScan = useCallback(async () => {
    pending.current = null;
    setPhase({ kind: "scanning" });
    // Screenshot review build only: pretend a branch QR was scanned.
    if (import.meta.env.VITE_MOCK === "1") return void afterScan("q_1_1_000000000000000000000000");
    if (canNativeScan()) {
      const code = await nativeScan(t("s.scan_text"), (c) => {
        if (looksLikeBranchQr(c)) return true;
        haptic.error();
        return false;
      });
      if (code) void afterScan(code);
      else nav.pop();
    } else setCamera(true);
  }, [afterScan, nav, t]);

  useEffect(() => {
    void startScan();
  }, []);

  if (phase.kind === "scanning")
    return camera ? (
      <Suspense fallback={null}>
        <CameraScanner accept={looksLikeBranchQr} onCode={afterScan} onClose={nav.pop} />
      </Suspense>
    ) : (
      <Waiting title={t("s.scan_title")} hint={t("s.scan_text")} />
    );

  if (phase.kind === "locating" || phase.kind === "sending")
    return <Waiting title={phase.kind === "locating" ? t("s.locating") : t("s.sending")} hint={t("s.locating_hint")} pulse />;

  if (phase.kind === "done") return <Success result={phase.result} onDone={nav.pop} />;

  const canResend = (phase.reason === "offline" || phase.reason === "network") && pending.current;
  const lookup = (k: string) => {
    const s = t(k as Key, phase.params);
    return s === k ? null : s;
  };
  const message = lookup(`rej.${phase.reason}`) ?? lookup(`err.${phase.reason}`) ?? t("err.server_error");
  const location = phase.reason === "no_location" || phase.reason === "location_denied";
  return (
    <>
      <div className="mx-auto flex max-w-[480px] flex-col items-center gap-5 px-6 pt-12 text-center safe-top animate-fade-up">
        <Picture name={failurePicture[phase.reason] ?? "error"} />
        <p className="text-[19px] leading-snug font-semibold">{message}</p>
        {location && (
          <Card className="w-full text-left">
            <p className="mb-3 text-[15px] font-semibold">{t("s.loc_help_title")}</p>
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-3">
                <PhoneSettingsPicture kind="ios" />
                <p className="text-[14px] text-hint">{t("s.loc_iphone")}</p>
              </div>
              <div className="flex items-center gap-3">
                <PhoneSettingsPicture kind="android" />
                <p className="text-[14px] text-hint">{t("s.loc_android")}</p>
              </div>
            </div>
            <div className="mt-4">
              <Button variant="soft" icon={<MapPin size={20} />} onClick={() => openLocationSettings()}>
                {t("s.open_settings")}
              </Button>
            </div>
          </Card>
        )}
      </div>
      <BottomSpacer double />
      <BottomActions
        text={t("c.retry")}
        onClick={() => (canResend ? void send() : void startScan())}
        secondary={{ text: t("c.home"), onClick: nav.pop }}
      />
    </>
  );
}

function Waiting({ title, hint, pulse }: { title: string; hint: string; pulse?: boolean }) {
  return (
    <div className="flex min-h-[80vh] flex-col items-center justify-center gap-5 px-6 text-center">
      <div className="relative flex h-32 w-32 items-center justify-center">
        {pulse && <span className="absolute inset-0 animate-ping rounded-full bg-accent/20" />}
        <span className="flex h-24 w-24 items-center justify-center rounded-full bg-accent-soft text-accent">
          <MapPin size={44} />
        </span>
      </div>
      <p className="text-[20px] font-semibold">{title}</p>
      <p className="text-[16px] text-hint">{hint}</p>
    </div>
  );
}

function Success({ result, onDone }: { result: AttemptResult; onDone: () => void }) {
  const t = useT();
  const late = result.eventType === "CHECK_IN" && (result.lateMin ?? 0) > 0;
  const tone = late ? "late" : result.eventType === "BREAK_START" ? "brk" : "ok";
  const title = late ? t("s.ok_CHECK_IN_late", { n: result.lateMin! }) : t(`s.ok_${result.eventType}` as Key);
  return (
    <>
      <div className="mx-auto flex max-w-[480px] flex-col items-center gap-5 px-6 pt-14 text-center safe-top">
        <CheckMark tone={tone} />
        <h1 className="text-[26px] leading-tight font-bold animate-fade-up">{title}</h1>
        <Card className="w-full animate-fade-up">
          <dl className="grid grid-cols-2 gap-y-3 text-left">
            <dt className="text-hint">{t("s.time")}</dt>
            <dd className="tabular text-right text-[20px] font-bold">{result.localTime}</dd>
            {result.distanceM !== null && result.distanceM !== undefined && (
              <>
                <dt className="text-hint">{t("s.distance")}</dt>
                <dd className="tabular text-right text-[17px] font-semibold">{t("c.m", { n: result.distanceM })}</dd>
              </>
            )}
            {result.eventType === "CHECK_IN" && (
              <>
                <dt className="text-hint">{t("s.status")}</dt>
                <dd className={`text-right text-[17px] font-semibold ${late ? "text-late" : "text-ok"}`}>
                  {late ? t("w.late_min", { n: result.lateMin! }) : t("w.on_time")}
                </dd>
              </>
            )}
          </dl>
        </Card>
        {result.workOver && (
          <Card className="w-full text-left">
            {result.workOver.counted ? (
              <>
                <p className="tabular text-[16px] font-semibold">{t("s.work_over_status", { ticked: result.workOver.ticked, needed: result.workOver.needed })}</p>
                <p className={`mt-1 text-[15px] ${result.workOver.forgiven ? "text-ok" : "text-hint"}`}>
                  {result.workOver.forgiven ? t("s.work_over_done") : t("s.work_over_wait")}
                </p>
              </>
            ) : (
              <p className="text-[15px] text-late">{t("s.work_over_not_counted")}</p>
            )}
          </Card>
        )}
        {result.branchName && <p className="text-[14px] text-hint">{result.branchName}</p>}
      </div>
      <BottomActions text={t("c.done")} onClick={onDone} />
      <BottomSpacer />
    </>
  );
}
