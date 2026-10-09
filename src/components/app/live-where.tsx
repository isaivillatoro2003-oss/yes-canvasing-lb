"use client";

import { MapPin, MapPinOff } from "lucide-react";
import type { ActiveSession } from "@/lib/leader";
import { mapsUrl } from "@/lib/location";
import { timeLabel } from "@/lib/format";

function ago(iso: string | null, now: number): string {
  if (!iso) return "—";
  const m = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.floor(m / 60)}h ${m % 60}m ago`;
}

/** "Started 09:02 · Hamra, Beirut" and "Last seen 3 min ago · Gemmayze" for the live list. */
export function LiveWhere({ s, now, tz }: { s: ActiveSession; now: number; tz: string }) {
  const stale = s.last_seen_at ? now - new Date(s.last_seen_at).getTime() > 25 * 60000 : true;
  return (
    <span className="block space-y-0.5 text-sm text-muted">
      <span className="block truncate">Started {timeLabel(s.started_at, tz)}{s.start_place ? ` · ${s.start_place}` : " · location not shared"}</span>
      <span className={`flex items-center gap-1 truncate text-xs ${stale && s.status === "active" ? "text-warning" : "text-subtle"}`}>
        {s.location_status === "ok" ? <MapPin className="size-3 shrink-0" /> : <MapPinOff className="size-3 shrink-0" />}
        Last seen {ago(s.last_seen_at, now)}{s.last_place ? ` · ${s.last_place}` : ""}
        {s.last_lat != null && s.last_lng != null && (
          <a href={mapsUrl(s.last_lat, s.last_lng)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
            className="ms-1 font-semibold underline">Map</a>
        )}
      </span>
    </span>
  );
}
