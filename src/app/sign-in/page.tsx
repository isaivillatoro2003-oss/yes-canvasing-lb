"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { homeFor, useApp } from "@/lib/app-context";
import { rpc, sb, toAppError } from "@/lib/supabase";
import type { Role } from "@/lib/types";
import { Button, Field, Notice } from "@/components/ui";
import { AuthFrame } from "@/components/app/auth-frame";

function SignInForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { t, refreshProfile, ready, session, profile } = useApp();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(
    params.get("inactive") ? "Your account is inactive. Please contact your YES leader." : null,
  );
  const [resetSent, setResetSent] = useState(false);

  useEffect(() => {
    if (ready && session && profile?.active) router.replace(homeFor(profile.role));
  }, [ready, session, profile, router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { error: authError } = await sb().auth.signInWithPassword({ email: email.trim(), password });
      if (authError) {
        setError(/confirm/i.test(authError.message) ? "Please confirm your email first. Check your inbox." : "Wrong email or password.");
        return;
      }
      const status = await rpc<{ active: boolean; role?: Role; reason?: string }>("touch_login");
      if (!status.active) {
        await sb().auth.signOut();
        setError(status.reason === "inactive"
          ? "Your account is inactive. Please contact your YES leader."
          : "This account has no YES profile. Please contact your YES leader.");
        return;
      }
      await refreshProfile();
      router.replace(homeFor(status.role));
    } catch (err) {
      setError(toAppError(err).message);
    } finally {
      setBusy(false);
    }
  }

  async function forgot() {
    if (!email.trim()) { setError("Type your email first, then tap Forgot password."); return; }
    const { error: e } = await sb().auth.resetPasswordForEmail(email.trim(), { redirectTo: `${location.origin}/reset-password` });
    if (e) setError(e.message);
    else { setResetSent(true); setError(null); }
  }

  return (
    <AuthFrame title={t("auth.signIn")} subtitle="Welcome back. Let's get to work."
      footer={<>New to YES? <Link href="/sign-up" className="font-semibold text-fg">Create an account</Link></>}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Email" type="email" autoComplete="email" inputMode="email" autoCapitalize="none" autoCorrect="off"
          value={email} onChange={(e) => setEmail(e.target.value)} required />
        <Field label="Password" type="password" autoComplete="current-password" enterKeyHint="go"
          value={password} onChange={(e) => setPassword(e.target.value)} required />
        {error && <Notice tone="danger">{error}</Notice>}
        {resetSent && <Notice tone="success">Check your email for a link to reset your password.</Notice>}
        <Button type="submit" size="lg" block loading={busy} disabled={!email || !password}>{t("auth.signIn")}</Button>
        <button type="button" onClick={forgot} className="pressable block w-full py-2 text-center text-sm font-medium text-muted">Forgot password?</button>
      </form>
    </AuthFrame>
  );
}

export default function SignInPage() {
  return <Suspense><SignInForm /></Suspense>;
}
