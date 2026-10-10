"use client";

import { useState } from "react";
import { Copy, FlaskConical, Plus, Share2 } from "lucide-react";
import { useApp } from "@/lib/app-context";
import { useData, useNow } from "@/lib/hooks";
import { rpc, sb, toAppError } from "@/lib/supabase";
import { dateLabel, dateTimeLabel } from "@/lib/format";
import { Badge, Button, Card, EmptyState, Field, ListGroup, ListRow, Notice, PageLoader, Segmented, Sheet, Stepper, useConfirm } from "@/components/ui";
import { PageHeader } from "@/components/app/shell";
import { DetailLine, unwrap } from "@/components/admin/bits";
import { ReauthGate } from "@/components/admin/reauth-gate";

type DemoCode = {
  id: string; code: string; label: string | null; created_at: string; expires_at: string | null;
  max_uses: number | null; uses: number; active: boolean; last_used_at: string | null;
};

function statusOf(c: DemoCode, now: number): { label: string; tone: "success" | "danger" | "warning" | "default" } {
  if (!c.active) return { label: "Revoked", tone: "danger" };
  if (c.expires_at && new Date(c.expires_at).getTime() < now) return { label: "Expired", tone: "warning" };
  if (c.max_uses != null && c.uses >= c.max_uses) return { label: "Used up", tone: "default" };
  return { label: "Active", tone: "success" };
}

export default function DemoCodesPage() {
  return <ReauthGate title="Demo codes"><DemoCodes /></ReauthGate>;
}

/** Codes that open the demo: a simulation in the visitor's browser, never real data or an account. */
function DemoCodes() {
  const { toast } = useApp();
  const confirm = useConfirm();
  const now = useNow(30000);
  const codes = useData<DemoCode[]>("a:demo-codes", async () => {
    const res = await sb().from("demo_codes").select("*").order("created_at", { ascending: false }).limit(200);
    return unwrap<DemoCode[]>(res, toAppError);
  });
  const [createOpen, setCreateOpen] = useState(false);
  const [created, setCreated] = useState<DemoCode | null>(null);
  const [label, setLabel] = useState("");
  const [days, setDays] = useState(7);
  const [limit, setLimit] = useState<"unlimited" | "limited">("unlimited");
  const [maxUses, setMaxUses] = useState(3);
  const [busy, setBusy] = useState(false);
  const [selId, setSelId] = useState<string | null>(null);
  const sel = (codes.data ?? []).find((c) => c.id === selId) ?? null;

  const link = (code: string) => `${typeof window !== "undefined" ? window.location.origin : ""}/demo?code=${encodeURIComponent(code)}`;

  async function create() {
    setBusy(true);
    try {
      const row = await rpc<DemoCode>("create_demo_code", { p_label: label.trim() || null, p_days: days, p_max_uses: limit === "limited" ? maxUses : null });
      setCreated(row);
      await codes.refresh();
    } catch (e) {
      toast(toAppError(e).message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function copy(text: string, what: string) {
    try { await navigator.clipboard.writeText(text); toast(`${what} copied`, "success"); }
    catch { toast("Could not copy. Select it and copy manually.", "error"); }
  }

  async function share(c: DemoCode) {
    try {
      await navigator.share({ title: "YES app demo", text: `Try the YES Canvassing app demo with code ${c.code}`, url: link(c.code) });
    } catch (e) {
      if ((e as Error)?.name !== "AbortError") copy(link(c.code), "Link");
    }
  }

  async function toggle(c: DemoCode) {
    const ok = await confirm.ask(c.active ? `Revoke ${c.code}?` : `Reactivate ${c.code}?`, {
      body: c.active ? "Nobody will be able to open the demo with this code anymore." : "The code will open the demo again.",
      confirm: c.active ? "Revoke" : "Reactivate", tone: c.active ? "danger" : "primary",
    });
    if (!ok) return;
    try {
      await rpc("set_demo_code_active", { p_id: c.id, p_active: !c.active });
      await codes.refresh();
    } catch (e) {
      toast(toAppError(e).message, "error");
    }
  }

  return (
    <>
      <PageHeader back="/a/settings" title="Demo codes" subtitle="Let someone explore the app as student, leader or admin, with fictional data."
        action={<Button size="sm" onClick={() => { setCreated(null); setLabel(""); setDays(7); setLimit("unlimited"); setCreateOpen(true); }}><Plus className="size-4" /> Create</Button>} />
      <div className="space-y-4 px-5">
        <Notice>
          A demo code never creates an account and can never touch real data: the demo runs entirely inside the visitor&apos;s browser
          with example people and sales.
        </Notice>
        {!codes.data ? <PageLoader /> : codes.data.length === 0 ? (
          <Card><EmptyState icon={<FlaskConical className="size-6" />} title="No demo codes yet" body="Create one and share the link." /></Card>
        ) : (
          <ListGroup>
            {codes.data.map((c) => {
              const s = statusOf(c, now);
              return (
                <ListRow key={c.id} onClick={() => setSelId(c.id)}
                  title={<span className="font-semibold tracking-wider">{c.code}</span>}
                  subtitle={`${c.label ?? "No label"} · ${c.uses}${c.max_uses ? `/${c.max_uses}` : ""} opens · ${c.expires_at ? `until ${dateLabel(c.expires_at)}` : "no expiry"}`}
                  trailing={<Badge tone={s.tone}>{s.label}</Badge>} />
              );
            })}
          </ListGroup>
        )}
      </div>

      <Sheet open={createOpen} onClose={() => setCreateOpen(false)} title={created ? "Demo code ready" : "New demo code"}
        footer={created ? <Button block size="lg" onClick={() => setCreateOpen(false)}>Done</Button>
          : <Button block size="lg" loading={busy} onClick={create}>Create demo code</Button>}>
        {created ? (
          <div className="space-y-4 pb-2 text-center">
            <div className="select-all rounded-3xl bg-elevated px-4 py-7 text-3xl font-bold tracking-widest shadow-card">{created.code}</div>
            <div className="flex gap-2">
              <Button block variant="secondary" onClick={() => copy(link(created.code), "Link")}><Copy className="size-4" /> Copy link</Button>
              <Button block variant="secondary" onClick={() => share(created)}><Share2 className="size-4" /> Share</Button>
            </div>
            <p className="text-sm text-muted">The link opens the demo with the code filled in.</p>
          </div>
        ) : (
          <div className="space-y-4 pb-2">
            <Field label="Who is it for? (optional)" placeholder="e.g. Pastor Elie, AUB visit" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={120} />
            <div className="flex items-center justify-between px-1">
              <span><span className="block text-sm font-medium text-muted">Valid for (days)</span><span className="block text-xs text-subtle">0 means no expiry</span></span>
              <Stepper value={days} onChange={setDays} min={0} label="Days" />
            </div>
            <Segmented value={limit} onChange={setLimit} options={[{ value: "unlimited", label: "Unlimited opens" }, { value: "limited", label: "Limited" }]} />
            {limit === "limited" && (
              <div className="flex items-center justify-between px-1">
                <span className="text-sm font-medium text-muted">Max opens</span>
                <Stepper value={maxUses} onChange={setMaxUses} min={1} label="Max opens" />
              </div>
            )}
          </div>
        )}
      </Sheet>

      <Sheet open={!!sel} onClose={() => setSelId(null)} title={sel?.code}
        footer={sel ? <Button block size="lg" variant={sel.active ? "danger" : "success"} onClick={() => toggle(sel)}>{sel.active ? "Revoke" : "Reactivate"}</Button> : undefined}>
        {sel && (
          <div className="space-y-4 pb-2">
            <ListGroup>
              <DetailLine label="Status" value={<Badge tone={statusOf(sel, now).tone}>{statusOf(sel, now).label}</Badge>} />
              <DetailLine label="For" value={sel.label ?? "—"} />
              <DetailLine label="Opened" value={`${sel.uses}${sel.max_uses ? ` of ${sel.max_uses}` : ""} times`} />
              <DetailLine label="Last opened" value={sel.last_used_at ? dateTimeLabel(sel.last_used_at) : "Never"} />
              <DetailLine label="Expires" value={sel.expires_at ? dateTimeLabel(sel.expires_at) : "Never"} />
            </ListGroup>
            <div className="flex gap-2">
              <Button block variant="secondary" onClick={() => copy(link(sel.code), "Link")}><Copy className="size-4" /> Copy link</Button>
              <Button block variant="secondary" onClick={() => share(sel)}><Share2 className="size-4" /> Share</Button>
            </div>
          </div>
        )}
      </Sheet>
      {confirm.node}
    </>
  );
}
