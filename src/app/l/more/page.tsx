"use client";

import { useRouter } from "next/navigation";
import { CalendarCheck, ClipboardCheck, Footprints, LogOut } from "lucide-react";
import { useApp } from "@/lib/app-context";
import { LANGS } from "@/lib/i18n";
import { initials } from "@/lib/format";
import { Button, Card, ListGroup, ListRow, Section, Segmented } from "@/components/ui";
import { PageHeader } from "@/components/app/shell";

export default function LeaderMore() {
  const { profile, lang, setLang, signOut } = useApp();
  const router = useRouter();
  return (
    <>
      <PageHeader title="More" />
      <div className="space-y-6 px-5">
        <Card className="flex items-center gap-4 p-5">
          <span className="grid size-14 place-items-center rounded-2xl bg-primary text-lg font-bold text-primary-fg">{initials(profile!.full_name)}</span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-headline">{profile!.full_name}</div>
            <div className="truncate text-sm text-muted">{profile!.email}</div>
            <div className="text-xs font-semibold capitalize text-subtle">{profile!.role}</div>
          </div>
        </Card>
        <ListGroup>
          <ListRow href="/l/reconcile" icon={<ClipboardCheck className="size-[18px]" />} title="Close Day / Reconciliation" />
          <ListRow href="/l/follow-ups" icon={<CalendarCheck className="size-[18px]" />} title="Team follow-ups" />
          <ListRow href="/s" icon={<Footprints className="size-[18px]" />} title="Field mode" subtitle="Record your own work and sales" />
        </ListGroup>
        <Section title="Language">
          <Segmented value={lang} onChange={setLang} options={LANGS.map((l) => ({ value: l.code, label: l.label }))} />
        </Section>
        <Button variant="secondary" size="lg" block className="text-danger" onClick={async () => { await signOut(); router.replace("/"); }}>
          <LogOut className="size-5" /> Sign out
        </Button>
      </div>
    </>
  );
}
