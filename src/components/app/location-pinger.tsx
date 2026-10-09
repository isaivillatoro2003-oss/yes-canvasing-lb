"use client";

import { useEffect } from "react";
import { useApp } from "@/lib/app-context";
import { getActiveSession } from "@/lib/queries";
import { rpc } from "@/lib/supabase";
import { currentLocation, locationExplained } from "@/lib/location";

const EVERY_MS = 10 * 60 * 1000;

/**
 * While a work session is active and the app is open, sends the position every
 * 10 minutes. Browsers can't read location in the background, so if the app is
 * closed the leader simply sees "last seen X min ago". Nothing is sent when the
 * user isn't working, is paused, or hasn't been told about location yet.
 */
export function LocationPinger() {
  const { profile, online } = useApp();
  const uid = profile?.id;

  useEffect(() => {
    if (!uid) return;
    let running = false;
    async function ping() {
      if (running || document.visibilityState !== "visible" || !navigator.onLine || !locationExplained()) return;
      running = true;
      try {
        const s = await getActiveSession(uid!);
        if (s?.status !== "active") return;
        const loc = await currentLocation(15000);
        await rpc("log_location", { p_loc: loc });
      } catch {
        /* a missed ping is not an error worth showing */
      } finally {
        running = false;
      }
    }
    const first = setTimeout(ping, 60 * 1000);
    const id = setInterval(ping, EVERY_MS);
    const onVisible = () => document.visibilityState === "visible" && ping();
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearTimeout(first); clearInterval(id); document.removeEventListener("visibilitychange", onVisible); };
  }, [uid, online]);

  return null;
}
