"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { sb } from "@/lib/supabase";
import { Button, Field, Notice } from "@/components/ui";
import { AuthFrame } from "@/components/app/auth-frame";

export default function ResetPassword() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) return setError("Password must be at least 8 characters.");
    setBusy(true);
    const { error: err } = await sb().auth.updateUser({ password });
    setBusy(false);
    if (err) setError(err.message);
    else router.replace("/home");
  }

  return (
    <AuthFrame title="New password" subtitle="Choose a new password for your YES account.">
      <form onSubmit={submit} className="space-y-4">
        <Field label="New password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <Notice tone="danger">{error}</Notice>}
        <Button type="submit" size="lg" block loading={busy}>Save password</Button>
      </form>
    </AuthFrame>
  );
}
