"use client";

import { useState } from "react";
import { balanceOf, methodLabel, minutesToLabel, money, shiftDate, todayIn } from "@/lib/format";
import type { ReportSummary } from "@/lib/types";
import { Badge, Card, Section, Segmented, Stat } from "@/components/ui";

export type Range = { from: string | null; to: string | null };
export type RangeKey = "today" | "yesterday" | "date" | "range" | "all";

/** Today / Yesterday / Selected date / Date range / All time */
export function RangePicker({ tz, value, onChange }: { tz: string; value: Range; onChange: (r: Range, key: RangeKey) => void }) {
  const today = todayIn(tz);
  const [key, setKey] = useState<RangeKey>("today");
  const [date, setDate] = useState(today);
  const [from, setFrom] = useState(shiftDate(today, -6));
  const [to, setTo] = useState(today);
  function pick(k: RangeKey) {
    setKey(k);
    if (k === "today") onChange({ from: today, to: today }, k);
    if (k === "yesterday") { const y = shiftDate(today, -1); onChange({ from: y, to: y }, k); }
    if (k === "date") onChange({ from: date, to: date }, k);
    if (k === "range") onChange({ from, to }, k);
    if (k === "all") onChange({ from: null, to: null }, k);
  }
  return (
    <div className="space-y-2">
      <Segmented value={key} onChange={pick} options={[
        { value: "today", label: "Today" }, { value: "yesterday", label: "Yesterday" }, { value: "date", label: "Date" },
        { value: "range", label: "Range" }, { value: "all", label: "All" },
      ]} />
      {key === "date" && (
        <input type="date" value={date} max={today} onChange={(e) => { setDate(e.target.value); onChange({ from: e.target.value, to: e.target.value }, "date"); }}
          className="h-12 w-full rounded-2xl bg-elevated px-4 shadow-card ring-1 ring-line" />
      )}
      {key === "range" && (
        <div className="grid grid-cols-2 gap-2">
          <input type="date" aria-label="From" value={from} max={to} onChange={(e) => { setFrom(e.target.value); onChange({ from: e.target.value, to }, "range"); }}
            className="h-12 w-full rounded-2xl bg-elevated px-3 shadow-card ring-1 ring-line" />
          <input type="date" aria-label="To" value={to} min={from} max={today} onChange={(e) => { setTo(e.target.value); onChange({ from, to: e.target.value }, "range"); }}
            className="h-12 w-full rounded-2xl bg-elevated px-3 shadow-card ring-1 ring-line" />
        </div>
      )}
      <span className="sr-only">{value.from ?? "all"} – {value.to ?? "today"}</span>
    </div>
  );
}

/** The daily report block shared by students, leaders and admins. */
export function ReportBody({ r, currency, showStudents }: { r: ReportSummary; currency: string; showStudents?: boolean }) {
  const b = balanceOf(r.received, r.expected);
  const methods = { cash: 0, whish: 0, other: 0, ...r.by_method };
  const hours = r.work_minutes / 60;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Work Time" value={minutesToLabel(r.work_minutes)} sub={`${r.presentations} presentations`} />
        <Stat label="Books Distributed" value={r.books_distributed} sub={`${r.transactions} transactions`} />
        <Stat label="Book Value" value={money(r.book_value, currency)} />
        <Stat label="Donations" value={money(r.donations, currency)} />
        <Stat label="Money Received" className="col-span-2" value={money(r.received, currency)}
          tone={b.kind === "underpaid" ? "warning" : b.kind === "balanced" ? "success" : undefined}
          sub={b.kind === "balanced" ? "Balanced with expected total" : b.kind === "underpaid" ? `Underpaid ${money(b.amount, currency)} vs expected ${money(r.expected, currency)}` : `Over ${money(b.amount, currency)} vs expected ${money(r.expected, currency)}`} />
      </div>

      {(r.presentations > 0 || hours > 0) && (
        <div className="grid grid-cols-2 gap-3">
          <Stat label="Sales per presentation" value={r.presentations ? (r.transactions / r.presentations).toFixed(2) : "—"} />
          <Stat label="Sales per hour" value={hours >= 0.1 ? (r.transactions / hours).toFixed(2) : "—"} />
        </div>
      )}

      <Section title="Payment Breakdown">
        <Card className="divide-y divide-line">
          {Object.entries(methods).map(([m, v]) => (
            <div key={m} className="flex items-center justify-between px-5 py-3">
              <span className="text-muted">{methodLabel(m)}</span>
              <span className="font-semibold text-numeric">{money(v, currency)}</span>
            </div>
          ))}
        </Card>
      </Section>

      <Section title="Books">
        {r.by_book.length === 0 ? <p className="px-1 text-sm text-muted">No books distributed in this period.</p> : (
          <div className="flex flex-wrap gap-2">
            {r.by_book.map((x) => (
              <span key={x.code} className="inline-flex items-center gap-2 rounded-2xl bg-elevated px-3 py-2 shadow-card" title={x.name ?? ""}>
                <Badge tone="navy">{x.code}</Badge><span className="font-semibold text-numeric">{x.quantity}</span>
              </span>
            ))}
          </div>
        )}
      </Section>

      {showStudents && r.by_user.length > 0 && (
        <Section title="By student">
          <Card className="divide-y divide-line">
            {r.by_user.map((u) => (
              <div key={u.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 truncate font-medium">{u.full_name}{u.working && <span className="live-dot size-2 rounded-full bg-success" />}</div>
                  <div className="text-sm text-muted">{minutesToLabel(u.minutes)} · {u.books} books · {u.transactions} tx · {u.presentations} P</div>
                </div>
                <div className="text-end">
                  <div className="font-semibold text-numeric">{money(u.received, currency)}</div>
                  <div className="text-xs text-subtle">{money(u.donations, currency)} don.</div>
                </div>
              </div>
            ))}
          </Card>
        </Section>
      )}
    </div>
  );
}
