"use client";

import { useState } from "react";
import { CalendarPlus, MessageCircle, Phone, UserPlus, Users } from "lucide-react";
import { useApp } from "@/lib/app-context";
import { useData } from "@/lib/hooks";
import { sb, toAppError } from "@/lib/supabase";
import { dateLabel, shiftDate, todayIn } from "@/lib/format";
import type { Customer } from "@/lib/types";
import { Badge, Button, Card, EmptyState, Field, PageLoader, Select, Sheet, TextArea, Toggle } from "@/components/ui";
import { PageHeader } from "@/components/app/shell";

const EMPTY = { name: "", phone: "", whatsapp: "", email: "", city: "", neighborhood: "", notes: "", consent: false };

export default function Customers() {
  const { profile, settings, toast } = useApp();
  const uid = profile!.id;
  const customers = useData(`customers:${uid}`, async () => {
    const { data, error } = await sb().from("customers").select("*").order("created_at", { ascending: false }).limit(300);
    if (error) throw toAppError(error);
    return data as Customer[];
  }, [uid]);
  const [query, setQuery] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [follow, setFollow] = useState<Customer | null>(null);
  const [fu, setFu] = useState({ type: "Visit", due: shiftDate(todayIn(settings.timezone), 3), notes: "" });
  const [busy, setBusy] = useState(false);

  const list = (customers.data ?? []).filter((c) => {
    const q = query.trim().toLowerCase();
    return !q || [c.name, c.city, c.neighborhood, c.phone].some((v) => (v ?? "").toLowerCase().includes(q));
  });

  async function addCustomer() {
    setBusy(true);
    const row = {
      created_by: uid, name: form.name || null, city: form.city || null, neighborhood: form.neighborhood || null, notes: form.notes || null,
      consent: form.consent, consent_date: form.consent ? new Date().toISOString() : null,
      phone: form.consent ? form.phone || null : null, whatsapp: form.consent ? form.whatsapp || null : null, email: form.consent ? form.email || null : null,
    };
    const { error } = await sb().from("customers").insert(row);
    setBusy(false);
    if (error) return toast(toAppError(error).message, "error");
    setAddOpen(false); setForm(EMPTY); customers.refresh(); toast("Customer saved", "success");
  }

  async function addFollowUp() {
    if (!follow) return;
    setBusy(true);
    const { error } = await sb().from("follow_ups").insert({
      customer_id: follow.id, assigned_to: uid, created_by: uid, follow_up_type: fu.type, due_date: fu.due || null, notes: fu.notes || null,
    });
    setBusy(false);
    if (error) return toast(toAppError(error).message, "error");
    setFollow(null); toast("Follow-up scheduled", "success");
  }

  return (
    <>
      <PageHeader back title="Customers" action={<Button size="sm" onClick={() => setAddOpen(true)}><UserPlus className="size-4" /> Add</Button>} />
      <div className="space-y-4 px-5">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, city, phone"
          className="h-12 w-full rounded-2xl bg-elevated px-4 shadow-card ring-1 ring-line outline-none" />
        {!customers.data ? <PageLoader /> : list.length === 0 ? (
          <Card><EmptyState icon={<Users className="size-6" />} title="No customers yet" body="Customers you save with a transaction appear here." /></Card>
        ) : (
          <Card className="divide-y divide-line">
            {list.map((c) => (
              <div key={c.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{c.name ?? "Unnamed"}</div>
                  <div className="truncate text-sm text-muted">{[c.neighborhood, c.city].filter(Boolean).join(", ") || "—"} · {dateLabel(c.created_at)}</div>
                  {!c.consent && <Badge className="mt-1">No contact consent</Badge>}
                </div>
                {c.phone && <a href={`tel:${c.phone}`} aria-label="Call" className="pressable grid size-10 place-items-center rounded-xl bg-sunken"><Phone className="size-4" /></a>}
                {c.whatsapp && <a href={`https://wa.me/${c.whatsapp.replace(/\D/g, "")}`} target="_blank" rel="noreferrer" aria-label="WhatsApp"
                  className="pressable grid size-10 place-items-center rounded-xl bg-sunken"><MessageCircle className="size-4" /></a>}
                <button type="button" aria-label="Schedule follow-up" onClick={() => setFollow(c)}
                  className="pressable grid size-10 place-items-center rounded-xl bg-sunken"><CalendarPlus className="size-4" /></button>
              </div>
            ))}
          </Card>
        )}
      </div>

      <Sheet open={addOpen} onClose={() => setAddOpen(false)} title="New customer"
        footer={<Button block size="lg" loading={busy} onClick={addCustomer}>Save customer</Button>}>
        <div className="space-y-3 pb-2">
          <Field label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <div className="overflow-hidden rounded-2xl bg-sunken">
            <Toggle checked={form.consent} onChange={(v) => setForm({ ...form, consent: v })} label="They agreed to be contacted" description="Required to save phone, WhatsApp or email." />
          </div>
          <fieldset disabled={!form.consent} className={form.consent ? "space-y-3" : "space-y-3 opacity-50"}>
            <Field label="Phone" type="tel" inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            <Field label="WhatsApp" type="tel" inputMode="tel" value={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} />
            <Field label="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </fieldset>
          <div className="grid grid-cols-2 gap-3">
            <Field label="City" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
            <Field label="Neighborhood" value={form.neighborhood} onChange={(e) => setForm({ ...form, neighborhood: e.target.value })} />
          </div>
          <TextArea label="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </div>
      </Sheet>

      <Sheet open={!!follow} onClose={() => setFollow(null)} title={`Follow up · ${follow?.name ?? ""}`}
        footer={<Button block size="lg" loading={busy} onClick={addFollowUp}>Schedule</Button>}>
        <div className="space-y-3 pb-2">
          <Select label="Type" value={fu.type} onChange={(e) => setFu({ ...fu, type: e.target.value })}>
            {["Visit", "Call", "WhatsApp", "Bible study", "Deliver book", "Other"].map((x) => <option key={x}>{x}</option>)}
          </Select>
          <Field label="Due date" type="date" value={fu.due} onChange={(e) => setFu({ ...fu, due: e.target.value })} />
          <TextArea label="Notes" value={fu.notes} onChange={(e) => setFu({ ...fu, notes: e.target.value })} />
        </div>
      </Sheet>
    </>
  );
}
