import { createContext, useContext } from "react";
import type { Me } from "./types.ts";

export interface Session {
  me: Me;
  setMe(me: Me): void;
  refresh(): Promise<Me>;
}

export const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const s = useContext(SessionContext);
  if (!s) throw new Error("useSession outside provider");
  return s;
}
