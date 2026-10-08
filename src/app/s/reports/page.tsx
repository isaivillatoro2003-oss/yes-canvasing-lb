"use client";

import { useState } from "react";
import Link from "next/link";
import { useApp } from "@/lib/app-context";
import { useData } from "@/lib/hooks";
import { getReport } from "@/lib/queries";
import { sb, toAppError } from "@/lib/supabase";
import { balanceOf, dateLabel, money, timeLabel, todayIn } from "@/lib/format";
import type { Transaction } from "@/lib/types";
import { Badge, Card, Notice, PageLoader, Section } from "@/components/ui";
import { PageHeader } from "@/components/app/shell";
import { RangePicker, ReportBody, type Range } from "@/components/app/report-view";

export default function MyReports() {
  const { profile, settings } = useApp();
  const uid = profile!.id;
  const today = todayIn(settings.timezone);
  const [range, setRange] = useState<Range>({ from: today, to: today });
  const key = `report:${uid}:${range.from}:${range.to}`;
  const report = useData(key, () => getReport({ ...range, user: uid }), [uid, range.from, range.to]);
  const txs = useData(`tx:${key}`, async () => {
    let q = sb().from("transactions").select("*").eq("user_id", uid).order("transaction_datetime", { ascending: false }).limit(100);
    if (range.from) q = q.gte("work_date", range.from);
    if (range.to) q = q.lte("work_date", range.to);
    const { data, error } = await q;
    if (error) throw toAppError(error);
    return data as Transaction[];
  }, [uid, range.from, range.to]);

  const title = range.from === today && range.to === today ? "Today's Report" : "My Reports";

  return (
    <>
      <PageHeader title={title} subtitle={range.from ? (range.from === range.to ? dateLabel(range.from) : `${dateLabel(range.from)} – ${dateLabel(range.to)}`) : "All time"} />
      <div className="space-y-6 px-5">
        <RangePicker tz={settings.timezone} value={range} onChange={setRange} />
        {report.stale && <Notice tone="warning">Showing saved data — you seem to be offline.</Notice>}
        {!report.data ? <PageLoader /> : <ReportBody r={report.data} currency={settings.currency} />}

        <Section title="Transactions">
          {(txs.data ?? []).length === 0 ? <p className="px-1 text-sm text-muted">No transactions in this period.</p> : (
            <Card className="divide-y divide-line">
              {txs.data!.map((t) => {
                const b = balanceOf(t.total_paid, t.expected_total);
                return (
                  <Link key={t.id} href={`/tx?id=${t.id}`} className="pressable flex items-center gap-3 px-4 py-3 active:bg-sunken">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-numeric">{money(t.expected_total, settings.currency)}
                        {t.status === "cancelled" && <Badge tone="danger" className="ms-2">Cancelled</Badge>}</div>
                      <div className="truncate text-sm text-muted">{dateLabel(t.work_date)} · {timeLabel(t.transaction_datetime, settings.timezone)}{t.neighborhood ? ` · ${t.neighborhood}` : t.city ? ` · ${t.city}` : ""}</div>
                    </div>
                    {t.status !== "cancelled" && (b.kind === "balanced" ? <Badge tone="success">Balanced</Badge>
                      : b.kind === "underpaid" ? <Badge tone="warning">−{money(b.amount, settings.currency)}</Badge>
                      : <Badge tone="info">+{money(b.amount, settings.currency)}</Badge>)}
                  </Link>
                );
              })}
            </Card>
          )}
        </Section>
      </div>
    </>
  );
}
