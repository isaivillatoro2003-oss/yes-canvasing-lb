"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarCheck, Clock, CloudUpload, Download, Globe, LayoutDashboard, LogOut, ShieldCheck, UserRound, Users } from "lucide-react";
import { homeFor, useApp } from "@/lib/app-context";
import { rpc, toAppError } from "@/lib/supabase";
import { initials } from "@/lib/format";
import { LANGS } from "@/lib/i18n";
import { Button, Card, Field, ListGroup, ListRow, Section, Segmented, Sheet } from "@/components/ui";
import { PageHeader } from "@/components/app/shell";

export default function More() {
  const { profile, lang, setLang, signOut, refreshProfile, toast } = useApp();
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [name, setName] = useState(profile!.full_name);
  const [phone, setPhone] = useState(profile!.phone ?? "");
  const [busy, setBusy] = useState(false);

  async function saveProfile() {
    setBusy(true);
    try {
      await rpc("update_my_profile", { p_full_name: name, p_phone: phone });
      await refreshProfile();
      setEditOpen(false);
      toast("Profile updated", "success");
    } catch (e) {
      toast(toAppError(e).message, "error");
    } finally {
      setBusy(false);
    }
  }

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
          <Button variant="secondary" size="sm" onClick={() => setEditOpen(true)}>Edit</Button>
        </Card>

        {profile!.role !== "student" && (
          <ListGroup>
            <ListRow href={homeFor(profile!.role)} icon={<LayoutDashboard className="size-[18px]" />} title={`Back to ${profile!.role} dashboard`} />
          </ListGroup>
        )}

        <Section title="Field">
          <ListGroup>
            <ListRow href="/s/more/customers" icon={<Users className="size-[18px]" />} title="My customers" />
            <ListRow href="/s/more/follow-ups" icon={<CalendarCheck className="size-[18px]" />} title="Follow-ups" />
            <ListRow href="/s/more/sessions" icon={<Clock className="size-[18px]" />} title="Work sessions" />
            <ListRow href="/s/more/pending" icon={<CloudUpload className="size-[18px]" />} title="Sync status" subtitle="Transactions saved on this phone" />
          </ListGroup>
        </Section>

        <Section title="Privacy">
          <ListGroup>
            <ListRow onClick={async () => {
              try {
                const data = await rpc<unknown>("export_my_data");
                const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
                const a = document.createElement("a");
                a.href = URL.createObjectURL(blob);
                a.download = `yes-my-data-${new Date().toISOString().slice(0, 10)}.json`;
                a.click();
                URL.revokeObjectURL(a.href);
              } catch (e) { toast(toAppError(e).message, "error"); }
            }} icon={<Download className="size-[18px]" />} title="Download my data" subtitle="A copy of everything YES stores about you" />
            <ListRow href="/privacy" icon={<ShieldCheck className="size-[18px]" />} title="Privacy notice" />
          </ListGroup>
        </Section>

        <Section title="Language">
          <Segmented value={lang} onChange={setLang} options={LANGS.map((l) => ({ value: l.code, label: l.label }))} />
          <p className="flex items-center gap-1.5 px-1 text-xs text-subtle"><Globe className="size-3.5" /> Arabic switches the layout to right-to-left.</p>
        </Section>

        <Button variant="secondary" size="lg" block className="text-danger" onClick={async () => { await signOut(); router.replace("/"); }}>
          <LogOut className="size-5" /> Sign out
        </Button>
        <p className="pb-4 text-center text-xs text-subtle">YES Canvassing App · Youth Education Scholarship</p>
      </div>

      <Sheet open={editOpen} onClose={() => setEditOpen(false)} title={<span className="inline-flex items-center gap-2"><UserRound className="size-5" /> My profile</span>}
        footer={<Button block size="lg" loading={busy} onClick={saveProfile}>Save</Button>}>
        <div className="space-y-3 pb-2">
          <Field label="Full name" value={name} onChange={(e) => setName(e.target.value)} />
          <Field label="Phone" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <p className="px-1 text-xs text-subtle">Your role and team can only be changed by an admin.</p>
        </div>
      </Sheet>
    </>
  );
}
