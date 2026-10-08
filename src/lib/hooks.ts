"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cacheGet, cacheSet } from "./sync";
import { toAppError } from "./supabase";

/**
 * Loads data and keeps a copy on the phone. When the network fails, the last
 * copy is shown (stale: true) instead of an empty screen.
 * A null key disables loading (e.g. a tab that isn't open yet).
 */
export function useData<T>(key: string | null, load: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [stale, setStale] = useState(false);
  const loadRef = useRef(load);
  useEffect(() => { loadRef.current = load; });
  const depKey = JSON.stringify(deps);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const v = await loadRef.current();
      setData(v);
      setError(null);
      setStale(false);
      if (key) cacheSet(key, v);
    } catch (e) {
      const err = toAppError(e);
      if (key) {
        const cached = await cacheGet<T>(key);
        if (cached !== undefined) { setData(cached); setStale(true); }
      }
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [key]);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (key) {
        const cached = await cacheGet<T>(key);
        if (alive && cached !== undefined) setData((d) => (d === undefined ? cached : d));
      }
      if (alive && key !== null) refresh();
    })();
    return () => { alive = false; };
  }, [key, refresh, depKey]);

  return { data, error, loading, stale, refresh, setData };
}

/** Re-renders every `ms` — for live timers. */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}
