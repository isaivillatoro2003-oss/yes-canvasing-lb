"use client";

import { BookOpen } from "lucide-react";
import { useApp } from "@/lib/app-context";
import { useData } from "@/lib/hooks";
import { getInventory } from "@/lib/queries";
import { money } from "@/lib/format";
import { Badge, Card, EmptyState, Notice, PageLoader, Section, Stat } from "@/components/ui";
import { PageHeader } from "@/components/app/shell";

export default function MyInventory() {
  const { profile, settings, t } = useApp();
  const uid = profile!.id;
  const inv = useData(`inventory:${uid}`, () => getInventory(uid), [uid]);
  const rows = inv.data ?? [];
  const held = rows.filter((r) => r.assigned + r.adjusted > 0 || r.remaining > 0);
  const totals = held.reduce(
    (a, r) => ({
      assigned: a.assigned + r.assigned, distributed: a.distributed + r.distributed, returned: a.returned + r.returned,
      remaining: a.remaining + r.remaining, value: a.value + r.remaining * Number(r.books?.unit_value ?? 0),
    }),
    { assigned: 0, distributed: 0, returned: 0, remaining: 0, value: 0 },
  );

  return (
    <>
      <PageHeader title={t("home.myInventory")} subtitle="Remaining = Assigned − Distributed − Returned" />
      <div className="space-y-6 px-5">
        {inv.stale && <Notice tone="warning">Showing saved data — you seem to be offline.</Notice>}
        <div className="grid grid-cols-2 gap-3">
          <Stat label="Remaining" value={totals.remaining} sub={`Worth ${money(totals.value, settings.currency)}`} />
          <Stat label="Distributed" value={totals.distributed} sub={`${totals.assigned} assigned · ${totals.returned} returned`} />
        </div>

        {inv.loading && !inv.data ? <PageLoader /> : held.length === 0 ? (
          <Card><EmptyState icon={<BookOpen className="size-6" />} title="No books yet" body="When your leader assigns books to you, they'll show up here." /></Card>
        ) : (
          <Section title="By book">
            <Card className="overflow-hidden">
              <div className="grid grid-cols-[1fr_repeat(4,2.75rem)] gap-x-1 border-b border-line px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-subtle">
                <span>Book</span><span className="text-end">Asg</span><span className="text-end">Dist</span><span className="text-end">Ret</span><span className="text-end">Left</span>
              </div>
              <ul className="divide-y divide-line">
                {held.map((r) => (
                  <li key={r.book_id} className="grid grid-cols-[1fr_repeat(4,2.75rem)] items-center gap-x-1 px-4 py-3">
                    <div className="min-w-0">
                      <Badge tone="navy">{r.books?.code}</Badge>
                      <div className="mt-1 truncate text-sm text-muted">{r.books?.name ?? "—"}</div>
                    </div>
                    <span className="text-end text-numeric text-muted">{r.assigned + r.adjusted}</span>
                    <span className="text-end text-numeric text-muted">{r.distributed}</span>
                    <span className="text-end text-numeric text-muted">{r.returned}</span>
                    <span className={`text-end text-lg font-bold text-numeric ${r.remaining === 0 ? "text-subtle" : ""}`}>{r.remaining}</span>
                  </li>
                ))}
              </ul>
            </Card>
          </Section>
        )}
      </div>
    </>
  );
}
