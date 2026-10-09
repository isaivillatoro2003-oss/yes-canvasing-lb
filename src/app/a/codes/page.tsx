"use client";

import { useState } from "react";
import { Copy, Eye, EyeOff, KeyRound, Plus, Share2 } from "lucide-react";
import { useApp } from "@/lib/app-context";
import { useData, useNow } from "@/lib/hooks";
import { rpc, sb, toAppError } from "@/lib/supabase";
import { dateLabel, dateTimeLabel } from "@/lib/format";
import type { AccessCode, Team } from "@/lib/types";
import { Badge, Button, Card, EmptyState, Field, ListGroup, ListRow, PageLoader, Segmented, Select, Sheet, Stepper, TextArea, useConfirm } from "@/components/ui";
import { PageHeader } from "@/components/app/shell";
import { DetailLine, unwrap } from "@/components/admin/bits";
import { ReauthGate, maskCode } from "@/components/admin/reauth-gate";

type CodeRow = AccessCode & { teams: { team_name: string } | null };
type Redemption = { used_at: string; profiles: { full_name: string; email: string } | null };
type Status = { label: string; tone: "success" | "danger" | "warning" | "default" };

function statusOf(c: AccessCode, now: number): Status {
  if (!c.active) return { label: "Revoked", tone: "danger" };
  if (c.expires_at && new Date(c.expires_at).getTime() < now) return { label: "Expired", tone: "warning" };
  if (c.current_uses >= c.max_uses) return { label: "USED", tone: "default" };
  return { label: "Active", tone: "success" };
}

export default function CodesPage() {
  return <ReauthGate title="Access Codes"><Codes /></ReauthGate>;
}

/** Codes are masked (YES-••••MZ) until the admin taps "Show". */
function Codes() {
  const { settings, toast } = useApp();
  const confirm = useConfirm();
  const now = useNow(30000);
  const codes = useData<CodeRow[]>("a:codes", async () => {
    const res = await sb().from("access_codes").select("*, teams(team_name)").order("created_at", { ascending: false }).limit(300);
    return unwrap<CodeRow[]>(res, toAppError);
  });
  const teams = useData<Team[]>("a:teams-all", async () => {
    const res = await sb().from("teams").select("*").order("team_name");
    return unwrap<Team[]>(res, toAppError);
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [created, setCreated] = useState<AccessCode | null>(null);
  const [role, setRole] = useState<"student" | "leader">("student");
  const [team, setTeam] = useState("");
  const [usage, setUsage] = useState<"single" | "multi">("single");
  const [maxUses, setMaxUses] = useState(5);
  const [days, setDays] = useState(settings.access_code_default_days);
  const [custom, setCustom] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const [selId, setSelId] = useState<string | null>(null);
  const [reveal, setReveal] = useState(false);
  const sel = (codes.data ?? []).find((c) => c.id === selId) ?? null;
  const redemptions = useData<Redemption[]>(`a:code-uses:${selId ?? "none"}`, async () => {
    if (!selId) return [];
    const res = await sb().from("access_code_redemptions").select("used_at, profiles(full_name, email)").eq("access_code_id", selId).order("used_at", { ascending: false });
    return unwrap<Redemption[]>(res, toAppError);
  }, [selId]);

  function openCreate() {
    setCreated(null); setRole("student"); setTeam(""); setUsage("single"); setMaxUses(5);
    setDays(settings.access_code_default_days); setCustom(""); setNotes(""); setCreateOpen(true);
  }

  async function create() {
    setBusy(true);
    try {
      const row = await rpc<AccessCode>("create_access_code", {
        p_role: role,
        p_team: team || null,
        p_max_uses: usage === "single" ? 1 : maxUses,
        p_expires_at: days > 0 ? new Date(Date.now() + days * 86400000).toISOString() : null,
        p_notes: notes.trim() || null,
        p_code: custom.trim() ? custom.trim().toUpperCase() : null,
      });
      setCreated(row);
      await codes.refresh();
    } catch (e) {
      toast(toAppError(e).message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function copy(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      toast("Code copied", "success");
    } catch {
      toast("Could not copy. Select the code and copy it manually.", "error");
    }
  }

  async function share(code: string) {
    try {
      await navigator.share({ title: settings.org_name, text: `Your sign-up code for ${settings.org_name}: ${code}` });
    } catch (e) {
      if ((e as Error)?.name !== "AbortError") toast("Could not share the code", "error");
    }
  }

  async function toggle(c: CodeRow) {
    const next = !c.active;
    const ok = await confirm.ask(next ? `Reactivate ${maskCode(c.code)}?` : `Revoke ${maskCode(c.code)}?`, {
      body: next ? "The code can be used again if it has uses left." : "Nobody will be able to sign up with this code anymore.",
      confirm: next ? "Reactivate" : "Revoke", tone: next ? "primary" : "danger",
    });
    if (!ok) return;
    setBusy(true);
    try {
      await rpc("set_access_code_active", { p_id: c.id, p_active: next });
      await codes.refresh();
      toast(next ? "Code reactivated" : "Code revoked", "success");
    } catch (e) {
      toast(toAppError(e).message, "error");
    } finally {
      setBusy(false);
    }
  }

  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  return (
    <>
      <PageHeader back="/a" title="Access Codes"
        action={<Button size="sm" onClick={openCreate}><Plus className="size-4" /> Create Code</Button>} />
      <div className="px-5">
        {!codes.data ? <PageLoader /> : codes.data.length === 0 ? (
          <Card><EmptyState icon={<KeyRound className="size-6" />} title="No access codes yet" body="Create a code to let a student or leader sign up."
            action={<Button onClick={openCreate}>Create Code</Button>} /></Card>
        ) : (
          <ListGroup>
            {codes.data.map((c) => {
              const s = statusOf(c, now);
              return (
                <ListRow key={c.id} onClick={() => { setReveal(false); setSelId(c.id); }}
                  title={<span className="font-semibold tracking-wider">{maskCode(c.code)}</span>}
                  subtitle={`${c.role === "leader" ? "Leader" : "Student"} · ${c.current_uses}/${c.max_uses} used · ${c.expires_at ? `expires ${dateLabel(c.expires_at)}` : "no expiry"}${c.teams ? ` · ${c.teams.team_name}` : ""}`}
                  trailing={<Badge tone={s.tone}>{s.label}</Badge>} />
              );
            })}
          </ListGroup>
        )}
      </div>

      <Sheet open={createOpen} onClose={() => setCreateOpen(false)} title={created ? "Code created" : "Create access code"}
        footer={created ? (
          <Button block size="lg" onClick={() => setCreateOpen(false)}>Done</Button>
        ) : (
          <Button block size="lg" loading={busy} onClick={create}>Create code</Button>
        )}>
        {created ? (
          <div className="space-y-5 pb-2 text-center">
            <p className="text-sm text-muted">Give this code to the {created.role}. It is shown here so you can copy it now.</p>
            <div className="select-all rounded-3xl bg-elevated px-4 py-8 text-3xl font-bold tracking-widest shadow-card">{created.code}</div>
            <div className="flex gap-2">
              <Button block variant="secondary" onClick={() => copy(created.code)}><Copy className="size-4" /> Copy</Button>
              {canShare && <Button block variant="secondary" onClick={() => share(created.code)}><Share2 className="size-4" /> Share</Button>}
            </div>
            <p className="text-sm text-muted">
              {created.max_uses === 1 ? "Single use" : `Up to ${created.max_uses} uses`} · {created.expires_at ? `expires ${dateLabel(created.expires_at)}` : "never expires"}
            </p>
          </div>
        ) : (
          <div className="space-y-4 pb-2">
            <div>
              <span className="mb-1.5 block px-1 text-sm font-medium text-muted">Role</span>
              <Segmented value={role} onChange={setRole} options={[{ value: "student", label: "Student" }, { value: "leader", label: "Leader" }]} />
            </div>
            <Select label="Team (optional)" value={team} onChange={(e) => setTeam(e.target.value)}>
              <option value="">No team</option>
              {(teams.data ?? []).filter((t) => t.active).map((t) => <option key={t.id} value={t.id}>{t.team_name}</option>)}
            </Select>
            <div>
              <span className="mb-1.5 block px-1 text-sm font-medium text-muted">Usage</span>
              <Segmented value={usage} onChange={setUsage} options={[{ value: "single", label: "Single use" }, { value: "multi", label: "Multi use" }]} />
            </div>
            {usage === "multi" && (
              <div className="flex items-center justify-between px-1">
                <span className="text-sm font-medium text-muted">Max uses</span>
                <Stepper value={maxUses} onChange={setMaxUses} min={2} label="Max uses" />
              </div>
            )}
            <div className="flex items-center justify-between px-1">
              <span className="min-w-0">
                <span className="block text-sm font-medium text-muted">Expires in (days)</span>
                <span className="block text-xs text-subtle">0 means never</span>
              </span>
              <Stepper value={days} onChange={setDays} min={0} label="Days" />
            </div>
            <Field label="Custom code (optional)" value={custom} autoCapitalize="characters" onChange={(e) => setCustom(e.target.value.toUpperCase())}
              hint="Leave empty to generate one automatically." />
            <TextArea label="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        )}
      </Sheet>

      <Sheet open={!!sel} onClose={() => setSelId(null)} title={sel ? <span className="inline-flex items-center gap-2 tracking-wider">{reveal ? sel.code : maskCode(sel.code)}
          <button type="button" aria-label={reveal ? "Hide code" : "Show code"} onClick={() => setReveal((v) => !v)}
            className="pressable grid size-8 place-items-center rounded-lg bg-sunken text-muted">{reveal ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button></span> : undefined}
        footer={sel ? (
          <Button block size="lg" variant={sel.active ? "danger" : "success"} loading={busy} onClick={() => toggle(sel)}>
            {sel.active ? "Revoke code" : "Reactivate code"}
          </Button>
        ) : undefined}>
        {sel && (
          <div className="space-y-5 pb-2">
            <ListGroup>
              <DetailLine label="Status" value={<Badge tone={statusOf(sel, now).tone}>{statusOf(sel, now).label}</Badge>} />
              <DetailLine label="Role" value={sel.role === "leader" ? "Leader" : "Student"} />
              <DetailLine label="Uses" value={`${sel.current_uses}/${sel.max_uses}`} />
              <DetailLine label="Team" value={sel.teams?.team_name ?? "—"} />
              <DetailLine label="Created" value={dateTimeLabel(sel.created_at, settings.timezone)} />
              <DetailLine label="Expires" value={sel.expires_at ? dateTimeLabel(sel.expires_at, settings.timezone) : "Never"} />
              {sel.notes && <DetailLine label="Notes" value={sel.notes} />}
            </ListGroup>
            <div className="flex gap-2">
              <Button block variant="secondary" onClick={() => copy(sel.code)}><Copy className="size-4" /> Copy</Button>
              {canShare && <Button block variant="secondary" onClick={() => share(sel.code)}><Share2 className="size-4" /> Share</Button>}
            </div>
            <div className="space-y-2">
              <h3 className="text-overline px-1 text-muted">Used by</h3>
              {!redemptions.data ? <PageLoader /> : redemptions.data.length === 0 ? (
                <p className="px-1 text-sm text-muted">Nobody has used this code yet.</p>
              ) : (
                <ListGroup>
                  {redemptions.data.map((r, i) => (
                    <ListRow key={i} title={r.profiles?.full_name ?? "Unknown"} subtitle={r.profiles?.email} trailing={dateTimeLabel(r.used_at, settings.timezone)} />
                  ))}
                </ListGroup>
              )}
            </div>
          </div>
        )}
      </Sheet>
      {confirm.node}
    </>
  );
}
