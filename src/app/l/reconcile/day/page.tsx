"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, Check, Lock, PackageMinus, ShieldAlert, Square } from "lucide-react";
import { useApp } from "@/lib/app-context";
import { useData } from "@/lib/hooks";
import { rpc, toAppError } from "@/lib/supabase";
import { cn, dateLabel, minutesToLabel, money } from "@/lib/format";
import type { DaySummary, Reconciliation } from "@/lib/types";
import { Badge, Button, Card, Field, MoneyInput, Notice, PageLoader, Section, Sheet, Stepper, TextArea, useConfirm } from "@/components/ui";
import { PageHeader } from "@/components/app/shell";
import { ReconBadge } from "@/components/app/recon-badge";

function Row({ k, v, strong, tone }: { k: string; v: React.ReactNode; strong?: boolean; tone?: "success" | "danger" | "warning" }) {
  return (
    <div className="flex items-center justify-between px-5 py-3">
      <span className="text-muted">{k}</span>
      <span className={cn("text-numeric", strong ? "text-lg font-bold" : "font-semibold",
        tone === "success" && "text-success", tone === "danger" && "text-danger", tone === "warning" && "text-warning")}>{v}</span>
    </div>
  );
}

function CloseDay() {
  const params = useSearchParams();
  const studentId = params.get("student") ?? "";
  const date = params.get("date") ?? "";
  const { profile, settings, toast } = useApp();
  const confirm = useConfirm();
  const cur = settings.currency;

  const day = useData(studentId && date ? `day:${studentId}:${date}` : null,
    () => rpc<DaySummary>("day_summary", { p_student: studentId, p_date: date }), [studentId, date]);

  // Submitted amounts default to what the student recorded; the leader corrects them to what was actually handed over.
  const [cash, setCash] = useState<string | null>(null);
  const [whish, setWhish] = useState<string | null>(null);
  const [other, setOther] = useState<string | null>(null);
  const [counted, setCounted] = useState<string | null>(null);
  const [notes, setNotes] = useState<string | null>(null);
  const [busy, setBusy] = useState<"" | "close" | "approve" | "stop" | "return">("");
  const [error, setError] = useState<string | null>(null);
  const [returnOpen, setReturnOpen] = useState(false);
  const [returnQty, setReturnQty] = useState<Record<string, number>>({});

  const d = day.data;
  if (!d) return day.error ? <><PageHeader back title="Close Day" /><div className="px-5"><Notice tone="danger">{day.error}</Notice></div></> : <PageLoader />;

  const rec = d.reconciliation;
  const frozen = rec?.status === "approved" || rec?.status === "locked";
  const v = (s: string | null, fallback: number) => (s === null ? String(fallback || "") : s);
  const cashV = v(cash, rec?.cash_submitted ?? d.payments.cash);
  const whishV = v(whish, rec?.whish_submitted ?? d.payments.whish);
  const otherV = v(other, rec?.other_submitted ?? d.payments.other);
  const countedV = counted ?? (rec?.books_counted != null ? String(rec.books_counted) : "");
  const notesV = notes ?? rec?.notes ?? "";
  const submitted = Number(cashV || 0) + Number(whishV || 0) + Number(otherV || 0);
  const expected = Number(d.finance.expected);
  const diff = Math.round((submitted - expected) * 100) / 100;
  const bookDiff = countedV === "" ? 0 : Number(countedV) - d.books.remaining;
  const balanced = diff === 0 && bookDiff === 0;
  const isAdmin = profile?.role === "admin";

  async function stopSession() {
    const ok = await confirm.ask("Stop the active session?", { body: "The student's work time ends now. This is recorded in the audit log.", confirm: "Stop session", tone: "danger" });
    if (!ok || !d?.active_session_id) return;
    setBusy("stop");
    try {
      await rpc("staff_stop_session", { p_session: d.active_session_id, p_notes: "Stopped at close of day" });
      toast("Session stopped", "success");
      await day.refresh();
    } catch (e) { toast(toAppError(e).message, "error"); } finally { setBusy(""); }
  }

  async function receiveBooks() {
    const items = Object.entries(returnQty).filter(([, n]) => n > 0).map(([book_id, quantity]) => ({ book_id, quantity }));
    if (!items.length) return;
    setBusy("return");
    try {
      await rpc("return_inventory", { p_student: studentId, p_items: items, p_notes: `Returned at close of day ${date}` });
      toast("Books received", "success");
      setReturnOpen(false); setReturnQty({});
      await day.refresh();
    } catch (e) { toast(toAppError(e).message, "error"); } finally { setBusy(""); }
  }

  async function closeDay(override = false) {
    setError(null);
    if (override) {
      const ok = await confirm.ask("Override and close?", { body: "The student is still working. As admin you can close anyway — the override is written to the audit log.", confirm: "Override", tone: "danger" });
      if (!ok) return;
    }
    setBusy("close");
    try {
      await rpc<Reconciliation>("close_day", {
        p_student: studentId, p_date: date, p_cash: Number(cashV || 0), p_whish: Number(whishV || 0), p_other: Number(otherV || 0),
        p_books_counted: countedV === "" ? null : Number(countedV), p_notes: notesV || null, p_override: override,
      });
      toast("Day closed. Review and approve.", "success");
      await day.refresh();
    } catch (e) { setError(toAppError(e).message); } finally { setBusy(""); }
  }

  async function approve() {
    setError(null);
    setBusy("approve");
    try {
      // Save the latest numbers first, then approve — one tap for the leader.
      // (While a session is still active only an admin may re-save, as an override.)
      if (!d!.has_active_session || isAdmin) {
        await rpc<Reconciliation>("close_day", {
          p_student: studentId, p_date: date, p_cash: Number(cashV || 0), p_whish: Number(whishV || 0), p_other: Number(otherV || 0),
          p_books_counted: countedV === "" ? null : Number(countedV), p_notes: notesV || null, p_override: d!.has_active_session && isAdmin,
        });
      }
      const fresh = await rpc<DaySummary>("day_summary", { p_student: studentId, p_date: date });
      await rpc<Reconciliation>("approve_day", { p_id: fresh.reconciliation!.id, p_notes: notesV || null });
      toast("Day approved", "success");
      await day.refresh();
    } catch (e) { setError(toAppError(e).message); } finally { setBusy(""); }
  }

  return (
    <>
      <PageHeader back title="Close Day" subtitle={`${d.student.full_name} · ${dateLabel(date)}`}
        action={rec ? <ReconBadge status={rec.status} /> : <Badge>Not closed</Badge>} />
      <div className="space-y-6 px-5 pb-44">
        {d.has_active_session && (
          <Card className="space-y-3 border-2 border-warning p-4">
            <div className="flex gap-3">
              <AlertTriangle className="mt-0.5 size-5 shrink-0 text-warning" />
              <p className="text-sm font-medium">This student still has an active work session. Stop the session before closing the day.</p>
            </div>
            {!frozen && (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" className="text-danger" loading={busy === "stop"} onClick={stopSession}>
                  <Square className="size-3.5 fill-current" /> Stop session
                </Button>
                {isAdmin && <Button size="sm" variant="secondary" onClick={() => closeDay(true)}><ShieldAlert className="size-4" /> Admin override</Button>}
              </div>
            )}
          </Card>
        )}

        <Section title="Student">
          <Card className="divide-y divide-line">
            <Row k="Student" v={d.student.full_name} />
            <Row k="Date" v={dateLabel(date)} />
            <Row k="Work Hours" v={minutesToLabel(d.work_minutes)} />
            <Row k="Presentations" v={d.presentations} />
            <Row k="Transactions" v={d.transactions} />
          </Card>
        </Section>

        <Section title="Books" action={!frozen && d.books.remaining > 0 && (
          <button type="button" onClick={() => setReturnOpen(true)} className="pressable inline-flex items-center gap-1 text-sm font-semibold">
            <PackageMinus className="size-4" /> Receive returned books
          </button>)}>
          <Card className="divide-y divide-line">
            <Row k="Assigned today" v={d.books.assigned} />
            <Row k="Distributed" v={d.books.distributed} />
            <Row k="Returned today" v={d.books.returned} />
            <Row k="Remaining with student" v={d.books.remaining} strong />
          </Card>
          {!frozen && (
            <Field label="Books counted with the student (optional)" inputMode="numeric" placeholder={`System says ${d.books.remaining}`}
              value={countedV} onChange={(e) => setCounted(e.target.value.replace(/\D/g, ""))}
              hint={countedV === "" ? "Leave empty to skip the physical count." : bookDiff === 0 ? "Matches the system." : `Book difference: ${bookDiff > 0 ? "+" : ""}${bookDiff}`} />
          )}
        </Section>

        <Section title="Finance">
          <Card className="divide-y divide-line">
            <Row k="Book Value" v={money(d.finance.book_value, cur)} />
            <Row k="Donations" v={money(d.finance.donations, cur)} />
            <Row k="Expected Total" v={money(expected, cur)} strong />
          </Card>
        </Section>

        <Section title="Payments">
          <p className="px-1 text-sm text-muted">Recorded by the student: Cash {money(d.payments.cash, cur)} · Whish {money(d.payments.whish, cur)} · Other {money(d.payments.other, cur)}</p>
          {frozen ? (
            <Card className="divide-y divide-line">
              <Row k="Cash" v={money(rec!.cash_submitted, cur)} />
              <Row k="Whish Money" v={money(rec!.whish_submitted, cur)} />
              <Row k="Other" v={money(rec!.other_submitted, cur)} />
              <Row k="Total Submitted" v={money(rec!.total_submitted, cur)} strong />
            </Card>
          ) : (
            <Card className="space-y-3 p-4">
              <MoneyInput label="Cash handed in" value={cashV} onChange={setCash} />
              <MoneyInput label="Whish Money" value={whishV} onChange={setWhish} />
              <MoneyInput label="Other" value={otherV} onChange={setOther} />
            </Card>
          )}
        </Section>

        <Section title="Difference">
          <Card className={cn("p-5 text-center", balanced ? "bg-success-bg" : "bg-warning-bg")}>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><div className="text-muted">Expected</div><div className="text-xl font-bold text-numeric">{money(expected, cur)}</div></div>
              <div><div className="text-muted">Submitted</div><div className="text-xl font-bold text-numeric">{money(frozen ? rec!.total_submitted : submitted, cur)}</div></div>
            </div>
            <div className={cn("mt-4 inline-flex items-center gap-2 text-lg font-bold", balanced ? "text-success" : "text-warning")}>
              {balanced ? <><Check className="size-5" /> BALANCED</> : <>Difference: {diff > 0 ? "+" : diff < 0 ? "−" : ""}{money(Math.abs(diff), cur)}{bookDiff !== 0 && ` · Books ${bookDiff > 0 ? "+" : ""}${bookDiff}`}</>}
            </div>
          </Card>
          {frozen ? (
            rec?.notes && <Card className="p-4 text-sm"><span className="font-semibold">Notes: </span>{rec.notes}</Card>
          ) : (
            <TextArea label={balanced ? "Notes (optional)" : "Discrepancy notes (required to approve)"} value={notesV} onChange={(e) => setNotes(e.target.value)} />
          )}
        </Section>

        {frozen && (
          <Notice tone="success">
            <span className="inline-flex items-center gap-2"><Lock className="size-4" /> {rec!.status === "locked" ? "Locked by admin." : "Approved."} This day can no longer be changed.</span>
          </Notice>
        )}
      </div>

      {!frozen && (
        <div className="material fixed inset-x-0 z-30 border-t border-line" style={{ bottom: "calc(4rem + env(safe-area-inset-bottom, 0px))" }}>
          <div className="mx-auto max-w-lg space-y-2 px-5 py-3">
            {error && <Notice tone="danger">{error}</Notice>}
            <div className="flex gap-2">
              <Button variant="secondary" size="lg" className="flex-1" loading={busy === "close"} disabled={d.has_active_session || !!busy} onClick={() => closeDay(false)}>
                {rec ? "Update" : "Close Day"}
              </Button>
              <Button size="lg" className="flex-[1.4]" loading={busy === "approve"}
                disabled={(d.has_active_session && !rec?.override_used) || !!busy || (!balanced && !notesV.trim())}
                onClick={approve}>
                <Check className="size-5" /> APPROVE DAY
              </Button>
            </div>
          </div>
        </div>
      )}

      <Sheet open={returnOpen} onClose={() => setReturnOpen(false)} title="Receive returned books"
        footer={<Button block size="lg" loading={busy === "return"} onClick={receiveBooks}
          disabled={!Object.values(returnQty).some((n) => n > 0)}>Receive {Object.values(returnQty).reduce((s, n) => s + n, 0) || ""} books</Button>}>
        <div className="space-y-2 pb-2">
          <Button size="sm" variant="secondary" onClick={() => setReturnQty(Object.fromEntries(d.inventory.map((i) => [i.book_id, i.remaining])))}>Return everything</Button>
          <Card className="divide-y divide-line">
            {d.inventory.map((i) => (
              <div key={i.book_id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1"><Badge tone="navy">{i.code}</Badge><div className="truncate text-xs text-subtle">Holds {i.remaining}</div></div>
                <Stepper value={returnQty[i.book_id] ?? 0} min={0} max={i.remaining} label={i.code} onChange={(n) => setReturnQty((q) => ({ ...q, [i.book_id]: n }))} />
              </div>
            ))}
          </Card>
        </div>
      </Sheet>
      {confirm.node}
    </>
  );
}

export default function CloseDayPage() {
  return <Suspense fallback={<PageLoader />}><CloseDay /></Suspense>;
}
