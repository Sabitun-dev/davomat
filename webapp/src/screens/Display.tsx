// Tablet page /app/display?d=<key>: a big QR that changes every 30 seconds. No Telegram needed.

import { useEffect, useState } from "react";
import { useT } from "../i18n/index.tsx";
import { Picture, Ring } from "../ui/index.ts";

interface DisplayData {
  branchName: string;
  svg: string;
  secondsLeft: number;
  rotating: boolean;
}

export default function Display() {
  const t = useT();
  const key = new URLSearchParams(location.search).get("d") ?? "";
  const [data, setData] = useState<DisplayData | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [left, setLeft] = useState(30);

  useEffect(() => {
    let timer: number | undefined;
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch(`/api/display?d=${encodeURIComponent(key)}`, { cache: "no-store" });
        if (res.status === 404) return setInvalid(true);
        const d: DisplayData = await res.json();
        if (!alive) return;
        setData(d);
        setLeft(d.secondsLeft);
        timer = window.setTimeout(load, Math.max(1, d.secondsLeft) * 1000 + 300);
      } catch {
        timer = window.setTimeout(load, 5000);
      }
    };
    void load();
    const tick = window.setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    return () => {
      alive = false;
      window.clearTimeout(timer);
      window.clearInterval(tick);
    };
  }, [key]);

  // Keep the tablet screen awake where the browser allows it.
  useEffect(() => {
    const nav = navigator as Navigator & { wakeLock?: { request(type: "screen"): Promise<unknown> } };
    nav.wakeLock?.request("screen").catch(() => undefined);
  }, []);

  if (invalid)
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
        <Picture name="error" />
        <p className="text-[20px]">{t("disp.invalid")}</p>
      </div>
    );

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-bg p-6 text-center">
      <h1 className="text-[34px] font-bold">{data?.branchName ?? "…"}</h1>
      <div className="w-full max-w-[min(80vw,70vh)] rounded-[28px] bg-white p-6 shadow-soft">
        {data && <div dangerouslySetInnerHTML={{ __html: data.svg }} />}
      </div>
      <div className="flex items-center gap-4">
        <Ring value={left / 30} size={56} tone="accent" label={`${left}s`}>
          <span className="tabular text-[17px] font-bold">{left}</span>
        </Ring>
        <p className="max-w-[360px] text-left text-[20px] text-hint">{t("disp.hint")}</p>
      </div>
    </div>
  );
}
