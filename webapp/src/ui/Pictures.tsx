// Friendly pictures for empty, error and intro screens. Drawn inline so they cost no download.

import {
  Building2,
  CalendarDays,
  ChartColumn,
  Flame,
  MapPinOff,
  QrCode,
  SatelliteDish,
  ScanLine,
  ShieldCheck,
  Smartphone,
  Users,
  WifiOff,
  Hand,
  Footprints,
  CircleAlert,
  Inbox,
  Clock,
} from "lucide-react";

const pictures = {
  location: { Icon: MapPinOff, tone: "var(--st-red)" },
  gps: { Icon: SatelliteDish, tone: "var(--st-amber)" },
  qr: { Icon: QrCode, tone: "var(--st-red)" },
  far: { Icon: Footprints, tone: "var(--st-amber)" },
  offline: { Icon: WifiOff, tone: "var(--st-grey)" },
  error: { Icon: CircleAlert, tone: "var(--st-red)" },
  wait: { Icon: Clock, tone: "var(--st-blue)" },
  empty: { Icon: Inbox, tone: "var(--st-grey)" },
  hello: { Icon: Hand, tone: "var(--app-accent)" },
  privacy: { Icon: ShieldCheck, tone: "var(--st-green)" },
  phone: { Icon: Smartphone, tone: "var(--app-accent)" },
  scan: { Icon: ScanLine, tone: "var(--app-accent)" },
  streak: { Icon: Flame, tone: "var(--st-amber)" },
  branch: { Icon: Building2, tone: "var(--app-accent)" },
  calendar: { Icon: CalendarDays, tone: "var(--app-accent)" },
  chart: { Icon: ChartColumn, tone: "var(--app-accent)" },
  team: { Icon: Users, tone: "var(--app-accent)" },
} as const;

export type PictureName = keyof typeof pictures;

export function Picture({ name, size = 132 }: { name: PictureName; size?: number }) {
  const { Icon, tone } = pictures[name];
  return (
    <div className="relative mx-auto animate-pop" style={{ width: size, height: size }} aria-hidden>
      <svg width={size} height={size} viewBox="0 0 100 100" className="absolute inset-0">
        <path
          d="M50 4c17 0 30 6 38 18s9 27 4 40-15 24-29 30-30 6-42-2S3 70 4 54 11 22 22 13 33 4 50 4z"
          fill={tone}
          opacity="0.13"
        />
        <circle cx="84" cy="18" r="5" fill={tone} opacity="0.35" />
        <circle cx="12" cy="80" r="3.5" fill={tone} opacity="0.3" />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center" style={{ color: tone }}>
        <Icon size={size * 0.42} strokeWidth={1.6} />
      </div>
    </div>
  );
}

/** A simple phone drawing with the location switch turned on (iPhone or Android style). */
export function PhoneSettingsPicture({ kind }: { kind: "ios" | "android" }) {
  const ios = kind === "ios";
  return (
    <svg viewBox="0 0 120 200" width="96" height="160" aria-hidden className="shrink-0">
      <rect x="4" y="4" width="112" height="192" rx={ios ? 22 : 14} fill="var(--app-card)" stroke="var(--app-hint)" strokeWidth="3" />
      {ios ? (
        <rect x="42" y="12" width="36" height="9" rx="4.5" fill="var(--app-hint)" opacity="0.6" />
      ) : (
        <circle cx="60" cy="16" r="4" fill="var(--app-hint)" opacity="0.6" />
      )}
      <rect x="16" y="34" width="58" height="8" rx="4" fill="var(--app-hint)" opacity="0.35" />
      {[56, 84, 140].map((y) => (
        <rect key={y} x="16" y={y} width="88" height="18" rx="6" fill="var(--app-hint)" opacity="0.12" />
      ))}
      <rect x="12" y="106" width="96" height="26" rx="8" fill="var(--st-green)" opacity="0.16" />
      <path d="M24 113c-3.5 0-6 2.5-6 5.8 0 4.2 6 9.2 6 9.2s6-5 6-9.2c0-3.3-2.5-5.8-6-5.8z" fill="var(--st-green)" />
      <rect x="36" y="115" width="34" height="7" rx="3.5" fill="var(--app-text)" opacity="0.55" />
      {ios ? (
        <>
          <rect x="78" y="111" width="26" height="16" rx="8" fill="var(--st-green)" />
          <circle cx="96" cy="119" r="6.5" fill="#fff" />
        </>
      ) : (
        <>
          <rect x="80" y="114" width="24" height="10" rx="5" fill="var(--st-green)" opacity="0.5" />
          <circle cx="98" cy="119" r="7.5" fill="var(--st-green)" />
        </>
      )}
    </svg>
  );
}
