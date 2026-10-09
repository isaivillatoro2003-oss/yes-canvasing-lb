"use client";

import { useEffect, useState } from "react";
import { Lock } from "lucide-react";
import { useApp } from "@/lib/app-context";
import { sb } from "@/lib/supabase";
import { Button, Card, Field, Notice } from "@/components/ui";
import { PageHeader } from "@/components/app/shell";

const KEY = "yes:reauth-until";
const MINUTES = 10;

function unlockedUntil(): number {
  try { return Number(sessionStorage.getItem(KEY) || 0); } catch { return 0; }
}

/**
 * Sensitive admin areas (access codes, audit log) ask for the admin's password
 * again, so an unlocked phone left on a table doesn't expose them. Unlocks for
 * 10 minutes in this browser tab only. The database still enforces admin-only
 * access on its own; this is an extra layer on the device.
 */
export function ReauthGate({ title, children }: { title: string; children: React.ReactNode }) {
  const { profile } = useApp();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const check = () => setOpen(unlockedUntil() > Date.now());
    check();
    const id = setInterval(check, 15000);
    return () => clearInterval(id);
  }, []);

  async function unlock(e: React.FormEvent) {
    e.preventDefault();
    if (!profile) return;
    setBusy(true);
    setError(null);
    const { error: err } = await sb().auth.signInWithPassword({ email: profile.email, password });
    setBusy(false);
    setPassword("");
    if (err) { setError("Wrong password."); return; }
    try { sessionStorage.setItem(KEY, String(Date.now() + MINUTES * 60000)); } catch { /* private mode: unlock for this view only */ }
    setOpen(true);
  }

  if (open) return <>{children}</>;
  return (
    <>
      <PageHeader back title={title} />
      <div className="px-5">
        <Card className="space-y-4 p-5">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-2xl bg-sunken"><Lock className="size-5" /></span>
            <div>
              <div className="font-semibold">Protected area</div>
              <div className="text-sm text-muted">Enter your password to continue. It stays unlocked for {MINUTES} minutes.</div>
            </div>
          </div>
          <form onSubmit={unlock} className="space-y-3">
            <Field label="Your password" type="password" autoComplete="current-password" value={password}
              onChange={(e) => setPassword(e.target.value)} autoFocus />
            {error && <Notice tone="danger">{error}</Notice>}
            <Button type="submit" block size="lg" loading={busy} disabled={!password}>Unlock</Button>
          </form>
        </Card>
      </div>
    </>
  );
}

/** YES-7KQ3MZ → YES-••••MZ */
export function maskCode(code: string): string {
  const [prefix, rest] = code.includes("-") ? [code.slice(0, code.indexOf("-") + 1), code.slice(code.indexOf("-") + 1)] : ["", code];
  return prefix + "•".repeat(Math.max(0, rest.length - 2)) + rest.slice(-2);
}
