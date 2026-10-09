"use client";

import { useState } from "react";
import { ScrollText } from "lucide-react";
import { useApp } from "@/lib/app-context";
import { useData } from "@/lib/hooks";
import { sb, toAppError } from "@/lib/supabase";
import { dateTimeLabel } from "@/lib/format";
import { Card, EmptyState, ListGroup, ListRow, PageLoader, Sheet } from "@/components/ui";
import { PageHeader } from "@/components/app/shell";
import { DetailLine, SearchInput, unwrap } from "@/components/admin/bits";
import { ReauthGate, maskCode } from "@/components/admin/reauth-gate";

type Entry = {
  id: string; user_id: string | null; action: string; entity_type: string | null; entity_id: string | null;
  old_value: unknown; new_value: unknown; created_at: string; device: string | null; profiles: { full_name: string } | null;
};

export default function AuditPage() {
  return <ReauthGate title="Audit Log"><Audit /></ReauthGate>;
}

function Audit() {
  const { settings } = useApp();
  const log = useData<Entry[]>("a:audit", async () => {
    const res = await sb().from("audit_log").select("*, profiles(full_name)").order("created_at", { ascending: false }).limit(200);
    return unwrap<Entry[]>(res, toAppError);
  });
  const [query, setQuery] = useState("");
  const [selId, setSelId] = useState<string | null>(null);

  const q = query.trim().toLowerCase();
  const list = (log.data ?? []).filter((e) => !q || e.action.toLowerCase().includes(q));
  const sel = (log.data ?? []).find((e) => e.id === selId) ?? null;
  // Access codes are never shown in full in the log
  const json = (v: unknown) => (v === null || v === undefined ? "—"
    : JSON.stringify(v, (k, val) => (k === "code" && typeof val === "string" ? maskCode(val) : val), 2));

  return (
    <>
      <PageHeader back="/a" title="Audit Log" subtitle="Latest 200 events" />
      <div className="space-y-4 px-5">
        <SearchInput value={query} onChange={setQuery} placeholder="Filter by action" />
        {!log.data ? <PageLoader /> : list.length === 0 ? (
          <Card><EmptyState icon={<ScrollText className="size-6" />} title="No entries" body="Nothing matches this filter." /></Card>
        ) : (
          <ListGroup>
            {list.map((e) => (
              <ListRow key={e.id} onClick={() => setSelId(e.id)} title={e.action}
                subtitle={`${e.profiles?.full_name ?? "System"} · ${dateTimeLabel(e.created_at, settings.timezone)}`}
                trailing={e.entity_type ?? undefined} />
            ))}
          </ListGroup>
        )}
      </div>

      <Sheet open={!!sel} onClose={() => setSelId(null)} title={sel?.action}>
        {sel && (
          <div className="space-y-4 pb-2">
            <ListGroup>
              <DetailLine label="Who" value={sel.profiles?.full_name ?? "System"} />
              <DetailLine label="When" value={dateTimeLabel(sel.created_at, settings.timezone)} />
              <DetailLine label="Entity" value={sel.entity_type ?? "—"} />
              {sel.device && <DetailLine label="Device" value={sel.device} />}
            </ListGroup>
            <div className="space-y-1.5">
              <h3 className="text-overline px-1 text-muted">Old value</h3>
              <pre className="overflow-x-auto rounded-2xl bg-sunken p-3 text-xs leading-relaxed">{json(sel.old_value)}</pre>
            </div>
            <div className="space-y-1.5">
              <h3 className="text-overline px-1 text-muted">New value</h3>
              <pre className="overflow-x-auto rounded-2xl bg-sunken p-3 text-xs leading-relaxed">{json(sel.new_value)}</pre>
            </div>
          </div>
        )}
      </Sheet>
    </>
  );
}
