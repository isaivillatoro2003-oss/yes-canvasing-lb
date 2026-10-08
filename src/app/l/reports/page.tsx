"use client";

import { useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { useApp } from "@/lib/app-context";
import { useData } from "@/lib/hooks";
import { getBooks, getReport } from "@/lib/queries";
import { getMyStudents } from "@/lib/leader";
import { sb } from "@/lib/supabase";
import { dateLabel, methodLabel, todayIn } from "@/lib/format";
import type { Profile, Team, Territory } from "@/lib/types";
import { Badge, Button, Notice, PageLoader, Select, Sheet } from "@/components/ui";
import { PageHeader } from "@/components/app/shell";
import { RangePicker, ReportBody, type Range } from "@/components/app/report-view";

type Filters = { user: string; team: string; leader: string; territory: string; book: string; method: string };
const NONE: Filters = { user: "", team: "", leader: "", territory: "", book: "", method: "" };

export default function Reports() {
  const { profile, settings } = useApp();
  const today = todayIn(settings.timezone);
  const [range, setRange] = useState<Range>({ from: today, to: today });
  const [filters, setFilters] = useState<Filters>(NONE);
  const [draft, setDraft] = useState<Filters>(NONE);
  const [open, setOpen] = useState(false);
  const isAdmin = profile?.role === "admin";

  const key = `reports:${range.from}:${range.to}:${Object.values(filters).join(":")}`;
  const report = useData(key, () => getReport({
    from: range.from, to: range.to, user: filters.user || null, team: filters.team || null, leader: filters.leader || null,
    territory: filters.territory || null, book: filters.book || null, method: filters.method || null,
  }), [key]);

  const students = useData(`leader:students:${profile!.id}`, () => getMyStudents(profile!.id), [profile!.id]);
  const books = useData("books:active", () => getBooks());
  const lists = useData("report:lists", async () => {
    const [teams, territories, leaders] = await Promise.all([
      sb().from("teams").select("*").order("team_name"),
      sb().from("territories").select("*").order("territory_name"),
      isAdmin ? sb().from("profiles").select("*").eq("role", "leader").order("full_name") : Promise.resolve({ data: [] }),
    ]);
    return { teams: (teams.data ?? []) as Team[], territories: (territories.data ?? []) as Territory[], leaders: (leaders.data ?? []) as Profile[] };
  });

  const activeCount = Object.values(filters).filter(Boolean).length;

  return (
    <>
      <PageHeader title="Reports"
        subtitle={range.from ? (range.from === range.to ? dateLabel(range.from) : `${dateLabel(range.from)} – ${dateLabel(range.to)}`) : "All time"}
        action={<Button size="sm" variant="secondary" onClick={() => { setDraft(filters); setOpen(true); }}>
          <SlidersHorizontal className="size-4" /> Filters{activeCount ? <Badge tone="navy">{activeCount}</Badge> : null}
        </Button>} />
      <div className="space-y-6 px-5">
        <RangePicker tz={settings.timezone} value={range} onChange={setRange} />
        {report.stale && <Notice tone="warning">Showing saved data — you seem to be offline.</Notice>}
        {!report.data ? <PageLoader /> : <ReportBody r={report.data} currency={settings.currency} showStudents />}
      </div>

      <Sheet open={open} onClose={() => setOpen(false)} title="Filters"
        footer={<div className="flex gap-2">
          <Button variant="secondary" block onClick={() => { setFilters(NONE); setOpen(false); }}>Clear</Button>
          <Button block onClick={() => { setFilters(draft); setOpen(false); }}>Apply</Button>
        </div>}>
        <div className="space-y-3 pb-2">
          <Select label="Student" value={draft.user} onChange={(e) => setDraft({ ...draft, user: e.target.value })}>
            <option value="">All students</option>
            {(students.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
          </Select>
          {isAdmin && (
            <Select label="Leader" value={draft.leader} onChange={(e) => setDraft({ ...draft, leader: e.target.value })}>
              <option value="">All leaders</option>
              {(lists.data?.leaders ?? []).map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
            </Select>
          )}
          <Select label="Team" value={draft.team} onChange={(e) => setDraft({ ...draft, team: e.target.value })}>
            <option value="">All teams</option>
            {(lists.data?.teams ?? []).map((t) => <option key={t.id} value={t.id}>{t.team_name}</option>)}
          </Select>
          <Select label="Territory" value={draft.territory} onChange={(e) => setDraft({ ...draft, territory: e.target.value })}>
            <option value="">All territories</option>
            {(lists.data?.territories ?? []).map((t) => <option key={t.id} value={t.id}>{t.territory_name}</option>)}
          </Select>
          <Select label="Book" value={draft.book} onChange={(e) => setDraft({ ...draft, book: e.target.value })}>
            <option value="">All books</option>
            {(books.data ?? []).map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name ?? ""}</option>)}
          </Select>
          <Select label="Payment method" value={draft.method} onChange={(e) => setDraft({ ...draft, method: e.target.value })}>
            <option value="">All methods</option>
            {settings.payment_methods.map((m) => <option key={m} value={m}>{methodLabel(m)}</option>)}
          </Select>
        </div>
      </Sheet>
    </>
  );
}
