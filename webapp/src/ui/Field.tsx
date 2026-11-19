import { useEffect, useState, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { haptic } from "../telegram/tg.ts";

export function Field({ label, hint, error, children }: { label?: ReactNode; hint?: ReactNode; error?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      {label && <span className="mb-1.5 block px-1 text-[14px] font-medium text-hint">{label}</span>}
      {children}
      {error ? (
        <span className="mt-1 block px-1 text-[14px] text-bad">{error}</span>
      ) : (
        hint && <span className="mt-1 block px-1 text-[13px] text-hint">{hint}</span>
      )}
    </label>
  );
}

const inputCls =
  "w-full min-h-[50px] rounded-2xl bg-card px-4 text-[17px] text-ink shadow-soft outline-none placeholder:text-hint focus:ring-2 focus:ring-accent";

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputCls} ${props.className ?? ""}`} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea rows={3} {...props} className={`${inputCls} py-3 ${props.className ?? ""}`} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${inputCls} appearance-none ${props.className ?? ""}`} />;
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  compact,
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
  /** Smaller text so 4 options fit on a 360 px phone. */
  compact?: boolean;
}) {
  return (
    <div className="flex rounded-2xl bg-sep p-1" role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={o.value === value}
          onClick={() => {
            haptic.select();
            onChange(o.value);
          }}
          className={`min-h-[40px] min-w-0 flex-1 truncate rounded-xl font-semibold transition ${compact ? "px-1 text-[13px]" : "px-2 text-[15px]"} ${
            o.value === value ? "bg-card text-ink shadow-soft" : "text-hint"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => {
        haptic.select();
        onChange(!checked);
      }}
      className="flex min-h-[56px] w-full items-center gap-3 px-4 py-2 text-left"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[16px]">{label}</span>
        {hint && <span className="block text-[13px] text-hint">{hint}</span>}
      </span>
      <span className={`relative h-[30px] w-[50px] shrink-0 rounded-full transition ${checked ? "bg-accent" : "bg-sep"}`}>
        <span
          className={`absolute top-[3px] h-6 w-6 rounded-full bg-white shadow transition-all ${checked ? "left-[23px]" : "left-[3px]"}`}
        />
      </span>
    </button>
  );
}

/** − 25 + : a number with big tap targets. */
export function Stepper({
  value,
  onChange,
  step = 1,
  min = 0,
  max = 9999,
  suffix,
}: {
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  suffix?: string;
}) {
  const set = (v: number) => {
    haptic.select();
    onChange(Math.max(min, Math.min(max, v)));
  };
  return (
    <div className="flex items-center gap-2">
      <button type="button" aria-label="−" onClick={() => set(value - step)} className="h-12 w-12 rounded-2xl bg-card text-[22px] font-bold shadow-soft">
        −
      </button>
      <input
        inputMode="numeric"
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value.replace(/\D/g, ""));
          if (Number.isFinite(n)) onChange(Math.max(min, Math.min(max, n)));
        }}
        className="tabular h-12 min-w-0 flex-1 rounded-2xl bg-card text-center text-[18px] font-semibold shadow-soft outline-none"
      />
      {suffix && <span className="text-[15px] text-hint">{suffix}</span>}
      <button type="button" aria-label="+" onClick={() => set(value + step)} className="h-12 w-12 rounded-2xl bg-card text-[22px] font-bold shadow-soft">
        +
      </button>
    </div>
  );
}

/** 24-hour "HH:MM" field. Typing "930" becomes "09:30". Reports minutes from midnight (or null). */
export function TimeField({ value, onChange, label }: { value: number | null; onChange: (minute: number | null) => void; label: string }) {
  const show = (m: number | null) => (m === null ? "" : `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
  const [text, setText] = useState(show(value));
  useEffect(() => setText(show(value)), [value]);
  const parse = (raw: string): number | null => {
    const digits = raw.replace(/\D/g, "").slice(0, 4);
    if (!digits) return null;
    const padded = digits.length <= 2 ? `${digits.padStart(2, "0")}00` : digits.padStart(4, "0");
    const h = Number(padded.slice(0, 2));
    const m = Number(padded.slice(2));
    return h <= 23 && m <= 59 ? h * 60 + m : null;
  };
  return (
    <input
      aria-label={label}
      inputMode="numeric"
      placeholder="09:00"
      value={text}
      maxLength={5}
      onChange={(e) => {
        const d = e.target.value.replace(/\D/g, "").slice(0, 4);
        setText(d.length > 2 ? `${d.slice(0, 2)}:${d.slice(2)}` : d);
      }}
      onBlur={() => {
        const m = parse(text);
        setText(show(m ?? value));
        if (m !== null) onChange(m);
      }}
      className={`${inputCls} tabular min-w-0 px-2 text-center`}
    />
  );
}
