// A small screen stack. Telegram's BackButton pops it; the root screen has no BackButton.

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useBackButton } from "./telegram/buttons.tsx";

export interface Route {
  name: string;
  params?: Record<string, unknown>;
}

interface Nav {
  stack: Route[];
  push(name: string, params?: Record<string, unknown>): void;
  pop(): void;
  reset(name: string, params?: Record<string, unknown>): void;
}

const NavContext = createContext<Nav | null>(null);

export function NavProvider({ root, children }: { root: Route; children: ReactNode }) {
  const [stack, setStack] = useState<Route[]>([root]);
  const push = useCallback((name: string, params?: Record<string, unknown>) => {
    setStack((s) => [...s, { name, params }]);
    window.scrollTo(0, 0);
  }, []);
  const pop = useCallback(() => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)), []);
  const reset = useCallback((name: string, params?: Record<string, unknown>) => setStack([{ name, params }]), []);
  const value = useMemo(() => ({ stack, push, pop, reset }), [stack, push, pop, reset]);
  return <NavContext.Provider value={value}>{children}</NavContext.Provider>;
}

export function useNav(): Nav {
  const nav = useContext(NavContext);
  if (!nav) throw new Error("useNav outside NavProvider");
  return nav;
}

/** Wires the Telegram BackButton to the stack. */
export function NavBackButton() {
  const { stack, pop } = useNav();
  useBackButton(stack.length > 1 ? pop : null);
  return null;
}
