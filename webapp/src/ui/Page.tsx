import type { ReactNode } from "react";
import { ChevronLeft } from "lucide-react";
import { useT } from "../i18n/index.tsx";
import { ApiError } from "../api.ts";
import { hasNativeBack } from "../telegram/buttons.tsx";
import { Button } from "./Button.tsx";
import { Picture, type PictureName } from "./Pictures.tsx";
import type { Key } from "../i18n/index.tsx";

/** Screen layout: title, optional subtitle and a back arrow when Telegram has no BackButton. */
export function Page({
  title,
  subtitle,
  onBack,
  right,
  children,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  onBack?: () => void;
  right?: ReactNode;
  children: ReactNode;
}) {
  const t = useT();
  return (
    <div className="mx-auto min-h-screen w-full max-w-[560px] px-4 pt-3 safe-top animate-fade-up">
      {(title || right || (onBack && !hasNativeBack)) && (
        <header className="mb-3 flex min-h-[48px] items-center gap-1">
          {onBack && !hasNativeBack && (
            <button
              type="button"
              aria-label={t("c.close")}
              onClick={onBack}
              className="-ml-2 flex h-12 w-12 items-center justify-center rounded-full text-accent active:bg-sep"
            >
              <ChevronLeft size={28} />
            </button>
          )}
          <div className="min-w-0 flex-1">
            {title && <h1 className="truncate text-[26px] leading-tight font-bold">{title}</h1>}
            {subtitle && <p className="truncate text-[15px] text-hint">{subtitle}</p>}
          </div>
          {right}
        </header>
      )}
      {children}
    </div>
  );
}

export function errorText(t: (k: Key, p?: Record<string, string | number>) => string, err: unknown): string {
  if (err instanceof ApiError) {
    const key = `err.${err.code}` as Key;
    const text = t(key, err.params);
    return text === key ? t("err.server_error") : text;
  }
  return t("err.server_error");
}

/** Guided, never scary: a picture, one sentence and "Qayta urinish". */
export function ErrorState({ error, onRetry, picture }: { error: unknown; onRetry?: () => void; picture?: PictureName }) {
  const t = useT();
  const offline = error instanceof ApiError && (error.code === "offline" || error.code === "network");
  return (
    <div className="flex flex-col items-center gap-4 px-6 py-10 text-center">
      <Picture name={picture ?? (offline ? "offline" : "error")} />
      <p className="text-[17px]">{errorText(t, error)}</p>
      {onRetry && (
        <Button full={false} className="min-w-[200px]" onClick={onRetry}>
          {t("c.retry")}
        </Button>
      )}
    </div>
  );
}

export function EmptyState({ text, picture = "empty", action }: { text: ReactNode; picture?: PictureName; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-4 px-6 py-8 text-center">
      <Picture name={picture} size={112} />
      <p className="text-[16px] text-hint">{text}</p>
      {action}
    </div>
  );
}
