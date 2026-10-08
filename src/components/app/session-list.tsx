"use client";

import { Clock } from "lucide-react";
import { dateLabel, minutesToLabel, timeLabel } from "@/lib/format";
import type { WorkSession } from "@/lib/types";
import { Badge, Card, EmptyState } from "@/components/ui";

export function SessionList({ sessions, tz }: { sessions: WorkSession[]; tz: string }) {
  if (!sessions.length) return <Card><EmptyState icon={<Clock className="size-6" />} title="No work sessions yet" /></Card>;
  return (
    <Card className="divide-y divide-line">
      {sessions.map((s) => (
        <div key={s.id} className="flex items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="font-medium">{dateLabel(s.work_date)}</div>
            <div className="text-sm text-muted">{timeLabel(s.started_at, tz)} – {s.ended_at ? timeLabel(s.ended_at, tz) : "now"} · {s.presentations} presentations</div>
          </div>
          {s.status === "active" ? <Badge tone="success"><span className="live-dot size-1.5 rounded-full bg-success" /> Active</Badge>
            : <span className="font-semibold text-numeric">{minutesToLabel(s.duration_minutes)}</span>}
          {s.status === "auto_closed" && <Badge tone="warning">Closed by leader</Badge>}
        </div>
      ))}
    </Card>
  );
}
