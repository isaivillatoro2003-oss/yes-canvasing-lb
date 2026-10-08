"use client";

import { useState } from "react";
import { Plus, UsersRound } from "lucide-react";
import { useData } from "@/lib/hooks";
import { useApp } from "@/lib/app-context";
import { rpc, sb, toAppError } from "@/lib/supabase";
import type { Profile, Team } from "@/lib/types";
import { Badge, Button, Card, EmptyState, Field, ListGroup, ListRow, PageLoader, Select, Sheet, TextArea, Toggle } from "@/components/ui";
import { PageHeader } from "@/components/app/shell";
import { unwrap } from "@/components/admin/bits";

type Data = { teams: Team[]; people: Pick<Profile, "id" | "full_name" | "role" | "team_id" | "active">[] };
const EMPTY = { id: null as string | null, name: "", leader: "", active: true, notes: "" };

export default function TeamsPage() {
  const { toast } = useApp();
  const data = useData<Data>("a:teams-page", async () => {
    const [t, p] = await Promise.all([
      sb().from("teams").select("*").order("team_name"),
      sb().from("profiles").select("id, full_name, role, team_id, active").order("full_name"),
    ]);
    return { teams: unwrap<Team[]>(t, toAppError), people: unwrap<Data["people"]>(p, toAppError) };
  });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);

  const people = data.data?.people ?? [];
  const leaders = people.filter((p) => (p.role === "leader" || p.role === "admin") && p.active);
  const nameOf = (id: string | null) => people.find((p) => p.id === id)?.full_name ?? null;

  function openNew() { setForm(EMPTY); setOpen(true); }
  function openEdit(t: Team) { setForm({ id: t.id, name: t.team_name, leader: t.leader_id ?? "", active: t.active, notes: t.notes ?? "" }); setOpen(true); }

  async function save() {
    if (!form.name.trim()) return toast("Give the team a name", "error");
    setBusy(true);
    try {
      await rpc("upsert_team", { p_id: form.id, p_name: form.name.trim(), p_leader: form.leader || null, p_active: form.active, p_notes: form.notes.trim() || null });
      await data.refresh();
      setOpen(false);
      toast("Team saved", "success");
    } catch (e) {
      toast(toAppError(e).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader back="/a" title="Teams" action={<Button size="sm" onClick={openNew}><Plus className="size-4" /> Add</Button>} />
      <div className="px-5">
        {!data.data ? <PageLoader /> : data.data.teams.length === 0 ? (
          <Card><EmptyState icon={<UsersRound className="size-6" />} title="No teams yet" body="Create a team and choose its leader."
            action={<Button onClick={openNew}>Add team</Button>} /></Card>
        ) : (
          <ListGroup>
            {data.data.teams.map((t) => {
              const members = people.filter((p) => p.team_id === t.id).length;
              return (
                <ListRow key={t.id} onClick={() => openEdit(t)} title={t.team_name}
                  subtitle={`${nameOf(t.leader_id) ?? "No leader"} · ${members} ${members === 1 ? "member" : "members"}`}
                  trailing={!t.active ? <Badge tone="danger">Inactive</Badge> : undefined} />
              );
            })}
          </ListGroup>
        )}
      </div>

      <Sheet open={open} onClose={() => setOpen(false)} title={form.id ? "Edit team" : "New team"}
        footer={<Button block size="lg" loading={busy} onClick={save}>Save</Button>}>
        <div className="space-y-3 pb-2">
          <Field label="Team name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Select label="Leader" value={form.leader} onChange={(e) => setForm({ ...form, leader: e.target.value })}>
            <option value="">No leader</option>
            {leaders.map((l) => <option key={l.id} value={l.id}>{l.full_name}{l.role === "admin" ? " (Admin)" : ""}</option>)}
          </Select>
          <TextArea label="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          <Card><Toggle label="Active" checked={form.active} onChange={(v) => setForm({ ...form, active: v })} /></Card>
        </div>
      </Sheet>
    </>
  );
}
