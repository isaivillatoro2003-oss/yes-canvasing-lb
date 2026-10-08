"use client";

import { useState } from "react";
import { CalendarCheck } from "lucide-react";
import { useApp } from "@/lib/app-context";
import { useData } from "@/lib/hooks";
import { sb, toAppError } from "@/lib/supabase";
import { dateLabel, todayIn } from "@/lib/format";
import type { FollowUp } from "@/lib/types";
import { Badge, Button, Card, EmptyState, PageLoader, Segmented, Select, Sheet, TextArea } from "@/components/ui";

type Row = FollowUp & { customers: { name: string | null; phone: string | null; city: string | null } | null; profiles: { full_name: string } | null };

const STATUS: Record<FollowUp["status"], { label: string; tone: "default" | "info" | "warning" | "success" }> = {
  new: { label: "New", tone: "info" },
  contacted: { label: "Contacted", tone: "default" },
  follow_up_again: { label: "Follow Up Again", tone: "warning" },
  completed: { label: "Completed", tone: "success" },
  closed: { label: "Closed", tone: "default" },
};

/** Follow-ups visible to the caller (own, or their students' for leaders). */
export function FollowUpList({ showOwner }: { showOwner?: boolean }) {
  const { settings, toast } = useApp();
  const today = todayIn(settings.timezone);
  const [filter, setFilter] = useState<"open" | "done" | "all">("open");
  const rows = useData(`followups:${filter}`, async () => {
    let q = sb().from("follow_ups").select("*, customers(name, phone, city), profiles!follow_ups_assigned_to_fkey(full_name)")
      .order("due_date", { ascending: true, nullsFirst: false }).limit(300);
    if (filter === "open") q = q.in("status", ["new", "contacted", "follow_up_again"]);
    if (filter === "done") q = q.in("status", ["completed", "closed"]);
    const { data, error } = await q;
    if (error) throw toAppError(error);
    return data as Row[];
  }, [filter]);
  const [edit, setEdit] = useState<Row | null>(null);
  const [status, setStatus] = useState<FollowUp["status"]>("contacted");
  const [outcome, setOutcome] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!edit) return;
    setBusy(true);
    const { error } = await sb().from("follow_ups").update({ status, outcome: outcome || null, last_contact_date: today }).eq("id", edit.id);
    setBusy(false);
    if (error) return toast(toAppError(error).message, "error");
    setEdit(null); rows.refresh(); toast("Follow-up updated", "success");
  }

  return (
    <div className="space-y-4">
      <Segmented value={filter} onChange={setFilter} options={[{ value: "open", label: "Open" }, { value: "done", label: "Done" }, { value: "all", label: "All" }]} />
      {!rows.data ? <PageLoader /> : rows.data.length === 0 ? (
        <Card><EmptyState icon={<CalendarCheck className="size-6" />} title="Nothing here" body="Schedule follow-ups from the Customers list." /></Card>
      ) : (
        <Card className="divide-y divide-line">
          {rows.data.map((f) => {
            const overdue = f.due_date && f.due_date < today && ["new", "contacted", "follow_up_again"].includes(f.status);
            return (
              <button key={f.id} type="button" onClick={() => { setEdit(f); setStatus(f.status === "new" ? "contacted" : f.status); setOutcome(f.outcome ?? ""); }}
                className="pressable flex w-full items-center gap-3 px-4 py-3 text-start active:bg-sunken">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{f.customers?.name ?? "Customer"} · {f.follow_up_type}</div>
                  <div className={`truncate text-sm ${overdue ? "text-danger" : "text-muted"}`}>
                    {f.due_date ? `Due ${dateLabel(f.due_date)}` : "No due date"}{showOwner && f.profiles ? ` · ${f.profiles.full_name}` : ""}
                  </div>
                </div>
                <Badge tone={STATUS[f.status].tone}>{STATUS[f.status].label}</Badge>
              </button>
            );
          })}
        </Card>
      )}
      <Sheet open={!!edit} onClose={() => setEdit(null)} title={edit?.customers?.name ?? "Follow-up"}
        footer={<Button block size="lg" loading={busy} onClick={save}>Save</Button>}>
        <div className="space-y-3 pb-2">
          {edit?.notes && <p className="text-sm text-muted">{edit.notes}</p>}
          {edit?.customers?.phone && <a className="block text-sm font-semibold" href={`tel:${edit.customers.phone}`}>Call {edit.customers.phone}</a>}
          <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value as FollowUp["status"])}>
            {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </Select>
          <TextArea label="Outcome" value={outcome} onChange={(e) => setOutcome(e.target.value)} />
        </div>
      </Sheet>
    </div>
  );
}
