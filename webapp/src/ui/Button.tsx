import type { ButtonHTMLAttributes, ReactNode } from "react";
import { haptic } from "../telegram/tg.ts";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "soft";
type Size = "lg" | "md" | "sm";

const variants: Record<Variant, string> = {
  primary: "bg-accent text-accent-ink active:brightness-95",
  secondary: "bg-card text-ink shadow-soft active:bg-sep",
  soft: "bg-accent-soft text-accent active:brightness-95",
  ghost: "bg-transparent text-accent active:bg-accent-soft",
  danger: "bg-bad-soft text-bad active:brightness-95",
};

const sizes: Record<Size, string> = {
  lg: "min-h-[54px] px-5 text-[17px] rounded-2xl",
  md: "min-h-[48px] px-4 text-[16px] rounded-2xl",
  sm: "min-h-[40px] px-3 text-[15px] rounded-xl",
};

export function Button({
  variant = "primary",
  size = "md",
  loading,
  icon,
  full = true,
  className = "",
  children,
  onClick,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
  full?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      onClick={(e) => {
        haptic.tap();
        onClick?.(e);
      }}
      className={`inline-flex items-center justify-center gap-2 font-semibold transition select-none disabled:opacity-50 ${
        full ? "w-full" : ""
      } ${variants[variant]} ${sizes[size]} ${className}`}
      {...rest}
    >
      {loading ? (
        <span className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />
      ) : (
        icon
      )}
      {children}
    </button>
  );
}

/** A round icon-only button (48 px tap target). */
export function IconButton({
  label,
  children,
  onClick,
  className = "",
}: {
  label: string;
  children: ReactNode;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => {
        haptic.tap();
        onClick();
      }}
      className={`inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-ink active:bg-sep ${className}`}
    >
      {children}
    </button>
  );
}
