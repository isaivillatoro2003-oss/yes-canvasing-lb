"use client";

import Link from "next/link";
import { useState } from "react";
import { Users } from "lucide-react";
import { useApp } from "@/lib/app-context";
import { useData } from "@/lib/hooks";
import { getReport } from "@/lib/queries";
import { getMyStudents } from "@/lib/leader";
import { initials, minutesToLabel, money, todayIn } from "@/lib/format";
import { Badge, Card, EmptyState, PageLoader } from "@/components/ui";
import { PageHeader } from "@/components/app/shell";

export default function Team() {
  const { profile, settings } = useApp();
  const today = todayIn(settings.timezone);
  const students = useData(`leader:students:${profile!.id}`, () => getMyStudents(profile!.id), [profile!.id]);
  const report = useData(`leader:today:${today}`, () => getReport({ from: today, to: today }), [today]);
  const [query, setQuery] = useState("");
  const byUser = new Map((report.data?.by_user ?? []).map((u) => [u.id, u]));
  const list = (students.data ?? []).filter((s) => !query || s.full_name.toLowerCase().includes(query.toLowerCase()));
  list.sort((a, b) => Number(byUser.get(b.id)?.working ?? false) - Number(byUser.get(a.id)?.working ?? false));

  return (
    <>
      <PageHeader title="Team" subtitle={`${students.data?.length ?? 0} students`} />
      <div className="space-y-4 px-5">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search students"
          className="h-12 w-full rounded-2xl bg-elevated px-4 shadow-card ring-1 ring-line outline-none" />
        {!students.data ? <PageLoader /> : list.length === 0 ? (
          <Card><EmptyState icon={<Users className="size-6" />} title="No students yet" body="Students join your team with an access code linked to it, or when an admin assigns them." /></Card>
        ) : (
          <Card className="divide-y divide-line">
            {list.map((s) => {
              const u = byUser.get(s.id);
              return (
                <Link key={s.id} href={`/l/student?id=${s.id}`} className="pressable flex items-center gap-3 px-4 py-3 active:bg-sunken">
                  <span className="relative grid size-10 shrink-0 place-items-center rounded-xl bg-sunken text-sm font-bold">
                    {initials(s.full_name)}
                    {u?.working && <span className="live-dot absolute -end-0.5 -top-0.5 size-3 rounded-full bg-success ring-2 ring-[var(--bg-elevated)]" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 truncate font-medium">{s.full_name}{!s.active && <Badge tone="danger">Inactive</Badge>}</span>
                    <span className="block truncate text-sm text-muted">
                      {u ? `${minutesToLabel(u.minutes)} · ${u.books} books · ${money(u.received, settings.currency)}` : "No activity today"}
                    </span>
                  </span>
                  {u?.working && <Badge tone="success">Working</Badge>}
                </Link>
              );
            })}
          </Card>
        )}
      </div>
    </>
  );
}
