"use client";

import Link from "next/link";
import { useEffect } from "react";
import {
  BarChart3, BookOpen, Boxes, CalendarCheck, ClipboardCheck, KeyRound, MapPin, ScrollText, Settings, UsersRound, Users, Wallet,
} from "lucide-react";
import { useApp } from "@/lib/app-context";
import { useData, useNow } from "@/lib/hooks";
import { getReport } from "@/lib/queries";
import { rpc, sb, toAppError } from "@/lib/supabase";
import { elapsedLabel, minutesToLabel, money, todayIn } from "@/lib/format";
import { Card, EmptyState, PageLoader, Section, Stat } from "@/components/ui";
import { PageHeader } from "@/components/app/shell";
import { unwrap } from "@/components/admin/bits";

type Totals = {
  students: number; leaders: number; assigned: number; distributed: number; remaining: number;
  warehouse: number; unreconciled: number; moneyDiffs: number; bookDiffs: number;
};
type ActiveRow = { session_id: string; user_id: string; full_name: string; team_name: string | null; started_at: string; last_heartbeat: string | null; presentations: number };

const TILES = [
  { href: "/a/users", label: "Users", icon: Users },
  { href: "/a/codes", label: "Access Codes", icon: KeyRound },
  { href: "/a/teams", label: "Teams", icon: UsersRound },
  { href: "/a/books", label: "Books", icon: BookOpen },
  { href: "/a/inventory", label: "Inventory", icon: Boxes },
  { href: "/a/finance", label: "Finance", icon: Wallet },
  { href: "/l/reports", label: "Reports", icon: BarChart3 },
  { href: "/l/reconcile", label: "Reconciliation", icon: ClipboardCheck },
  { href: "/a/territories", label: "Territories", icon: MapPin },
  { href: "/a/follow-ups", label: "Follow-ups", icon: CalendarCheck },
  { href: "/a/audit", label: "Audit Log", icon: ScrollText },
  { href: "/a/settings", label: "Settings", icon: Settings },
];

export default function AdminDashboard() {
  const { settings } = useApp();
  const today = todayIn(settings.timezone);
  const cur = settings.currency;

  const kpi = useData(`a:kpi:${today}`, () => getReport({ from: today, to: today }), [today]);
  const totals = useData<Totals>("a:totals", async () => {
    const [profiles, inv, books, pending, recs] = await Promise.all([
      sb().from("profiles").select("role, active"),
      sb().from("inventory").select("assigned, distributed, remaining"),
      sb().from("books").select("warehouse_qty"),
      rpc<unknown[]>("pending_days", { p_limit: 1000 }),
      sb().from("daily_reconciliations").select("money_difference, book_difference").eq("status", "difference"),
    ]);
    const p = unwrap<{ role: string; active: boolean }[]>(profiles, toAppError);
    const i = unwrap<{ assigned: number; distributed: number; remaining: number }[]>(inv, toAppError);
    const b = unwrap<{ warehouse_qty: number }[]>(books, toAppError);
    const r = unwrap<{ money_difference: number; book_difference: number }[]>(recs, toAppError);
    return {
      students: p.filter((x) => x.role === "student" && x.active).length,
      leaders: p.filter((x) => x.role === "leader" && x.active).length,
      assigned: i.reduce((s, x) => s + x.assigned, 0),
      distributed: i.reduce((s, x) => s + x.distributed, 0),
      remaining: i.reduce((s, x) => s + x.remaining, 0),
      warehouse: b.reduce((s, x) => s + x.warehouse_qty, 0),
      unreconciled: pending.length,
      moneyDiffs: r.filter((x) => Number(x.money_difference) !== 0).length,
      bookDiffs: r.filter((x) => Number(x.book_difference) !== 0).length,
    };
  });
  const active = useData<ActiveRow[]>("a:active", () => rpc<ActiveRow[]>("active_sessions"));
  const { refresh: refreshActive } = active;
  const now = useNow(1000);

  useEffect(() => {
    const id = setInterval(() => { void refreshActive(); }, 30000);
    return () => clearInterval(id);
  }, [refreshActive]);

  const r = kpi.data;
  const t = totals.data;

  return (
    <>
      <PageHeader title="Dashboard" subtitle={settings.org_name} />
      <div className="space-y-6 px-5">
        <Section title="Today">
          {!r ? <PageLoader /> : (
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Students Working" value={r.working_now} tone={r.working_now ? "success" : "default"} />
              <Stat label="Books Distributed" value={r.books_distributed} sub={`${r.transactions} transactions`} />
              <Stat label="Book Value" value={money(r.book_value, cur)} />
              <Stat label="Donations" value={money(r.donations, cur)} />
              <Stat label="Money Received" value={money(r.received, cur)} sub={`Expected ${money(r.expected, cur)}`} />
              <Stat label="Work Hours" value={minutesToLabel(r.work_minutes)} sub={`${r.presentations} presentations`} />
            </div>
          )}
        </Section>

        <Section title="Active now">
          {!active.data ? <PageLoader /> : active.data.length === 0 ? (
            <Card><EmptyState icon={<Users className="size-6" />} title="Nobody is working right now" body="Students appear here while they have an active session." /></Card>
          ) : (
            <Card className="divide-y divide-line">
              {active.data.map((s) => (
                <Link key={s.session_id} href={`/l/student?id=${s.user_id}`} className="pressable flex items-center gap-3 px-4 py-3 active:bg-sunken">
                  <span className="live-dot size-2.5 shrink-0 rounded-full bg-success" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{s.full_name}</div>
                    <div className="truncate text-sm text-muted">{s.team_name ?? "No team"} · {s.presentations} presentations</div>
                  </div>
                  <span className="font-semibold text-numeric">{elapsedLabel(s.started_at, now)}</span>
                </Link>
              ))}
            </Card>
          )}
        </Section>

        <Section title="Totals">
          {!t ? <PageLoader /> : (
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Total Students" value={t.students} />
              <Stat label="Total Leaders" value={t.leaders} />
              <Stat label="Books Assigned" value={t.assigned} />
              <Stat label="Books Distributed" value={t.distributed} />
              <Stat label="Books Remaining" value={t.remaining} />
              <Stat label="Warehouse Stock" value={t.warehouse} />
              <Stat label="Unreconciled Days" value={t.unreconciled} tone={t.unreconciled ? "warning" : "success"} />
              <Stat label="Financial Differences" value={t.moneyDiffs} tone={t.moneyDiffs ? "danger" : "success"} />
              <Stat label="Inventory Differences" value={t.bookDiffs} tone={t.bookDiffs ? "danger" : "success"} className="col-span-2" />
            </div>
          )}
        </Section>

        <Section title="Manage">
          <div className="grid grid-cols-3 gap-3">
            {TILES.map(({ href, label, icon: Icon }) => (
              <Link key={href} href={href}
                className="pressable flex min-h-24 flex-col items-center justify-center gap-2 rounded-2xl bg-elevated p-3 text-center shadow-card active:bg-sunken">
                <span className="grid size-10 place-items-center rounded-xl bg-sunken"><Icon className="size-5" /></span>
                <span className="text-xs font-semibold">{label}</span>
              </Link>
            ))}
          </div>
        </Section>
      </div>
    </>
  );
}
