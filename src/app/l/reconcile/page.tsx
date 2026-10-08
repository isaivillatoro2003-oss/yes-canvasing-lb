"use client";

import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { useApp } from "@/lib/app-context";
import { useData } from "@/lib/hooks";
import { getPendingDays } from "@/lib/leader";
import { dateLabel, money } from "@/lib/format";
import { Card, EmptyState, PageLoader, Section } from "@/components/ui";
import { PageHeader } from "@/components/app/shell";
import { ReconBadge } from "@/components/app/recon-badge";

export default function ReconcileList() {
  const { settings } = useApp();
  const pending = useData("leader:pending", () => getPendingDays(300));
  const groups = new Map<string, NonNullable<typeof pending.data>>();
  for (const d of pending.data ?? []) groups.set(d.work_date, [...(groups.get(d.work_date) ?? []), d]);

  return (
    <>
      <PageHeader back="/l" title="Close Day" subtitle="Check books and money for each student, then approve the day." />
      <div className="space-y-6 px-5">
        {!pending.data ? <PageLoader /> : pending.data.length === 0 ? (
          <Card><EmptyState icon={<CheckCircle2 className="size-6" />} title="All days are approved" body="Days with work or sales appear here until a leader approves them." /></Card>
        ) : (
          [...groups.entries()].map(([date, rows]) => (
            <Section key={date} title={dateLabel(date)}>
              <Card className="divide-y divide-line">
                {rows.map((d) => (
                  <Link key={d.student_id + date} href={`/l/reconcile/day?student=${d.student_id}&date=${date}`}
                    className="pressable flex items-center gap-3 px-4 py-3 active:bg-sunken">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{d.full_name}</div>
                      <div className="text-sm text-muted">{d.transactions} transactions · expected {money(d.expected, settings.currency)}</div>
                    </div>
                    <ReconBadge status={d.status} />
                  </Link>
                ))}
              </Card>
            </Section>
          ))
        )}
      </div>
    </>
  );
}
