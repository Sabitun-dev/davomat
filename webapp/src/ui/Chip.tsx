import type { ReactNode } from "react";
import {
  Briefcase,
  CircleCheck,
  CircleX,
  Clock,
  Coffee,
  Moon,
  Star,
  TriangleAlert,
  CircleDashed,
} from "lucide-react";
import type { Key } from "../i18n/index.tsx";
import { useT } from "../i18n/index.tsx";

export type Tone = "ok" | "late" | "bad" | "off" | "brk" | "accent";

const tones: Record<Tone, string> = {
  ok: "bg-ok-soft text-ok",
  late: "bg-late-soft text-late",
  bad: "bg-bad-soft text-bad",
  off: "bg-off-soft text-off",
  brk: "bg-brk-soft text-brk",
  accent: "bg-accent-soft text-accent",
};

export function Chip({ tone, icon, children }: { tone: Tone; icon?: ReactNode; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[13px] font-semibold ${tones[tone]}`}>
      {icon}
      {children}
    </span>
  );
}

export function Badge({ children, tone = "bad" }: { children: ReactNode; tone?: Tone }) {
  return (
    <span className={`inline-flex min-w-[22px] items-center justify-center rounded-full px-1.5 text-[12px] font-bold leading-[22px] ${tones[tone]}`}>
      {children}
    </span>
  );
}

/** Day look: status colour + icon + word, never colour alone. */
export type DayLook = "ON_TIME" | "LATE" | "ABSENT" | "DAY_OFF" | "EXTRA_DAY" | "IN_PROGRESS" | "ON_BREAK" | "REVIEW" | "NOT_STARTED" | "FUTURE";

export const dayLooks: Record<DayLook, { tone: Tone; Icon: typeof Clock; label: Key }> = {
  ON_TIME: { tone: "ok", Icon: CircleCheck, label: "st.ON_TIME" },
  LATE: { tone: "late", Icon: Clock, label: "st.LATE" },
  ABSENT: { tone: "bad", Icon: CircleX, label: "st.ABSENT" },
  DAY_OFF: { tone: "off", Icon: Moon, label: "st.DAY_OFF" },
  EXTRA_DAY: { tone: "accent", Icon: Star, label: "st.EXTRA_DAY" },
  IN_PROGRESS: { tone: "accent", Icon: Briefcase, label: "st.IN_PROGRESS" },
  ON_BREAK: { tone: "brk", Icon: Coffee, label: "w.state_ON_BREAK" },
  REVIEW: { tone: "late", Icon: TriangleAlert, label: "st.REVIEW" },
  NOT_STARTED: { tone: "off", Icon: CircleDashed, label: "st.NOT_STARTED" },
  FUTURE: { tone: "off", Icon: CircleDashed, label: "st.FUTURE" },
};

/** Picks the look for a stored day result. */
export function lookOf(day: { status: string; needsReview?: boolean; reviewedAt?: string | null } | null | undefined): DayLook {
  if (!day) return "FUTURE";
  if (day.needsReview && !day.reviewedAt) return "REVIEW";
  return (day.status in dayLooks ? day.status : "FUTURE") as DayLook;
}

export function StatusChip({ look, text }: { look: DayLook; text?: string }) {
  const t = useT();
  const { tone, Icon, label } = dayLooks[look];
  return (
    <Chip tone={tone} icon={<Icon size={14} strokeWidth={2.5} aria-hidden />}>
      {text ?? t(label)}
    </Chip>
  );
}
