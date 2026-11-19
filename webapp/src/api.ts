// Talking to the server. Every request carries Telegram's signed initData.

import { useCallback, useEffect, useRef, useState } from "react";
import { initData } from "./telegram/tg.ts";

export class ApiError extends Error {
  constructor(
    public code: string,
    public status: number,
    public params: Record<string, string | number> = {},
  ) {
    super(code);
  }
}

export async function api<T>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: opts.method ?? (opts.body === undefined ? "GET" : "POST"),
      headers: {
        authorization: `tma ${initData()}`,
        ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
    });
  } catch {
    throw new ApiError(navigator.onLine === false ? "offline" : "network", 0);
  } finally {
    clearTimeout(timer);
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    // empty body
  }
  if (!res.ok) {
    const d = (data ?? {}) as { error?: string; params?: Record<string, string | number> };
    throw new ApiError(d.error ?? "server_error", res.status, d.params ?? {});
  }
  return data as T;
}

// A tiny cache so going back to a screen shows the last data at once while it refreshes.
const cache = new Map<string, unknown>();
const listeners = new Set<(prefix: string) => void>();

export function invalidate(prefix = "") {
  for (const key of [...cache.keys()]) if (key.startsWith(prefix)) cache.delete(key);
  listeners.forEach((l) => l(prefix));
}

export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | undefined>(() => (path ? (cache.get(path) as T | undefined) : undefined));
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const current = useRef(path);
  current.current = path;

  const load = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    setError(null);
    try {
      const result = await api<T>(path);
      cache.set(path, result);
      if (current.current === path) setData(result);
    } catch (err) {
      if (current.current === path) setError(err instanceof ApiError ? err : new ApiError("network", 0));
    } finally {
      if (current.current === path) setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    setData(path ? (cache.get(path) as T | undefined) : undefined);
    void load();
  }, [load]);

  useEffect(() => {
    const onInvalidate = (prefix: string) => {
      if (path && path.startsWith(prefix)) void load();
    };
    listeners.add(onInvalidate);
    return () => void listeners.delete(onInvalidate);
  }, [load, path]);

  const update = useCallback(
    (value: T) => {
      if (path) cache.set(path, value);
      setData(value);
    },
    [path],
  );

  return { data, error, loading, reload: load, setData: update };
}
