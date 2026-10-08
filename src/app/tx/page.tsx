"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Ban } from "lucide-react";
import { useApp } from "@/lib/app-context";
import { useData } from "@/lib/hooks";
import { rpc, sb, toAppError } from "@/lib/supabase";
import { balanceOf, dateTimeLabel, methodLabel, money } from "@/lib/format";
import type { Customer, Transaction } from "@/lib/types";
import { Badge, Button, Card, Field, Notice, PageLoader, Section, Sheet } from "@/components/ui";
import { AppShell, PageHeader } from "@/components/app/shell";

type Detail = Transaction & {
  transaction_items: { id: string; book_code: string; quantity: number; unit_value: number; line_total: number; books: { name: string | null } | null }[];
  payments: { id: string; amount: number; method: string; reference: string | null; status: string }[];
  donations: { id: string; amount: number; donor_name: string | null }[];
  customers: Customer | null;
  profiles: { full_name: string } | null;
  territories: { territory_name: string } | null;
};

function TxDetail() {
  const id = useSearchParams().get("id") ?? "";
  const { profile, settings, toast } = useApp();
  const tx = useData(id ? `txd:${id}` : null, async () => {
    const { data, error } = await sb().from("transactions")
      .select("*, transaction_items(*, books(name)), payments(*), donations(*), customers(*), profiles!transactions_user_id_fkey(full_name), territories(territory_name)")
      .eq("id", id).maybeSingle();
    if (error) throw toAppError(error);
    return data as Detail | null;
  }, [id]);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  if (tx.loading && !tx.data) return <PageLoader />;
  const t = tx.data;
  if (!t) return <><PageHeader title="Transaction" back /><div className="px-5"><Notice tone="warning">Transaction not found or not visible to you.</Notice></div></>;

  const b = balanceOf(t.total_paid, t.expected_total);
  const isStaff = profile?.role !== "student";
  const canCancel = t.status === "completed" && (profile?.role === "admin" || (profile?.role === "leader" && t.user_id !== profile.id));

  async function cancel() {
    setBusy(true);
    try {
      await rpc("cancel_transaction", { p_id: t!.id, p_reason: reason });
      toast("Transaction cancelled. Inventory restored.", "success");
      setCancelOpen(false);
      tx.refresh();
    } catch (e) {
      toast(toAppError(e).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader back title={money(t.expected_total, settings.currency)}
        subtitle={`${dateTimeLabel(t.transaction_datetime, settings.timezone)}${t.profiles && isStaff ? ` · ${t.profiles.full_name}` : ""}`} />
      <div className="space-y-6 px-5">
        <div className="flex flex-wrap gap-2">
          {t.status === "cancelled" ? <Badge tone="danger">Cancelled</Badge>
            : b.kind === "balanced" ? <Badge tone="success">Balanced</Badge>
            : b.kind === "underpaid" ? <Badge tone="warning">Underpaid: {money(b.amount, settings.currency)}</Badge>
            : <Badge tone="info">Over: {money(b.amount, settings.currency)}</Badge>}
          {(t.territories?.territory_name || t.city || t.neighborhood) && (
            <Badge>{[t.territories?.territory_name, t.city, t.neighborhood].filter(Boolean).join(" · ")}</Badge>
          )}
        </div>
        {t.status === "cancelled" && t.cancelled_reason && <Notice tone="danger">Reason: {t.cancelled_reason}</Notice>}

        <Section title="Books">
          <Card className="divide-y divide-line">
            {t.transaction_items.length === 0 && <p className="px-5 py-3 text-sm text-muted">Donation only</p>}
            {t.transaction_items.map((i) => (
              <div key={i.id} className="flex items-center gap-3 px-5 py-3">
                <Badge tone="navy">{i.book_code}</Badge>
                <span className="min-w-0 flex-1 truncate text-sm text-muted">{i.books?.name}</span>
                <span className="text-sm text-muted text-numeric">{i.quantity} × {money(i.unit_value, settings.currency)}</span>
                <span className="w-16 text-end font-semibold text-numeric">{money(i.line_total, settings.currency)}</span>
              </div>
            ))}
          </Card>
        </Section>

        <Section title="Totals">
          <Card className="divide-y divide-line">
            {[
              ["Book Value", t.book_value_total],
              ["Donation", t.donation_amount],
              ["Expected Total", t.expected_total],
              ...t.payments.map((p) => [`${methodLabel(p.method)}${p.reference ? ` · ${p.reference}` : ""}${p.status === "void" ? " (void)" : ""}`, p.amount] as [string, number]),
              ["Total Received", t.total_paid],
            ].map(([k, v], idx) => (
              <div key={idx} className="flex items-center justify-between px-5 py-3">
                <span className="text-muted">{k}</span><span className="font-semibold text-numeric">{money(v as number, settings.currency)}</span>
              </div>
            ))}
          </Card>
        </Section>

        {t.customers && (
          <Section title="Customer">
            <Card className="space-y-1 p-5 text-sm">
              <div className="font-semibold">{t.customers.name ?? "Unnamed"}</div>
              {t.customers.phone && <div>Phone: {t.customers.phone}</div>}
              {t.customers.whatsapp && <div>WhatsApp: {t.customers.whatsapp}</div>}
              {t.customers.email && <div>Email: {t.customers.email}</div>}
              {t.customers.notes && <div className="text-muted">{t.customers.notes}</div>}
              <div className="pt-1 text-xs text-subtle">{t.customers.consent ? "Agreed to be contacted" : "No contact consent"}</div>
            </Card>
          </Section>
        )}

        {t.notes && <Section title="Notes"><Card className="p-5 text-sm">{t.notes}</Card></Section>}

        {canCancel && (
          <Button variant="secondary" block className="text-danger" onClick={() => setCancelOpen(true)}>
            <Ban className="size-4" /> Cancel transaction
          </Button>
        )}
      </div>

      <Sheet open={cancelOpen} onClose={() => setCancelOpen(false)} title="Cancel transaction"
        footer={<Button variant="danger" block loading={busy} disabled={reason.trim().length < 3} onClick={cancel}>Cancel transaction</Button>}>
        <p className="mb-3 text-sm text-muted">The books go back to the student&apos;s inventory and payments are voided. This is recorded in the audit log.</p>
        <Field label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
      </Sheet>
    </>
  );
}

export default function TxPage() {
  return (
    <AppShell roles={["student", "leader", "admin"]}>
      <Suspense fallback={<PageLoader />}><TxDetail /></Suspense>
    </AppShell>
  );
}
