"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { BookOpen, FlaskConical, LayoutDashboard, Users } from "lucide-react";
import { rpc, toAppError, isConfigured } from "@/lib/supabase";
import { enterDemo } from "@/lib/demo/state";
import { homeFor } from "@/lib/app-context";
import type { Role } from "@/lib/types";
import { Button, Field, Notice } from "@/components/ui";
import { AuthFrame } from "@/components/app/auth-frame";

const MESSAGES: Record<string, string> = {
  invalid: "That demo code isn't valid. Ask the YES team for a new one.",
  expired: "This demo code has expired.",
  used: "This demo code has reached its limit.",
};

const VIEWS: { role: Role; title: string; body: string; icon: typeof BookOpen }[] = [
  { role: "student", title: "Student", body: "Start work, record sales, see your books and today's report.", icon: BookOpen },
  { role: "leader", title: "Leader", body: "Watch the team live, assign books, close and approve the day.", icon: Users },
  { role: "admin", title: "Admin", body: "Users, codes, books, stock, finance, settings and audit.", icon: LayoutDashboard },
];

function DemoEntry() {
  const params = useSearchParams();
  const [code, setCode] = useState(params.get("code") ?? "");
  const [step, setStep] = useState<"code" | "pick" | "loading">("code");
  const [error, setError] = useState<string | null>(params.get("failed") ? "The demo couldn't start on this browser. Try again or use a recent Chrome or Safari." : null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");

  async function check(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const status = isConfigured ? await rpc<string>("redeem_demo_code", { p_code: code.trim() }) : "valid";
      if (status === "valid") setStep("pick");
      else setError(MESSAGES[status] ?? MESSAGES.invalid);
    } catch (err) {
      setError(toAppError(err).message);
    } finally {
      setBusy(false);
    }
  }

  async function open(role: Role) {
    setStep("loading");
    try {
      // Build the demo database now, so the first screen opens instantly.
      const { startDemo } = await import("@/lib/demo/runtime");
      await startDemo(setProgress);
      enterDemo(role);
      window.location.assign(homeFor(role));
    } catch (err) {
      console.error(err);
      setStep("pick");
      setError("The demo couldn't start on this browser. Try a recent Chrome or Safari.");
    }
  }

  if (step === "loading") {
    return (
      <AuthFrame title="Preparing the demo" subtitle={progress || "Starting…"}>
        <div className="space-y-3">
          <div className="h-1.5 overflow-hidden rounded-full bg-sunken"><div className="h-full w-1/2 animate-pulse rounded-full bg-primary" /></div>
          <p className="text-sm text-muted">The first time downloads the demo engine (about 15 MB). After that it opens in seconds.</p>
        </div>
      </AuthFrame>
    );
  }

  if (step === "pick") {
    return (
      <AuthFrame title="Choose a perspective" subtitle="You can switch any time from the bar at the top. Nothing you do affects the real app.">
        <div className="space-y-3">
          {VIEWS.map((v) => {
            const Icon = v.icon;
            return (
              <button key={v.role} type="button" onClick={() => open(v.role)}
                className="pressable flex w-full items-center gap-4 rounded-3xl bg-elevated p-4 text-start shadow-card">
                <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-primary text-primary-fg"><Icon className="size-6" /></span>
                <span><span className="block font-semibold">{v.title}</span><span className="block text-sm text-muted">{v.body}</span></span>
              </button>
            );
          })}
          {error && <Notice tone="danger">{error}</Notice>}
        </div>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame title="Try the YES demo" subtitle="A full simulation of the app with example data. Enter the demo code you received.">
      <form onSubmit={check} className="space-y-4" noValidate>
        <Field label="Demo code" placeholder="DEMO-XXXXXX" autoCapitalize="characters" autoCorrect="off" autoComplete="off" spellCheck={false}
          value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
        {error && <Notice tone="danger">{error}</Notice>}
        <Button type="submit" size="lg" block loading={busy} disabled={code.trim().length < 6}>
          <FlaskConical className="size-5" /> Open demo
        </Button>
        <p className="text-center text-xs text-subtle">The demo runs only in your browser. It never creates an account or changes real data.</p>
      </form>
    </AuthFrame>
  );
}

export default function DemoPage() {
  return <Suspense><DemoEntry /></Suspense>;
}
