"use client";

import { useState } from "react";
import { MapPin, Plus } from "lucide-react";
import { useApp } from "@/lib/app-context";
import { useData } from "@/lib/hooks";
import { sb, toAppError } from "@/lib/supabase";
import type { Territory } from "@/lib/types";
import { Badge, Button, Card, EmptyState, Field, ListGroup, ListRow, PageLoader, Select, Sheet, TextArea, Toggle } from "@/components/ui";
import { PageHeader } from "@/components/app/shell";
import { unwrap } from "@/components/admin/bits";

const TYPES = ["Residential", "Business", "Festival/Event", "Institution", "Church Outreach", "Other"];
const EMPTY = { id: null as string | null, name: "", city: "", area: "", type: "Residential", lat: "", lng: "", active: true, notes: "" };

export default function TerritoriesPage() {
  const { toast } = useApp();
  const list = useData<Territory[]>("a:territories", async () => {
    const res = await sb().from("territories").select("*").order("territory_name");
    return unwrap<Territory[]>(res, toAppError);
  });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);

  function openNew() { setForm(EMPTY); setOpen(true); }
  function openEdit(t: Territory) {
    setForm({
      id: t.id, name: t.territory_name, city: t.city ?? "", area: t.area ?? "", type: t.territory_type,
      lat: t.latitude === null ? "" : String(t.latitude), lng: t.longitude === null ? "" : String(t.longitude), active: t.active, notes: t.notes ?? "",
    });
    setOpen(true);
  }

  async function save() {
    if (!form.name.trim()) return toast("Give the territory a name", "error");
    const lat = form.lat.trim() === "" ? null : Number(form.lat);
    const lng = form.lng.trim() === "" ? null : Number(form.lng);
    if ((lat !== null && (!Number.isFinite(lat) || Math.abs(lat) > 90)) || (lng !== null && (!Number.isFinite(lng) || Math.abs(lng) > 180))) {
      return toast("Latitude or longitude is not valid", "error");
    }
    const row = {
      territory_name: form.name.trim(), city: form.city.trim() || null, area: form.area.trim() || null, territory_type: form.type,
      latitude: lat, longitude: lng, active: form.active, notes: form.notes.trim() || null,
    };
    setBusy(true);
    try {
      const res = form.id ? await sb().from("territories").update(row).eq("id", form.id) : await sb().from("territories").insert(row);
      if (res.error) throw toAppError(res.error);
      await list.refresh();
      setOpen(false);
      toast("Territory saved", "success");
    } catch (e) {
      toast(toAppError(e).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader back="/a" title="Territories" action={<Button size="sm" onClick={openNew}><Plus className="size-4" /> Add</Button>} />
      <div className="px-5">
        {!list.data ? <PageLoader /> : list.data.length === 0 ? (
          <Card><EmptyState icon={<MapPin className="size-6" />} title="No territories yet" body="Add the areas your students work in."
            action={<Button onClick={openNew}>Add territory</Button>} /></Card>
        ) : (
          <ListGroup>
            {list.data.map((t) => (
              <ListRow key={t.id} onClick={() => openEdit(t)} title={t.territory_name}
                subtitle={[t.territory_type, t.area, t.city].filter(Boolean).join(" · ")}
                trailing={!t.active ? <Badge tone="danger">Inactive</Badge> : undefined} />
            ))}
          </ListGroup>
        )}
      </div>

      <Sheet open={open} onClose={() => setOpen(false)} title={form.id ? "Edit territory" : "New territory"}
        footer={<Button block size="lg" loading={busy} onClick={save}>Save</Button>}>
        <div className="space-y-3 pb-2">
          <Field label="Territory name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <div className="grid grid-cols-2 gap-3">
            <Field label="City" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
            <Field label="Area" value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })} />
          </div>
          <Select label="Type" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
            {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </Select>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Latitude" inputMode="decimal" value={form.lat} onChange={(e) => setForm({ ...form, lat: e.target.value })} />
            <Field label="Longitude" inputMode="decimal" value={form.lng} onChange={(e) => setForm({ ...form, lng: e.target.value })} />
          </div>
          <TextArea label="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          <Card><Toggle label="Active" checked={form.active} onChange={(v) => setForm({ ...form, active: v })} /></Card>
        </div>
      </Sheet>
    </>
  );
}
