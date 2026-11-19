// Telegram's big bottom buttons (MainButton / SecondaryButton) and the BackButton as React pieces.
// Outside Telegram (or on old versions) the same buttons are drawn inside the page.

import { useEffect, useRef, useState } from "react";
import { atLeast, haptic, tg } from "./tg.ts";
import { Button } from "../ui/Button.tsx";

export interface BottomActionsProps {
  text: string;
  onClick: () => void;
  loading?: boolean;
  disabled?: boolean;
  tone?: "accent" | "danger";
  secondary?: { text: string; onClick: () => void };
}

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return /^#[0-9a-f]{6}$/i.test(v) ? v : fallback;
}

const nativeMain = Boolean(tg && atLeast("6.1"));
const nativeSecondary = Boolean(tg?.SecondaryButton && atLeast("7.10"));

// While a sheet is open the screen's bottom buttons are hidden (the sheet has its own).
let openSheets = 0;
const sheetListeners = new Set<(n: number) => void>();

export function useSheetOpen(open: boolean) {
  useEffect(() => {
    if (!open) return;
    openSheets++;
    sheetListeners.forEach((l) => l(openSheets));
    return () => {
      openSheets--;
      sheetListeners.forEach((l) => l(openSheets));
    };
  }, [open]);
}

function useSheetsOpen(): boolean {
  const [n, setN] = useState(openSheets);
  useEffect(() => {
    sheetListeners.add(setN);
    return () => void sheetListeners.delete(setN);
  }, []);
  return n > 0;
}

export function BottomActions(props: BottomActionsProps) {
  const ref = useRef(props);
  ref.current = props;
  const hidden = useSheetsOpen();

  useEffect(() => {
    if (!nativeMain || !tg) return;
    const main = tg.MainButton;
    const click = () => {
      if (ref.current.loading || ref.current.disabled) return;
      haptic.tap();
      ref.current.onClick();
    };
    main.onClick(click);
    const second = nativeSecondary ? tg.SecondaryButton! : null;
    const click2 = () => {
      haptic.tap();
      ref.current.secondary?.onClick();
    };
    second?.onClick(click2);
    return () => {
      main.offClick(click);
      main.hideProgress();
      main.setParams({ is_visible: false });
      second?.offClick(click2);
      second?.setParams({ is_visible: false });
    };
  }, []);

  useEffect(() => {
    if (!nativeMain || !tg) return;
    const color =
      props.tone === "danger" ? cssVar("--st-red", "#c8312f") : cssVar("--app-accent-strong", "#6d4aff");
    tg.MainButton.setParams({
      text: props.text,
      color,
      text_color: "#ffffff",
      is_visible: !hidden,
      is_active: !props.disabled,
      has_shine_effect: false,
    });
    if (props.loading) tg.MainButton.showProgress(false);
    else tg.MainButton.hideProgress();
    if (nativeSecondary) {
      tg.SecondaryButton!.setParams(
        props.secondary && !hidden
          ? { text: props.secondary.text, is_visible: true, is_active: true, position: "bottom" }
          : { is_visible: false },
      );
    }
  }, [props.text, props.loading, props.disabled, props.tone, props.secondary?.text, hidden]);

  const showSecondaryInPage = props.secondary && !nativeSecondary;
  if (hidden || (nativeMain && !showSecondaryInPage)) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-30 bg-bg/95 px-4 pt-3 backdrop-blur safe-bottom">
      <div className="mx-auto flex max-w-[560px] flex-col gap-2">
        {props.secondary && (
          <Button variant="secondary" size="lg" onClick={props.secondary.onClick}>
            {props.secondary.text}
          </Button>
        )}
        {!nativeMain && (
          <Button
            size="lg"
            variant={props.tone === "danger" ? "danger" : "primary"}
            loading={props.loading}
            disabled={props.disabled}
            onClick={props.onClick}
          >
            {props.text}
          </Button>
        )}
      </div>
    </div>
  );
}

/** Space at the bottom of a page so content is not hidden behind in-page buttons. */
export function BottomSpacer({ double }: { double?: boolean }) {
  if (nativeMain && !double) return <div className="h-4" />;
  return <div className={double ? "h-40" : "h-24"} />;
}

// Back handlers form a stack: an open sheet handles Back before the screen under it.
const backStack: { current: (() => void) | null }[] = [];
let backBound = false;

function syncBackButton() {
  if (!tg || !atLeast("6.1")) return;
  if (!backBound) {
    backBound = true;
    tg.BackButton.onClick(() => backStack[backStack.length - 1]?.current?.());
  }
  if (backStack.length) tg.BackButton.show();
  else tg.BackButton.hide();
}

/** Shows Telegram's BackButton while mounted; only the newest handler runs. */
export function useBackButton(onBack: (() => void) | null) {
  const ref = useRef(onBack);
  ref.current = onBack;
  useEffect(() => {
    if (!onBack) return;
    const entry = ref as { current: (() => void) | null };
    backStack.push(entry);
    syncBackButton();
    return () => {
      const i = backStack.lastIndexOf(entry);
      if (i >= 0) backStack.splice(i, 1);
      syncBackButton();
    };
  }, [Boolean(onBack)]);
}

export const hasNativeBack = Boolean(tg && atLeast("6.1"));
