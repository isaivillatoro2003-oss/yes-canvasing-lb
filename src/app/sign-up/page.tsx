"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, KeyRound } from "lucide-react";
import { useApp, homeFor } from "@/lib/app-context";
import { rpc, sb, toAppError } from "@/lib/supabase";
import { Button, Field, Notice } from "@/components/ui";
import { AuthFrame } from "@/components/app/auth-frame";

const CODE_MESSAGES: Record<string, string> = {
  invalid: "Invalid access code. Please contact your YES leader.",
  expired: "This access code has expired.",
  used: "This access code has already been used.",
};

export default function SignUpPage() {
  const router = useRouter();
  const { refreshProfile } = useApp();
  const [code, setCode] = useState("");
  const [verified, setVerified] = useState(false);
  const [checking, setChecking] = useState(false);
  const [form, setForm] = useState({ full_name: "", email: "", phone: "", password: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsConfirm, setNeedsConfirm] = useState(false);

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setChecking(true);
    setError(null);
    try {
      const status = await rpc<string>("check_access_code", { p_code: code.trim() });
      if (status === "valid") setVerified(true);
      else setError(CODE_MESSAGES[status] ?? CODE_MESSAGES.invalid);
    } catch (err) {
      setError(toAppError(err).message);
    } finally {
      setChecking(false);
    }
  }

  async function register(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (form.full_name.trim().length < 2) return setError("Please enter your full name.");
    if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) return setError("Please enter a valid email.");
    if (form.password.length < 8) return setError("Password must be at least 8 characters.");
    setBusy(true);
    try {
      const { data, error: authError } = await sb().auth.signUp({
        email: form.email.trim(),
        password: form.password,
        options: {
          data: { full_name: form.full_name.trim(), phone: form.phone.trim(), access_code: code.trim().toUpperCase() },
          emailRedirectTo: `${location.origin}/sign-in`,
        },
      });
      if (authError) {
        // The database rejected the sign-up: find out exactly why, for a clear message.
        const status = await rpc<string>("check_access_code", { p_code: code.trim() }).catch(() => "invalid");
        if (status !== "valid") {
          setVerified(false);
          setError(CODE_MESSAGES[status] ?? CODE_MESSAGES.invalid);
        } else {
          setError(/registered|exists/i.test(authError.message) ? "An account with this email already exists. Try signing in." : authError.message);
        }
        return;
      }
      if (!data.session) { setNeedsConfirm(true); return; }
      await rpc("touch_login");
      await refreshProfile();
      router.replace(homeFor("student"));
    } catch (err) {
      setError(toAppError(err).message);
    } finally {
      setBusy(false);
    }
  }

  if (needsConfirm) {
    return (
      <AuthFrame title="Check your email" subtitle={`We sent a confirmation link to ${form.email}. Open it, then sign in.`}>
        <Link href="/sign-in" className="pressable flex h-14 items-center justify-center rounded-2xl bg-primary font-semibold text-primary-fg">Go to Sign In</Link>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame title="Create Account" subtitle={verified ? "Tell us who you are." : "Start with the access code your YES leader gave you."}
      footer={<>Already have an account? <Link href="/sign-in" className="font-semibold text-fg">Sign in</Link></>}>
      {!verified ? (
        <form onSubmit={verify} className="space-y-4" noValidate>
          <Field label="Student Access Code" placeholder="YES-XXXXXX" autoCapitalize="characters" autoCorrect="off" autoComplete="off"
            spellCheck={false} enterKeyHint="next" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
          {error && <Notice tone="danger">{error}</Notice>}
          <Button type="submit" size="lg" block loading={checking} disabled={code.trim().length < 4}>
            <KeyRound className="size-5" /> Verify code
          </Button>
        </form>
      ) : (
        <form onSubmit={register} className="space-y-4" noValidate>
          <Notice tone="success">
            <span className="inline-flex items-center gap-2"><CheckCircle2 className="size-4" /> Access Code Verified · {code}</span>
          </Notice>
          <Field label="Full Name" autoComplete="name" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
          <Field label="Email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" autoCorrect="off"
            value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <Field label="Phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="+961"
            value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <Field label="Password" type="password" autoComplete="new-password" hint="At least 8 characters"
            value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          {error && <Notice tone="danger">{error}</Notice>}
          <Button type="submit" size="lg" block loading={busy}>Create Account</Button>
          <button type="button" onClick={() => { setVerified(false); setError(null); }}
            className="pressable block w-full py-2 text-center text-sm font-medium text-muted">Use a different code</button>
        </form>
      )}
    </AuthFrame>
  );
}
