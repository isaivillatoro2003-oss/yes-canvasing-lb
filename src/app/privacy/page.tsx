"use client";

import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { useApp } from "@/lib/app-context";
import { Card } from "@/components/ui";

/**
 * Privacy notice — Lebanon Law No. 81/2018 (Electronic Transactions and Personal Data), Part V.
 * Art. 88 requires telling people, at collection: who is responsible, why the data is processed,
 * which answers are mandatory, what happens if they don't answer, who receives the data, and
 * how to access and correct it. Each section below maps to one of those points.
 */
function H({ children }: { children: React.ReactNode }) {
  return <h2 className="text-headline mt-8 mb-2">{children}</h2>;
}

export default function Privacy() {
  const { settings } = useApp();
  const controller = settings.data_controller || settings.org_name;
  const contact = settings.privacy_contact;
  const years = settings.retention_years ?? 5;

  return (
    <main className="app-height safe-top safe-bottom bg-bg">
      <div className="mx-auto max-w-2xl px-6 pb-16">
        <div className="flex h-12 items-center">
          <Link href="/" className="pressable -ms-2 inline-flex items-center gap-0.5 rounded-xl px-2 py-1 text-[15px] font-medium text-muted">
            <ChevronLeft className="size-5 rtl:rotate-180" /> Back
          </Link>
        </div>
        <h1 className="text-title mt-2">Privacy Notice</h1>
        <p className="mt-2 text-muted">How the YES Canvassing App uses personal data, under Lebanese Law No. 81/2018 on Electronic Transactions and Personal Data.</p>

        <Card className="mt-6 p-5 text-[15px] leading-relaxed">
          <H>1. Who is responsible</H>
          <p>The data controller is <b>{controller}</b>.{" "}
            {contact ? <>Contact for anything about your data: <b>{contact}</b>.</> : <>Contact your YES leader, who forwards your request to the program administrator.</>}</p>

          <H>2. Why we process data</H>
          <ul className="list-disc space-y-1 ps-5">
            <li>Running the scholarship canvassing program: registering participants, organising teams and work time.</li>
            <li>Managing the books entrusted to each student, the sales, donations and payments, and the daily reconciliation of books and money.</li>
            <li>Calculating program results and each student&apos;s scholarship progress.</li>
            <li>Optional follow-up with people who asked to be contacted again.</li>
          </ul>
          <p className="mt-2">Data is not sold, not used for advertising and not used for any other purpose.</p>

          <H>3. What we collect: mandatory and optional</H>
          <ul className="list-disc space-y-1 ps-5">
            <li><b>Participants (mandatory):</b> full name, email, password (stored only as a secure hash by our authentication provider) and the access code. Without them an account cannot be created.</li>
            <li><b>Participants (optional):</b> phone number.</li>
            <li><b>Activity (created by using the app):</b> work start/stop times, presentations count, books assigned and distributed, transactions, donations, payments and reconciliations.</li>
            <li><b>Location during work:</b> the phone&apos;s position (and the city/neighborhood it corresponds to) when a student starts, pauses, resumes or stops work, with each sale, and about every 10 minutes while the app is open during a work session. It is used to verify field hours and organise territories. It is <b>never</b> collected outside a work session, and the student can see when it is recorded. Place names come from OpenStreetMap.</li>
            <li><b>People visited (optional):</b> name, city/neighborhood and notes. Phone, WhatsApp and email are stored <b>only</b> if the person explicitly agreed to be contacted; otherwise the app discards them.</li>
          </ul>
          <p className="mt-2">We do not collect health, genetic or sexual-life information. Please do <b>not</b> write such details in any notes field.</p>

          <H>4. Who can see the data</H>
          <ul className="list-disc space-y-1 ps-5">
            <li>Each student sees only their own data.</li>
            <li>Leaders see only the students of their own team.</li>
            <li>Program administrators see all data, to manage and audit the program.</li>
            <li>Technical providers that host the app under contract: Supabase (database and sign-in, servers in Frankfurt, Germany) and Vercel (web hosting). They process data only to run the service.</li>
          </ul>
          <p className="mt-2">Every sensitive action (role changes, inventory adjustments, price changes, approvals, data erasure) is recorded in an audit log.</p>

          <H>5. How long we keep it</H>
          <p>Program and financial records are kept for <b>{years} year{years === 1 ? "" : "s"}</b> after the end of the campaign they belong to, then deleted or anonymised. Accounts are deactivated (not deleted) when someone leaves, so financial records stay complete.</p>

          <H>6. Your rights</H>
          <ul className="list-disc space-y-1 ps-5">
            <li><b>Access and copy:</b> download all your data any time from <i>More → Download my data</i>.</li>
            <li><b>Correction:</b> edit your name and phone in <i>More → Edit</i>; ask an administrator for anything else.</li>
            <li><b>Erasure and objection:</b> ask an administrator. Requests are handled free of charge within 10 days, as the law requires. Financial records that must be kept are anonymised instead of deleted.</li>
          </ul>
          <p className="mt-2">If you are a person who was visited and want your data removed, contact the organisation or the student&apos;s leader.</p>

          <H>7. Security</H>
          <p>Access is protected by role-based rules enforced in the database itself, encrypted connections (HTTPS), secure password storage, and a strict content security policy in the app.</p>

          <p className="mt-8 text-sm text-subtle">Last updated: October 2026.</p>
        </Card>
      </div>
    </main>
  );
}
