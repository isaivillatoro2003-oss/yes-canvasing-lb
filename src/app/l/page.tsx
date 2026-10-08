"use client";

import Link from "next/link";
import { ClipboardCheck, Users } from "lucide-react";
import { useApp } from "@/lib/app-context";
import { useData, useNow } from "@/lib/hooks";
import { getReport } from "@/lib/queries";
import { getActiveSessions, getPendingDays } from "@/lib/leader";
import { elapsedLabel, initials, minutesToLabel, money, timeLabel, todayIn } from "@/lib/format";
import { Card, EmptyState, ListGroup, ListRow, Notice, Section, Stat } from "@/components/ui";
import { PageHeader } from "@/components/app/shell";

export default function LeaderDashboard() {
  const { profile, settings } = useApp();
  const today = todayIn(settings.timezone);
  const report = useData(`leader:today:${today}`, () => getReport({ from: today, to: today }), [today]);
  const active = useData("leader:active", getActiveSessions);
  const pending = useData("leader:pending", () => getPendingDays(200));
  const now = useNow(1000);
  const r = report.data;
  const team = (active.data ?? []).filter((s) => s.user_id !== profile!.id);
  const toClose = (pending.data ?? []).length;

  return (
    <>
      <PageHeader title="Dashboard" subtitle={`Hello, ${profile!.full_name.split(" ")[0]} · ${new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: settings.timezone })}`} />
      <div className="space-y-6 px-5">
        {report.stale && <Notice tone="warning">Showing saved data — you seem to be offline.</Notice>}

        <div className="grid grid-cols-2 gap-3">
          <Stat label="Working Now" value={<span className="inline-flex items-center gap-2">{r?.working_now ?? 0}{(r?.working_now ?? 0) > 0 && <span className="live-dot size-2.5 rounded-full bg-success" />}</span>} />
          <Stat label="Students Today" value={r?.students_active ?? 0} />
          <Stat label="Books Distributed" value={r?.books_distributed ?? 0} />
          <Stat label="Book Value" value={money(r?.book_value, settings.currency)} />
          <Stat label="Donations" value={money(r?.donations, settings.currency)} />
          <Stat label="Money Received" value={money(r?.received, settings.currency)} />
          <Stat label="Work Hours" value={minutesToLabel(r?.work_minutes)} sub={`${r?.presentations ?? 0} presentations · ${r?.transactions ?? 0} transactions`} className="col-span-2" />
        </div>

        {toClose > 0 && (
          <Link href="/l/reconcile" className="pressable flex items-center gap-3 rounded-3xl bg-primary p-4 text-primary-fg shadow-card">
            <span className="grid size-10 place-items-center rounded-2xl bg-white/10"><ClipboardCheck className="size-5" /></span>
            <span className="flex-1"><span className="block font-semibold">{toClose} day{toClose > 1 ? "s" : ""} to close</span>
              <span className="block text-sm opacity-75">Reconcile books and money, then approve</span></span>
          </Link>
        )}

        <Section title="Active Now">
          {team.length === 0 ? (
            <Card><EmptyState icon={<Users className="size-6" />} title="Nobody is working right now" body="Students appear here the moment they tap START WORK." /></Card>
          ) : (
            <div className="space-y-2">
              {team.map((s) => (
                <Link key={s.session_id} href={`/l/student?id=${s.user_id}`}
                  className="pressable flex items-center gap-3 rounded-3xl bg-elevated p-4 shadow-card">
                  <span className="relative grid size-11 place-items-center rounded-2xl bg-sunken font-bold">
                    {initials(s.full_name)}
                    <span className="live-dot absolute -end-0.5 -top-0.5 size-3 rounded-full bg-success ring-2 ring-[var(--bg-elevated)]" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{s.full_name}</span>
                    <span className="block text-sm text-muted">Since {timeLabel(s.started_at, settings.timezone)} · {s.presentations} presentations</span>
                  </span>
                  <span className="text-lg font-bold text-numeric">{elapsedLabel(s.started_at, now)}</span>
                </Link>
              ))}
            </div>
          )}
        </Section>

        <ListGroup>
          <ListRow href="/l/team" icon={<Users className="size-[18px]" />} title="My team" />
          <ListRow href="/l/reconcile" icon={<ClipboardCheck className="size-[18px]" />} title="Close day / Reconciliation" trailing={toClose ? `${toClose} pending` : undefined} />
        </ListGroup>
      </div>
    </>
  );
}
