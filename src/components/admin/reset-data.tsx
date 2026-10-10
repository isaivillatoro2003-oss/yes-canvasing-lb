"use client";

import { useState } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { useApp } from "@/lib/app-context";
import { rpc, sb, toAppError } from "@/lib/supabase";
import { isDemo } from "@/lib/demo/state";
import { Button, Card, Field, Notice, Sheet } from "@/components/ui";

/**
 * Danger zone: wipe all field activity and set every stock count to 0.
 * Needs the admin's password and typing RESET; the audit log keeps a record.
 */
export function ResetData() {
  const { profile, toast } = useApp();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [word, setWord] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const demo = isDemo();

  async function run() {
    setError(null);
    setBusy(true);
    try {
      if (!demo) {
        const { error: err } = await sb().auth.signInWithPassword({ email: profile!.email, password });
        if (err) { setError("Wrong password."); return; }
      }
      const counts = await rpc<Record<string, number>>("admin_reset_data", { p_confirm: word.trim() });
      setOpen(false); setPassword(""); setWord("");
      toast(`Data reset: ${counts.transactions ?? 0} transactions and ${counts.work_sessions ?? 0} work sessions removed.`, "success");
      setTimeout(() => window.location.reload(), 1200);
    } catch (e) {
      setError(toAppError(e).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Card className="space-y-3 border border-danger/30 p-4">
        <div className="flex items-center gap-2 font-semibold text-danger"><AlertTriangle className="size-4" /> Danger zone</div>
        <p className="text-sm text-muted">Start a new campaign from zero: deletes all sales, payments, donations, work sessions, locations,
          customers, follow-ups and reconciliations, and sets every book stock to 0.</p>
        <Button variant="secondary" block className="text-danger" onClick={() => setOpen(true)}><RotateCcw className="size-4" /> Reset all data</Button>
      </Card>

      <Sheet open={open} onClose={() => setOpen(false)} title="Reset all data?"
        footer={<Button variant="danger" block size="lg" loading={busy} disabled={word.trim() !== "RESET" || (!demo && !password)} onClick={run}>Reset everything</Button>}>
        <div className="space-y-3 pb-2 text-sm">
          <Notice tone="danger">This cannot be undone. Download the reports you need first.</Notice>
          <div>
            <p className="font-semibold">Deleted</p>
            <p className="text-muted">Transactions, payments, donations, work sessions and locations, inventory movements and student inventory,
              customers, follow-ups, reconciliations. Warehouse stock goes to 0.</p>
          </div>
          <div>
            <p className="font-semibold">Kept</p>
            <p className="text-muted">Users and roles, teams, the book catalog and prices, territories, settings, access and demo codes, and the audit log
              (which records this reset).</p>
          </div>
          {!demo && <Field label="Your password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
          <Field label="Type RESET to confirm" autoCapitalize="characters" autoComplete="off" value={word} onChange={(e) => setWord(e.target.value.toUpperCase())} />
          {error && <Notice tone="danger">{error}</Notice>}
        </div>
      </Sheet>
    </>
  );
}
