"use client";

import { useMemo, useState } from "react";
import { Users } from "lucide-react";
import { useApp } from "@/lib/app-context";
import { useData } from "@/lib/hooks";
import { rpc, sb, toAppError } from "@/lib/supabase";
import { dateTimeLabel, initials } from "@/lib/format";
import type { Profile, Role, Team } from "@/lib/types";
import { Badge, Button, Card, EmptyState, Field, ListGroup, ListRow, PageLoader, Section, Segmented, Select, Sheet, useConfirm } from "@/components/ui";
import { PageHeader } from "@/components/app/shell";
import { DetailLine, SearchInput, unwrap } from "@/components/admin/bits";

type UserRow = Profile & { teams: { team_name: string } | null };
type Filter = "all" | "student" | "leader" | "admin" | "inactive";
type Mode = "view" | "edit" | "team";

const ROLE_TONE = { student: "default", leader: "info", admin: "navy" } as const;
const ROLE_LABEL: Record<Role, string> = { student: "Student", leader: "Leader", admin: "Admin" };

export default function UsersPage() {
  const { profile, settings, toast } = useApp();
  const confirm = useConfirm();
  const users = useData<UserRow[]>("a:users", async () => {
    const res = await sb().from("profiles").select("*, teams!profiles_team_fk(team_name)").order("full_name");
    return unwrap<UserRow[]>(res, toAppError);
  });
  const teams = useData<Team[]>("a:teams-all", async () => {
    const res = await sb().from("teams").select("*").order("team_name");
    return unwrap<Team[]>(res, toAppError);
  });
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [selId, setSelId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("view");
  const [form, setForm] = useState({ name: "", phone: "" });
  const [teamId, setTeamId] = useState("");
  const [busy, setBusy] = useState(false);

  const all = useMemo(() => users.data ?? [], [users.data]);
  const sel = all.find((u) => u.id === selId) ?? null;
  const leaderName = (id: string | null) => (id ? all.find((u) => u.id === id)?.full_name ?? "—" : "—");

  const list = all.filter((u) => {
    const q = query.trim().toLowerCase();
    if (q && !u.full_name.toLowerCase().includes(q) && !u.email.toLowerCase().includes(q)) return false;
    if (filter === "inactive") return !u.active;
    if (filter === "all") return true;
    return u.role === filter;
  });

  function open(u: UserRow) { setSelId(u.id); setMode("view"); }
  function close() { setSelId(null); setMode("view"); }

  async function run(fn: () => Promise<unknown>, okMsg: string, then?: () => void) {
    setBusy(true);
    try {
      await fn();
      await users.refresh();
      toast(okMsg, "success");
      then?.();
    } catch (e) {
      toast(toAppError(e).message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function changeRole(role: Role, title: string, body: string) {
    if (!sel) return;
    if (!(await confirm.ask(title, { body, confirm: "Change role", tone: "danger" }))) return;
    await run(() => rpc("admin_set_role", { p_user: sel.id, p_role: role }), "Role updated");
  }

  async function toggleActive() {
    if (!sel) return;
    const next = !sel.active;
    const ok = await confirm.ask(next ? `Reactivate ${sel.full_name}?` : `Deactivate ${sel.full_name}?`, {
      body: next ? "They will be able to sign in again." : "They will no longer be able to work. Their records are kept.",
      confirm: next ? "Reactivate" : "Deactivate", tone: next ? "primary" : "danger",
    });
    if (!ok) return;
    await run(() => rpc("admin_set_active", { p_user: sel.id, p_active: next }), next ? "User reactivated" : "User deactivated");
  }

  async function sendReset() {
    if (!sel) return;
    await run(async () => {
      const { error } = await sb().auth.resetPasswordForEmail(sel.email, { redirectTo: `${location.origin}/reset-password` });
      if (error) throw toAppError(error);
    }, `Reset email sent to ${sel.email}`);
  }

  const isSelf = sel?.id === profile?.id;

  return (
    <>
      <PageHeader title="Users" subtitle={`${all.length} people`} />
      <div className="space-y-4 px-5">
        <SearchInput value={query} onChange={setQuery} placeholder="Search name or email" />
        <Segmented<Filter> value={filter} onChange={setFilter} options={[
          { value: "all", label: "All" }, { value: "student", label: "Students" }, { value: "leader", label: "Leaders" },
          { value: "admin", label: "Admins" }, { value: "inactive", label: "Inactive" },
        ]} />
        {!users.data ? <PageLoader /> : list.length === 0 ? (
          <Card><EmptyState icon={<Users className="size-6" />} title="No users found" body="Try a different search or filter." /></Card>
        ) : (
          <ListGroup>
            {list.map((u) => (
              <ListRow key={u.id} onClick={() => open(u)}
                icon={<span className="text-xs font-bold">{initials(u.full_name)}</span>}
                title={u.full_name}
                subtitle={`${u.email}${u.teams ? ` · ${u.teams.team_name}` : ""}`}
                trailing={<span className="flex items-center gap-1.5">
                  {!u.active && <Badge tone="danger">Inactive</Badge>}
                  <Badge tone={ROLE_TONE[u.role]}>{ROLE_LABEL[u.role]}</Badge>
                </span>} />
            ))}
          </ListGroup>
        )}
      </div>

      <Sheet open={!!sel} onClose={close}
        title={mode === "edit" ? "Edit details" : mode === "team" ? "Assign team" : sel?.full_name}
        footer={mode === "edit" ? (
          <Button block size="lg" loading={busy} disabled={!form.name.trim()}
            onClick={() => sel && run(() => rpc("admin_update_profile", { p_user: sel.id, p_full_name: form.name.trim(), p_phone: form.phone.trim() || null }), "Details saved", () => setMode("view"))}>
            Save
          </Button>
        ) : mode === "team" ? (
          <Button block size="lg" loading={busy}
            onClick={() => sel && run(() => rpc("admin_assign_team", { p_user: sel.id, p_team: teamId || null, p_leader: null }), "Team updated", () => setMode("view"))}>
            Save
          </Button>
        ) : undefined}>
        {sel && mode === "view" && (
          <div className="space-y-5 pb-2">
            <ListGroup>
              <DetailLine label="Email" value={sel.email} />
              <DetailLine label="Phone" value={sel.phone ?? "—"} />
              <DetailLine label="Role" value={ROLE_LABEL[sel.role]} />
              <DetailLine label="Status" value={sel.active ? "Active" : "Inactive"} />
              <DetailLine label="Team" value={sel.teams?.team_name ?? "—"} />
              <DetailLine label="Leader" value={leaderName(sel.leader_id)} />
              <DetailLine label="Last login" value={dateTimeLabel(sel.last_login, settings.timezone)} />
              <DetailLine label="Created" value={dateTimeLabel(sel.created_at, settings.timezone)} />
            </ListGroup>
            <Section title="Actions">
              <ListGroup>
                <ListRow title="Edit name and phone" onClick={() => { setForm({ name: sel.full_name, phone: sel.phone ?? "" }); setMode("edit"); }} />
                <ListRow title="Assign team" subtitle="The leader of the team is set automatically" onClick={() => { setTeamId(sel.team_id ?? ""); setMode("team"); }} />
                <ListRow title="Send password reset email" onClick={sendReset} />
                <ListRow href={`/l/student?id=${sel.id}`} title="View activity" />
              </ListGroup>
            </Section>
            {!isSelf && (
              <Section title="Role and access">
                <div className="space-y-2">
                  {sel.role === "student" && (
                    <Button block variant="secondary" disabled={busy}
                      onClick={() => changeRole("leader", `Promote ${sel.full_name} to Leader?`, "They will be able to manage students and reconcile days.")}>
                      Promote to Leader
                    </Button>
                  )}
                  {sel.role === "leader" && (
                    <Button block variant="secondary" disabled={busy}
                      onClick={() => changeRole("student", `Remove Leader role from ${sel.full_name}?`, "They will become a regular student.")}>
                      Remove Leader Role
                    </Button>
                  )}
                  {sel.role !== "admin" && (
                    <Button block variant="secondary" disabled={busy}
                      onClick={() => changeRole("admin", `Make ${sel.full_name} an Admin?`, "Admins can see and change everything in the app.")}>
                      Make Admin
                    </Button>
                  )}
                  {sel.role === "admin" && (
                    <Button block variant="secondary" disabled={busy}
                      onClick={() => changeRole("leader", `Remove Admin access from ${sel.full_name}?`, "They will become a Leader.")}>
                      Remove Admin Role
                    </Button>
                  )}
                  <Button block variant={sel.active ? "danger" : "success"} loading={busy} onClick={toggleActive}>
                    {sel.active ? "Deactivate user" : "Reactivate user"}
                  </Button>
                </div>
              </Section>
            )}
            {isSelf && <p className="px-1 text-sm text-muted">This is your own account, so role and access changes are disabled.</p>}
          </div>
        )}
        {sel && mode === "edit" && (
          <div className="space-y-3 pb-2">
            <Field label="Full name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <Field label="Phone" inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            <Button block variant="ghost" onClick={() => setMode("view")}>Cancel</Button>
          </div>
        )}
        {sel && mode === "team" && (
          <div className="space-y-3 pb-2">
            <Select label="Team" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
              <option value="">No team</option>
              {(teams.data ?? []).filter((t) => t.active || t.id === sel.team_id).map((t) => <option key={t.id} value={t.id}>{t.team_name}</option>)}
            </Select>
            <p className="px-1 text-sm text-muted">The user is placed under the leader of the chosen team.</p>
            <Button block variant="ghost" onClick={() => setMode("view")}>Cancel</Button>
          </div>
        )}
      </Sheet>
      {confirm.node}
    </>
  );
}
