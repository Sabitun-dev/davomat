// Small pieces: stat tile, progress ring, skeletons, calendar cell, check animation.

import type { ReactNode } from "react";
import { dayLooks, type DayLook } from "./Chip.tsx";

export function StatTile({
  label,
  value,
  hint,
  tone,
  icon,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "ok" | "late" | "bad" | "brk" | "accent";
  icon?: ReactNode;
}) {
  const color =
    tone === "ok" ? "text-ok" : tone === "late" ? "text-late" : tone === "bad" ? "text-bad" : tone === "brk" ? "text-brk" : tone === "accent" ? "text-accent" : "text-ink";
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-[20px] bg-card p-4 shadow-soft">
      <span className="flex items-center gap-1.5 text-[13px] font-medium text-hint">
        {icon}
        <span className="truncate">{label}</span>
      </span>
      {/* Long money values shrink so they never get cut off in a half-width tile. */}
      <span className={`tabular leading-tight font-bold whitespace-nowrap ${typeof value === "string" && value.length > 11 ? "text-[17px]" : "text-[22px]"} ${color}`}>{value}</span>
      {hint && <span className="truncate text-[13px] text-hint">{hint}</span>}
    </div>
  );
}

export function Ring({
  value,
  size = 64,
  stroke = 7,
  tone = "accent",
  children,
  label,
}: {
  value: number;
  size?: number;
  stroke?: number;
  tone?: "accent" | "ok" | "late" | "brk";
  children?: ReactNode;
  label?: string;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  const color = { accent: "var(--app-accent)", ok: "var(--st-green)", late: "var(--st-amber)", brk: "var(--st-blue)" }[tone];
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={label}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--app-sep)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - v)}
          style={{ transition: "stroke-dashoffset 0.6s ease-out" }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">{children}</div>
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden />;
}

export function SkeletonScreen() {
  return (
    <div className="flex flex-col gap-3 p-4" aria-busy="true">
      <Skeleton className="h-8 w-2/3" />
      <Skeleton className="h-44 w-full rounded-[20px]" />
      <div className="grid grid-cols-2 gap-3">
        <Skeleton className="h-24 rounded-[20px]" />
        <Skeleton className="h-24 rounded-[20px]" />
      </div>
      <Skeleton className="h-16 w-full rounded-[20px]" />
    </div>
  );
}

const CELL_BG = { ok: "bg-ok-soft", late: "bg-late-soft", bad: "bg-bad-soft", off: "bg-off-soft", brk: "bg-brk-soft", accent: "bg-accent-soft" };
const CELL_FG = { ok: "text-ok", late: "text-late", bad: "text-bad", off: "text-off", brk: "text-brk", accent: "text-accent" };

/** One day in a month calendar: number + status icon (+ colour). */
export function CalendarCell({
  day,
  look,
  today,
  onClick,
  label,
}: {
  day: number;
  look: DayLook;
  today?: boolean;
  onClick?: () => void;
  label: string;
}) {
  const { tone, Icon } = dayLooks[look];
  const empty = look === "FUTURE" || look === "NOT_STARTED";
  const bg = empty ? "bg-transparent" : CELL_BG[tone];
  const fg = CELL_FG[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      aria-label={label}
      className={`flex aspect-square min-h-[44px] flex-col items-center justify-center gap-0.5 rounded-xl ${bg} ${
        today ? "ring-2 ring-accent" : ""
      }`}
    >
      <span className={`tabular text-[15px] font-semibold ${empty ? "text-ink" : fg}`}>{day}</span>
      {!empty && <Icon size={13} strokeWidth={2.5} className={fg} aria-hidden />}
    </button>
  );
}

/** The big success tick that draws itself. */
export function CheckMark({ tone = "ok" }: { tone?: "ok" | "late" | "brk" | "accent" }) {
  const color = { ok: "var(--st-green)", late: "var(--st-amber)", brk: "var(--st-blue)", accent: "var(--app-accent)" }[tone];
  return (
    <div className="animate-pop">
      <svg width="112" height="112" viewBox="0 0 112 112" aria-hidden>
        <circle cx="56" cy="56" r="52" fill={color} opacity="0.14" />
        <circle cx="56" cy="56" r="38" fill={color} />
        <path className="check-draw" d="M38 57 L51 70 L75 44" fill="none" stroke="#fff" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}
