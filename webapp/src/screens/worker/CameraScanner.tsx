// Live camera QR scanner for when Telegram's own scanner is not available.
// Camera only: there is no way to pick a picture from the gallery.

import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { X } from "lucide-react";
import { useT } from "../../i18n/index.tsx";
import { haptic } from "../../telegram/tg.ts";

export default function CameraScanner({
  onCode,
  onClose,
  accept,
}: {
  onCode: (code: string) => void;
  onClose: () => void;
  accept: (code: string) => boolean;
}) {
  const t = useT();
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [wrong, setWrong] = useState(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let frame = 0;
    let stopped = false;
    let lastWrong = 0;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    const scan = () => {
      if (stopped) return;
      const v = video.current;
      if (v && ctx && v.readyState >= 2 && v.videoWidth) {
        // Scale down for speed on old phones.
        const scale = Math.min(1, 480 / Math.max(v.videoWidth, v.videoHeight));
        canvas.width = Math.round(v.videoWidth * scale);
        canvas.height = Math.round(v.videoHeight * scale);
        ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const found = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
        if (found?.data) {
          if (accept(found.data)) {
            stopped = true;
            onCode(found.data);
            return;
          }
          if (Date.now() - lastWrong > 1500) {
            lastWrong = Date.now();
            haptic.error();
            setWrong(true);
            setTimeout(() => setWrong(false), 1500);
          }
        }
      }
      frame = requestAnimationFrame(scan);
    };

    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1280 } }, audio: false })
      .then((s) => {
        stream = s;
        if (video.current) {
          video.current.srcObject = s;
          void video.current.play();
        }
        frame = requestAnimationFrame(scan);
      })
      .catch((e: DOMException) => setError(e?.name === "NotAllowedError" ? t("s.camera_denied") : t("s.camera_none")));
    if (!navigator.mediaDevices) setError(t("s.camera_none"));

    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((tr) => tr.stop());
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black text-white">
      <video ref={video} playsInline muted className="absolute inset-0 h-full w-full object-cover" />
      <div className="relative flex items-center justify-between p-4 safe-top">
        <p className="text-[17px] font-semibold drop-shadow">{t("s.scan_title")}</p>
        <button type="button" aria-label={t("c.close")} onClick={onClose} className="flex h-12 w-12 items-center justify-center rounded-full bg-black/40">
          <X size={24} />
        </button>
      </div>
      <div className="relative flex flex-1 items-center justify-center">
        <div className={`h-64 w-64 rounded-[28px] border-4 transition ${wrong ? "border-[#ff7b78]" : "border-white/90"}`} style={{ boxShadow: "0 0 0 9999px rgb(0 0 0 / 0.45)" }} />
      </div>
      <p className="relative p-6 pb-10 text-center text-[17px] drop-shadow">
        {error ?? (wrong ? t("s.not_branch_qr") : t("s.scan_text"))}
      </p>
    </div>
  );
}
