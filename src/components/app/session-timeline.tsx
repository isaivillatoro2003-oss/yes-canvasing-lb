"use client";

import { Clock, ExternalLink, MapPin, MapPinOff } from "lucide-react";
import { useApp } from "@/lib/app-context";
import { useData } from "@/lib/hooks";
import { sb, toAppError } from "@/lib/supabase";
import type { SessionEvent } from "@/lib/leader";
import type { WorkSession } from "@/lib/types";
import { mapsUrl, placeLabel } from "@/lib/location";
import { dateLabel, minutesToLabel, timeLabel } from "@/lib/format";
import { Badge, Card, EmptyState, PageLoader } from "@/components/ui";

const LABEL: Record<string, string> = {
  start: "Started work", pause: "Paused", resume: "Resumed", stop: "Stopped work",
  ping: "Location check", transaction: "Sale recorded", closed_by_leader: "Closed by leader",
};

/** Each work session with its time- and place-stamped events, for leaders and admins. */
export function SessionTimeline({ userId }: { userId: string }) {
  const { settings } = useApp();
  const tz = settings.timezone;
  const data = useData(`timeline:${userId}`, async () => {
    const [s, e] = await Promise.all([
      sb().from("work_sessions").select("*").eq("user_id", userId).order("started_at", { ascending: false }).limit(30),
      sb().from("work_session_events").select("*").eq("user_id", userId).order("occurred_at", { ascending: true }).limit(1000),
    ]);
    if (s.error) throw toAppError(s.error);
    if (e.error) throw toAppError(e.error);
    return { sessions: s.data as WorkSession[], events: e.data as SessionEvent[] };
  }, [userId]);

  if (!data.data) return <PageLoader />;
  const { sessions, events } = data.data;
  if (!sessions.length) return <Card><EmptyState icon={<Clock className="size-6" />} title="No work sessions yet" /></Card>;

  return (
    <div className="space-y-3">
      {sessions.map((s) => {
        const ev = events.filter((x) => x.session_id === s.id);
        const pings = ev.filter((x) => x.event_type === "ping");
        const shown = ev.filter((x) => x.event_type !== "ping");
        const located = ev.filter((x) => x.location_status === "ok").length;
        return (
          <Card key={s.id} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-semibold">{dateLabel(s.work_date)}</div>
                <div className="text-sm text-muted">
                  {timeLabel(s.started_at, tz)} – {s.ended_at ? timeLabel(s.ended_at, tz) : "now"}
                  {s.paused_minutes ? ` · ${minutesToLabel(s.paused_minutes)} paused` : ""}
                </div>
              </div>
              {s.status === "active" ? <Badge tone="success">Working</Badge>
                : s.status === "paused" ? <Badge tone="warning">Paused</Badge>
                : <span className="font-semibold text-numeric">{minutesToLabel(s.duration_minutes)}</span>}
            </div>
            {ev.length > 0 && (
              <ol className="mt-3 space-y-2 border-s-2 border-line ps-4">
                {shown.map((x) => (
                  <li key={x.id} className="text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{LABEL[x.event_type] ?? x.event_type}</span>
                      <span className="text-numeric text-muted">{timeLabel(x.occurred_at, tz)}</span>
                    </div>
                    <EventPlace e={x} />
                  </li>
                ))}
              </ol>
            )}
            <div className="mt-3 text-xs text-subtle">
              {pings.length} location check{pings.length === 1 ? "" : "s"}
              {pings.length > 0 && ` · last ${timeLabel(pings[pings.length - 1].occurred_at, tz)}`}
              {ev.length > 0 && ` · location shared in ${located}/${ev.length} events`}
            </div>
          </Card>
        );
      })}
    </div>
  );
}

export function EventPlace({ e }: { e: Pick<SessionEvent, "location_status" | "latitude" | "longitude" | "city" | "neighborhood" | "accuracy_m"> }) {
  if (e.location_status !== "ok" || e.latitude == null || e.longitude == null) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-warning">
        <MapPinOff className="size-3" /> {e.location_status === "denied" ? "Location blocked by the student" : "Location not available"}
      </span>
    );
  }
  return (
    <a href={mapsUrl(e.latitude, e.longitude)} target="_blank" rel="noreferrer"
      className="inline-flex items-center gap-1 text-xs text-muted underline-offset-2 hover:underline">
      <MapPin className="size-3" /> {placeLabel(e) || `${e.latitude}, ${e.longitude}`}
      {e.accuracy_m ? ` (±${e.accuracy_m} m)` : ""} <ExternalLink className="size-3" />
    </a>
  );
}
