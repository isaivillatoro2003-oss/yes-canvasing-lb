"use client";

import { useState } from "react";
import { BarChart3, BookOpen, CalendarCheck, ClipboardCheck, Footprints, KeyRound, LogOut, MapPin, ScrollText, UsersRound } from "lucide-react";
import { useApp } from "@/lib/app-context";
import { sb, toAppError } from "@/lib/supabase";
import type { Lang } from "@/lib/types";
import { Button, Card, Field, ListGroup, ListRow, Notice, Section, Segmented, Toggle } from "@/components/ui";
import { PageHeader } from "@/components/app/shell";

const METHODS = [
  { key: "cash", label: "Cash" },
  { key: "whish", label: "Whish Money" },
  { key: "other", label: "Other" },
];

export default function AdminSettings() {
  const { settings, toast, refreshSettings, signOut } = useApp();
  const [form, setForm] = useState({
    org_name: settings.org_name,
    currency: settings.currency,
    timezone: settings.timezone,
    default_language: settings.default_language,
    allow_multiple_sessions: settings.allow_multiple_sessions,
    collect_contacts: settings.collect_contacts,
    donations_enabled: settings.donations_enabled,
    payment_methods: settings.payment_methods,
    access_code_prefix: settings.access_code_prefix,
    access_code_default_days: String(settings.access_code_default_days),
    campaign_start_date: settings.campaign_start_date ?? "",
    data_controller: settings.data_controller,
    privacy_contact: settings.privacy_contact ?? "",
    retention_years: String(settings.retention_years),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setMethod(key: string, on: boolean) {
    const next = on ? [...form.payment_methods, key] : form.payment_methods.filter((m) => m !== key);
    if (next.length === 0) return toast("At least one payment method must stay on", "error");
    setForm({ ...form, payment_methods: METHODS.map((m) => m.key).filter((k) => next.includes(k)) });
  }

  async function save() {
    setError(null);
    const currency = form.currency.trim().toUpperCase();
    const days = parseInt(form.access_code_default_days, 10);
    if (!form.org_name.trim()) return setError("Enter the organization name.");
    if (!/^[A-Z]{3}$/.test(currency)) return setError("Currency must be a 3-letter code such as USD.");
    try {
      new Intl.DateTimeFormat("en", { timeZone: form.timezone.trim() });
    } catch {
      return setError("That timezone is not valid. Example: Asia/Beirut.");
    }
    if (!Number.isFinite(days) || days < 1) return setError("Default code validity must be at least 1 day.");
    if (!form.access_code_prefix.trim()) return setError("Enter an access code prefix.");
    const years = parseInt(form.retention_years, 10);
    if (!Number.isFinite(years) || years < 1 || years > 20) return setError("Data retention must be between 1 and 20 years.");
    if (!form.data_controller.trim()) return setError("Enter who is responsible for the data (data controller).");
    setBusy(true);
    try {
      const { error: err } = await sb().from("app_settings").update({
        org_name: form.org_name.trim(), currency, timezone: form.timezone.trim(), default_language: form.default_language,
        allow_multiple_sessions: form.allow_multiple_sessions, collect_contacts: form.collect_contacts, donations_enabled: form.donations_enabled,
        payment_methods: form.payment_methods, access_code_prefix: form.access_code_prefix.trim().toUpperCase(),
        access_code_default_days: days, campaign_start_date: form.campaign_start_date || null,
        data_controller: form.data_controller.trim(), privacy_contact: form.privacy_contact.trim() || null, retention_years: years, updated_at: new Date().toISOString(),
      }).eq("id", 1);
      if (err) throw toAppError(err);
      await refreshSettings();
      toast("Settings saved", "success");
    } catch (e) {
      toast(toAppError(e).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Settings" />
      <div className="space-y-6 px-5">
        <Section title="Manage">
          <ListGroup>
            <ListRow href="/a/codes" icon={<KeyRound className="size-4" />} title="Access Codes" />
            <ListRow href="/a/teams" icon={<UsersRound className="size-4" />} title="Teams" />
            <ListRow href="/a/books" icon={<BookOpen className="size-4" />} title="Books" />
            <ListRow href="/a/territories" icon={<MapPin className="size-4" />} title="Territories" />
            <ListRow href="/a/follow-ups" icon={<CalendarCheck className="size-4" />} title="Follow-ups" />
            <ListRow href="/a/audit" icon={<ScrollText className="size-4" />} title="Audit Log" />
            <ListRow href="/l/reports" icon={<BarChart3 className="size-4" />} title="Reports" />
            <ListRow href="/l/reconcile" icon={<ClipboardCheck className="size-4" />} title="Reconciliation" />
            <ListRow href="/s" icon={<Footprints className="size-4" />} title="Field mode" subtitle="Record my own sales" />
          </ListGroup>
        </Section>

        <Section title="Organization">
          <Card className="space-y-3 p-4">
            {error && <Notice tone="danger">{error}</Notice>}
            <Field label="Organization name" value={form.org_name} onChange={(e) => setForm({ ...form, org_name: e.target.value })} />
            <div className="grid grid-cols-2 gap-3">
              <Field label="Currency" maxLength={3} autoCapitalize="characters" value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })} />
              <Field label="Timezone" value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} />
            </div>
            <div>
              <span className="mb-1.5 block px-1 text-sm font-medium text-muted">Default language</span>
              <Segmented<Lang> value={form.default_language} onChange={(v) => setForm({ ...form, default_language: v })}
                options={[{ value: "en", label: "English" }, { value: "fr", label: "Français" }, { value: "ar", label: "العربية" }]} />
            </div>
            <div className="-mx-4 divide-y divide-line">
              <Toggle label="Allow multiple sessions" description="Let one student have more than one active session" checked={form.allow_multiple_sessions}
                onChange={(v) => setForm({ ...form, allow_multiple_sessions: v })} />
              <Toggle label="Collect customer contacts" checked={form.collect_contacts} onChange={(v) => setForm({ ...form, collect_contacts: v })} />
              <Toggle label="Donations enabled" checked={form.donations_enabled} onChange={(v) => setForm({ ...form, donations_enabled: v })} />
            </div>
            <div>
              <span className="mb-1 block px-1 text-sm font-medium text-muted">Payment methods</span>
              <div className="-mx-4 divide-y divide-line">
                {METHODS.map((m) => (
                  <Toggle key={m.key} label={m.label} checked={form.payment_methods.includes(m.key)} onChange={(v) => setMethod(m.key, v)} />
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Access code prefix" autoCapitalize="characters" value={form.access_code_prefix}
                onChange={(e) => setForm({ ...form, access_code_prefix: e.target.value.toUpperCase() })} />
              <Field label="Code validity (days)" inputMode="numeric" value={form.access_code_default_days}
                onChange={(e) => setForm({ ...form, access_code_default_days: e.target.value.replace(/\D/g, "") })} />
            </div>
            <Field label="Campaign start date" type="date" value={form.campaign_start_date} onChange={(e) => setForm({ ...form, campaign_start_date: e.target.value })} />
            <div className="space-y-3 rounded-2xl bg-sunken p-4">
              <p className="text-sm font-semibold">Privacy (Lebanon Law 81/2018)</p>
              <Field label="Data controller (organisation responsible)" value={form.data_controller} maxLength={120}
                onChange={(e) => setForm({ ...form, data_controller: e.target.value })} />
              <Field label="Privacy contact (email or phone)" value={form.privacy_contact} maxLength={120}
                hint="Shown in the privacy notice so people can ask for a copy, correction or erasure of their data."
                onChange={(e) => setForm({ ...form, privacy_contact: e.target.value })} />
              <Field label="Keep records for (years)" inputMode="numeric" value={form.retention_years}
                onChange={(e) => setForm({ ...form, retention_years: e.target.value.replace(/\D/g, "") })} />
            </div>
            <Button block size="lg" loading={busy} onClick={save}>Save settings</Button>
          </Card>
        </Section>

        <Button block variant="secondary" size="lg" onClick={() => { void signOut(); }}><LogOut className="size-5" /> Sign out</Button>
      </div>
    </>
  );
}
