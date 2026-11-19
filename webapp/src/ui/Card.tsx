import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { haptic } from "../telegram/tg.ts";

export function Card({
  children,
  className = "",
  padded = true,
  onClick,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
  onClick?: () => void;
}) {
  const cls = `rounded-[20px] bg-card shadow-soft ${padded ? "p-4" : ""} ${className}`;
  if (onClick)
    return (
      <button
        type="button"
        className={`${cls} block w-full text-left transition active:scale-[0.99]`}
        onClick={() => {
          haptic.tap();
          onClick();
        }}
      >
        {children}
      </button>
    );
  return <div className={cls}>{children}</div>;
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mt-6 mb-2 flex min-h-[28px] items-center justify-between px-1">
      <h2 className="text-[13px] font-semibold uppercase tracking-wide text-hint">{children}</h2>
      {action}
    </div>
  );
}

/** A tappable row inside a card: icon, title, subtitle, right side and a chevron. */
export function ListRow({
  icon,
  title,
  subtitle,
  right,
  onClick,
  chevron = Boolean(onClick),
  danger,
}: {
  icon?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
  onClick?: () => void;
  chevron?: boolean;
  danger?: boolean;
}) {
  const content = (
    <>
      {icon && (
        <span
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
            danger ? "bg-bad-soft text-bad" : "bg-accent-soft text-accent"
          }`}
        >
          {icon}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-[16px] ${danger ? "text-bad" : "text-ink"}`}>{title}</span>
        {subtitle && <span className="mt-0.5 block truncate text-[14px] text-hint">{subtitle}</span>}
      </span>
      {right && <span className="shrink-0 text-[15px] text-hint">{right}</span>}
      {chevron && <ChevronRight size={20} className="shrink-0 text-hint" aria-hidden />}
    </>
  );
  const cls = "flex min-h-[56px] w-full items-center gap-3 px-4 py-2 text-left";
  if (!onClick) return <div className={cls}>{content}</div>;
  return (
    <button
      type="button"
      className={`${cls} active:bg-sep`}
      onClick={() => {
        haptic.tap();
        onClick();
      }}
    >
      {content}
    </button>
  );
}

/** Groups ListRows inside one card with thin separators. */
export function ListCard({ children }: { children: ReactNode }) {
  return <div className="divide-y divide-sep overflow-hidden rounded-[20px] bg-card shadow-soft">{children}</div>;
}
