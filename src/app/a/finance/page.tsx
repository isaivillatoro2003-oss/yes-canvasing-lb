"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronRight, Lock, Receipt } from "lucide-react";
import { useApp } from "@/lib/app-context";
import { useData } from "@/lib/hooks";
import { rpc, sb, toAppError } from "@/lib/supabase";
import { dateLabel, dateTimeLabel, methodLabel, money, todayIn } from "@/lib/format";
import type { Profile, Reconciliation, Transaction } from "@/lib/types";
import { Badge, Button, Card, EmptyState, ListGroup, PageLoader, Segmented, Select, Stat, useConfirm } from "@/components/ui";
import { PageHeader } from "@/components/app/shell";
import { RangePicker, type Range } from "@/components/app/report-view";
import { unwrap } from "@/components/admin/bits";

type Seg = "tx" | "rec";
type TxRow = Transaction & { profiles: { full_name: string } | null };
type RecRow = Reconciliation & { profiles: { full_name: string } | null };

const REC_TONE: Record<Reconciliation["status"], "default" | "success" | "warning" | "danger" | "info" | "navy"> = {
  pending: "warning", balanced: "success", difference: "danger", approved: "info", locked: "navy",
};

export default function FinancePage() {
  const { settings, toast } = useApp();
  const cur = settings.currency;
  const today = todayIn(settings.timezone);
  const confirm = useConfirm();
  const [seg, setSeg] = useState<Seg>("tx");
  const [range, setRange] = useState<Range>({ from: today, to: today });
  const [student, setStudent] = useState("");
  const [method, setMethod] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const students = useData<Pick<Profile, "id" | "full_name">[]>("a:fin-students", async () => {
    const res = await sb().from("profiles").select("id, full_name").eq("role", "student").order("full_name");
    return unwrap<Pick<Profile, "id" | "full_name">[]>(res, toAppError);
  });

  const txKey = `a:fin-tx:${range.from ?? ""}:${range.to ?? ""}:${student}:${method}:${status}`;
  const tx = useData<TxRow[]>(txKey, async () => {
    let q = sb().from("transactions")
      .select(`*, profiles!transactions_user_id_fkey(full_name)${method ? ", payments!inner(method)" : ""}`)
      .order("transaction_datetime", { ascending: false }).limit(300);
    if (range.from) q = q.gte("work_date", range.from);
    if (range.to) q = q.lte("work_date", range.to);
    if (student) q = q.eq("user_id", student);
    if (status) q = q.eq("status", status);
    if (method) q = q.eq("payments.method", method);
    const res = await q;
    return unwrap<TxRow[]>(res, toAppError);
  }, [range.from, range.to, student, method, status]);

  const recs = useData<RecRow[]>("a:fin-recs", async () => {
    const res = await sb().from("daily_reconciliations")
      .select("*, profiles!daily_reconciliations_student_id_fkey(full_name)")
      .order("work_date", { ascending: false }).limit(200);
    return unwrap<RecRow[]>(res, toAppError);
  });

  const done = (tx.data ?? []).filter((t) => t.status === "completed");
  const totals = {
    count: done.length,
    value: done.reduce((s, t) => s + Number(t.book_value_total), 0),
    donations: done.reduce((s, t) => s + Number(t.donation_amount), 0),
    received: done.reduce((s, t) => s + Number(t.total_paid), 0),
  };

  async function lock(r: RecRow) {
    const ok = await confirm.ask("Lock this day?", {
      body: `${r.profiles?.full_name ?? "Student"} · ${dateLabel(r.work_date)}. Locked days cannot be changed anymore.`,
      confirm: "Lock day", tone: "danger",
    });
    if (!ok) return;
    setBusy(r.id);
    try {
      await rpc("lock_day", { p_id: r.id });
      await recs.refresh();
      toast("Day locked", "success");
    } catch (e) {
      toast(toAppError(e).message, "error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHeader title="Finance" />
      <div className="space-y-4 px-5">
        <Segmented<Seg> value={seg} onChange={setSeg} options={[{ value: "tx", label: "Transactions" }, { value: "rec", label: "Reconciliations" }]} />

        {seg === "tx" && (
          <>
            <RangePicker tz={settings.timezone} value={range} onChange={(r) => setRange(r)} />
            <div className="grid grid-cols-2 gap-2">
              <Select label="Student" className="col-span-2" value={student} onChange={(e) => setStudent(e.target.value)}>
                <option value="">All students</option>
                {(students.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
              </Select>
              <Select label="Payment method" value={method} onChange={(e) => setMethod(e.target.value)}>
                <option value="">Any method</option>
                {["cash", "whish", "other"].map((m) => <option key={m} value={m}>{methodLabel(m)}</option>)}
              </Select>
              <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">Any status</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Transactions" value={totals.count} />
              <Stat label="Book Value" value={money(totals.value, cur)} />
              <Stat label="Donations" value={money(totals.donations, cur)} />
              <Stat label="Received" value={money(totals.received, cur)} />
            </div>
            {!tx.data ? <PageLoader /> : tx.data.length === 0 ? (
              <Card><EmptyState icon={<Receipt className="size-6" />} title="No transactions" body="Nothing matches these filters." /></Card>
            ) : (
              <ListGroup>
                {tx.data.map((t) => (
                  <Link key={t.id} href={`/tx?id=${t.id}`} className="pressable flex min-h-14 items-center gap-3 px-4 py-3 active:bg-sunken">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{t.profiles?.full_name ?? "Student"}</div>
                      <div className="truncate text-sm text-muted">{dateTimeLabel(t.transaction_datetime, settings.timezone)}</div>
                    </div>
                    <div className="text-end">
                      <div className="font-semibold text-numeric">{money(t.total_paid, cur)}</div>
                      <div className="text-xs text-subtle">{money(t.book_value_total, cur)} + {money(t.donation_amount, cur)}</div>
                    </div>
                    {t.status !== "completed" && <Badge tone={t.status === "cancelled" ? "danger" : "default"}>{t.status === "cancelled" ? "Cancelled" : "Draft"}</Badge>}
                    <ChevronRight className="size-4 shrink-0 text-subtle rtl:rotate-180" aria-hidden />
                  </Link>
                ))}
              </ListGroup>
            )}
          </>
        )}

        {seg === "rec" && (!recs.data ? <PageLoader /> : recs.data.length === 0 ? (
          <Card><EmptyState icon={<Receipt className="size-6" />} title="No reconciliations yet" body="Closed days will appear here." /></Card>
        ) : (
          <ListGroup>
            {recs.data.map((r) => (
              <div key={r.id} className="flex items-center gap-2 pe-3">
                <Link href={`/l/reconcile/day?student=${r.student_id}&date=${r.work_date}`}
                  className="pressable flex min-h-14 min-w-0 flex-1 items-center gap-3 px-4 py-3 active:bg-sunken">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{r.profiles?.full_name ?? "Student"}</div>
                    <div className="truncate text-sm text-muted">
                      {dateLabel(r.work_date)} · Money {money(r.money_difference, cur)} · Books {r.book_difference}
                    </div>
                  </div>
                  <Badge tone={REC_TONE[r.status]}>{r.status.charAt(0).toUpperCase() + r.status.slice(1)}</Badge>
                </Link>
                {r.status === "approved" && (
                  <Button size="sm" variant="secondary" loading={busy === r.id} onClick={() => lock(r)}><Lock className="size-4" /> Lock</Button>
                )}
              </div>
            ))}
          </ListGroup>
        ))}
      </div>
      {confirm.node}
    </>
  );
}
