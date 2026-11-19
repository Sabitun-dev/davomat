import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useT } from "../i18n/index.tsx";
import { useBackButton, useSheetOpen } from "../telegram/buttons.tsx";

/** A bottom sheet. Closes on backdrop tap, the X button and Telegram's BackButton. */
export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const t = useT();
  useBackButton(open ? onClose : null);
  useSheetOpen(open);
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/40 animate-[fade-up_0.2s_ease-out]" onClick={onClose} />
      <div className="relative flex max-h-[88vh] w-full max-w-[560px] flex-col rounded-t-[24px] bg-bg animate-sheet">
        <div className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-sep" aria-hidden />
        <div className="flex items-center gap-2 px-4 pt-2 pb-1">
          <h3 className="min-w-0 flex-1 truncate text-[20px] font-bold">{title}</h3>
          <button
            type="button"
            aria-label={t("c.close")}
            onClick={onClose}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-card text-hint"
          >
            <X size={20} />
          </button>
        </div>
        <div className="overflow-y-auto px-4 pt-2 pb-4">{children}</div>
        {footer && <div className="border-t border-sep px-4 pt-3 safe-bottom">{footer}</div>}
        {!footer && <div className="safe-bottom" />}
      </div>
    </div>,
    document.body,
  );
}
