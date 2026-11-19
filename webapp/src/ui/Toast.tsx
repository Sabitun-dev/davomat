import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { CircleCheck, CircleX, Info } from "lucide-react";
import { haptic } from "../telegram/tg.ts";

type Kind = "ok" | "error" | "info";
type Show = (text: string, kind?: Kind) => void;

const ToastContext = createContext<Show>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ text: string; kind: Kind; id: number } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const show = useCallback<Show>((text, kind = "ok") => {
    if (kind === "ok") haptic.success();
    if (kind === "error") haptic.error();
    window.clearTimeout(timer.current);
    setToast({ text, kind, id: Date.now() });
    timer.current = window.setTimeout(() => setToast(null), 2600);
  }, []);
  const Icon = toast?.kind === "error" ? CircleX : toast?.kind === "info" ? Info : CircleCheck;
  return (
    <ToastContext.Provider value={show}>
      {children}
      {toast && (
        <div className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex justify-center px-4 pt-3 safe-top" role="status" aria-live="polite">
          <div
            key={toast.id}
            className="flex max-w-[480px] items-center gap-2 rounded-2xl bg-ink px-4 py-3 text-[15px] font-medium text-card shadow-soft animate-fade-up"
          >
            <Icon size={20} className={toast.kind === "error" ? "text-bad" : toast.kind === "ok" ? "text-ok" : ""} aria-hidden />
            <span>{toast.text}</span>
          </div>
        </div>
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): Show {
  return useContext(ToastContext);
}
