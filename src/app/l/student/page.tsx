"use client";

import Link from "next/link";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { BookOpen, ClipboardCheck, Mail, Phone, Square } from "lucide-react";
import { useApp } from "@/lib/app-context";
import { useData, useNow } from "@/lib/hooks";
import { getInventory, getReport } from "@/lib/queries";
import { rpc, sb, toAppError } from "@/lib/supabase";
import { balanceOf, dateLabel, elapsedLabel, money, timeLabel, todayIn } from "@/lib/format";
import type { Customer, Profile, Reconciliation, Transaction, WorkSession } from "@/lib/types";
import { Badge, Button, Card, EmptyState, LinkButton, PageLoader, Section, Segmented, useConfirm } from "@/components/ui";
import { PageHeader } from "@/components/app/shell";
import { RangePicker, ReportBody, type Range } from "@/components/app/report-view";
import { ReconBadge } from "@/components/app/recon-badge";
import { SessionList } from "@/components/app/session-list";

type Tab = "overview" | "inventory" | "transactions" | "sessions" | "customers" | "days";

async function select<T>(p: PromiseLike<{ data: unknown; error: unknown }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw toAppError(error);
  return data as T;
}

function StudentView() {
  const id = useSearchParams().get("id") ?? "";
  const { settings, toast } = useApp();
  const today = todayIn(settings.timezone);
  const [tab, setTab] = useState<Tab>("overview");
  const [range, setRange] = useState<Range>({ from: today, to: today });
  const confirm = useConfirm();
  const now = useNow(1000);

  const student = useData(id ? `profile:${id}` : null, () =>
    select<Profile | null>(sb().from("profiles").select("*").eq("id", id).maybeSingle()), [id]);
  const session = useData(id ? `session:${id}` : null, () =>
    select<WorkSession | null>(sb().from("work_sessions").select("*").eq("user_id", id).eq("status", "active").limit(1).maybeSingle()), [id]);
  const report = useData(id ? `report:${id}:${range.from}:${range.to}` : null, () => getReport({ ...range, user: id }), [id, range.from, range.to]);
  const inventory = useData(tab === "inventory" ? `inventory:${id}` : null, () => getInventory(id), [id, tab]);
  const txs = useData(tab === "transactions" ? `tx:${id}:${range.from}:${range.to}` : null, () => {
    let q = sb().from("transactions").select("*").eq("user_id", id).order("transaction_datetime", { ascending: false }).limit(200);
    if (range.from) q = q.gte("work_date", range.from);
    if (range.to) q = q.lte("work_date", range.to);
    return select<Transaction[]>(q);
  }, [id, tab, range.from, range.to]);
  const sessions = useData(tab === "sessions" ? `sessions:${id}` : null, () =>
    select<WorkSession[]>(sb().from("work_sessions").select("*").eq("user_id", id).order("started_at", { ascending: false }).limit(60)), [id, tab]);
  const customers = useData(tab === "customers" ? `customers:${id}` : null, () =>
    select<Customer[]>(sb().from("customers").select("*").eq("created_by", id).order("created_at", { ascending: false }).limit(200)), [id, tab]);
  const days = useData(tab === "days" ? `recons:${id}` : null, () =>
    select<Reconciliation[]>(sb().from("daily_reconciliations").select("*").eq("student_id", id).order("work_date", { ascending: false }).limit(60)), [id, tab]);

  const s = student.data;
  if (student.loading && !s) return <PageLoader />;
  if (!s) return <><PageHeader back title="Student" /><div className="px-5"><Card><EmptyState title="Not found" body="This student isn't on your team." /></Card></div></>;
  const active = session.data;

  async function stopSession() {
    if (!active) return;
    const ok = await confirm.ask(`Stop ${s!.full_name.split(" ")[0]}'s session?`, {
      body: "Use this when a student forgot to tap STOP WORK. It's recorded in the audit log.", confirm: "Stop session", tone: "danger",
    });
    if (!ok) return;
    try {
      await rpc("staff_stop_session", { p_session: active.id, p_notes: "Stopped by leader" });
      toast("Session stopped", "success");
      session.refresh(); report.refresh();
    } catch (e) { toast(toAppError(e).message, "error"); }
  }

  return (
    <>
      <PageHeader back title={s.full_name} subtitle={<span className="inline-flex flex-wrap items-center gap-2">
        {active ? <Badge tone="success"><span className="live-dot size-1.5 rounded-full bg-success" /> Working · {elapsedLabel(active.started_at, now)}</Badge> : <Badge>Not working</Badge>}
        {!s.active && <Badge tone="danger">Inactive</Badge>}
      </span>} />
      <div className="space-y-5 px-5">
        <div className="flex gap-2">
          {s.phone && <a href={`tel:${s.phone}`} className="pressable inline-flex h-10 items-center gap-2 rounded-xl bg-elevated px-3 text-sm font-semibold shadow-card"><Phone className="size-4" /> Call</a>}
          <a href={`mailto:${s.email}`} className="pressable inline-flex h-10 items-center gap-2 rounded-xl bg-elevated px-3 text-sm font-semibold shadow-card"><Mail className="size-4" /> Email</a>
          <Link href={`/l/inventory?student=${s.id}`} className="pressable inline-flex h-10 items-center gap-2 rounded-xl bg-elevated px-3 text-sm font-semibold shadow-card"><BookOpen className="size-4" /> Books</Link>
          <Link href={`/l/reconcile/day?student=${s.id}&date=${today}`} className="pressable inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-3 text-sm font-semibold text-primary-fg shadow-card"><ClipboardCheck className="size-4" /> Close day</Link>
        </div>

        {active && (
          <Card className="flex items-center gap-3 p-4">
            <div className="flex-1 text-sm">
              <div className="font-semibold">Started {timeLabel(active.started_at, settings.timezone)}</div>
              <div className="text-muted">{active.presentations} presentations so far</div>
            </div>
            <Button variant="secondary" size="sm" className="text-danger" onClick={stopSession}><Square className="size-3.5 fill-current" /> Stop</Button>
          </Card>
        )}

        <Segmented value={tab} onChange={setTab} options={[
          { value: "overview", label: "Report" }, { value: "inventory", label: "Books" }, { value: "transactions", label: "Sales" },
          { value: "sessions", label: "Hours" }, { value: "customers", label: "Customers" }, { value: "days", label: "Days" },
        ]} />

        {(tab === "overview" || tab === "transactions") && <RangePicker tz={settings.timezone} value={range} onChange={setRange} />}

        {tab === "overview" && (report.data ? <ReportBody r={report.data} currency={settings.currency} /> : <PageLoader />)}

        {tab === "inventory" && (!inventory.data ? <PageLoader /> : (
          <Card className="divide-y divide-line">
            {inventory.data.filter((r) => r.assigned + r.adjusted > 0).length === 0 && <EmptyState title="No books assigned" action={<LinkButton href={`/l/inventory?student=${id}`}>Assign books</LinkButton>} />}
            {inventory.data.filter((r) => r.assigned + r.adjusted > 0).map((r) => (
              <div key={r.book_id} className="flex items-center gap-3 px-4 py-3">
                <Badge tone="navy">{r.books?.code}</Badge>
                <span className="min-w-0 flex-1 truncate text-sm text-muted">{r.assigned} asg · {r.distributed} dist · {r.returned} ret</span>
                <span className="text-lg font-bold text-numeric">{r.remaining}</span>
              </div>
            ))}
          </Card>
        ))}

        {tab === "transactions" && (!txs.data ? <PageLoader /> : txs.data.length === 0 ? <Card><EmptyState title="No transactions in this period" /></Card> : (
          <Card className="divide-y divide-line">
            {txs.data.map((t) => {
              const b = balanceOf(t.total_paid, t.expected_total);
              return (
                <Link key={t.id} href={`/tx?id=${t.id}`} className="pressable flex items-center gap-3 px-4 py-3 active:bg-sunken">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-numeric">{money(t.expected_total, settings.currency)} <span className="text-sm font-normal text-muted">· don. {money(t.donation_amount, settings.currency)}</span></div>
                    <div className="truncate text-sm text-muted">{dateLabel(t.work_date)} · {timeLabel(t.transaction_datetime, settings.timezone)}{t.neighborhood ? ` · ${t.neighborhood}` : ""}</div>
                  </div>
                  {t.status === "cancelled" ? <Badge tone="danger">Cancelled</Badge> : b.kind === "balanced" ? <Badge tone="success">Balanced</Badge>
                    : <Badge tone={b.kind === "underpaid" ? "warning" : "info"}>{b.kind === "underpaid" ? "−" : "+"}{money(b.amount, settings.currency)}</Badge>}
                </Link>
              );
            })}
          </Card>
        ))}

        {tab === "sessions" && (!sessions.data ? <PageLoader /> : <SessionList sessions={sessions.data} tz={settings.timezone} />)}

        {tab === "customers" && (!customers.data ? <PageLoader /> : customers.data.length === 0 ? <Card><EmptyState title="No customers saved" /></Card> : (
          <Card className="divide-y divide-line">
            {customers.data.map((c) => (
              <div key={c.id} className="px-4 py-3">
                <div className="font-medium">{c.name ?? "Unnamed"}</div>
                <div className="text-sm text-muted">{[c.neighborhood, c.city].filter(Boolean).join(", ") || "—"}{c.consent && (c.phone || c.whatsapp) ? ` · ${c.phone ?? c.whatsapp}` : ""}</div>
              </div>
            ))}
          </Card>
        ))}

        {tab === "days" && (!days.data ? <PageLoader /> : (
          <Section>
            <Card className="divide-y divide-line">
              {days.data.length === 0 && <EmptyState title="No closed days yet" />}
              {days.data.map((d) => (
                <Link key={d.id} href={`/l/reconcile/day?student=${id}&date=${d.work_date}`} className="pressable flex items-center gap-3 px-4 py-3 active:bg-sunken">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{dateLabel(d.work_date)}</div>
                    <div className="text-sm text-muted">Expected {money(d.expected_total, settings.currency)} · Submitted {money(d.total_submitted, settings.currency)}</div>
                  </div>
                  <ReconBadge status={d.status} />
                </Link>
              ))}
            </Card>
          </Section>
        ))}
      </div>
      {confirm.node}
    </>
  );
}

export default function StudentPage() {
  return <Suspense fallback={<PageLoader />}><StudentView /></Suspense>;
}
