"use client";

import { useState } from "react";
import { FlaskConical, LogOut, RotateCcw } from "lucide-react";
import { useApp, homeFor } from "@/lib/app-context";
import { demoPerspective, leaveDemo, setDemoPerspective } from "@/lib/demo/state";
import { cn } from "@/lib/format";
import type { Role } from "@/lib/types";
import { Button, Sheet } from "@/components/ui";

const VIEWS: { role: Role; label: string; who: string }[] = [
  { role: "student", label: "Student", who: "Maya Khoury" },
  { role: "leader", label: "Leader", who: "Rami Haddad" },
  { role: "admin", label: "Admin", who: "Demo Admin" },
];

/** Always-visible demo banner: what this is, perspective switcher, reset, exit. */
export function DemoBar() {
  const { profile } = useApp();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const current = profile?.role ?? demoPerspective();

  // A clean reload into the other role's home avoids any half-switched screen.
  function switchTo(role: Role) {
    if (role === current) return;
    setDemoPerspective(role);
    window.location.assign(homeFor(role));
  }

  async function reset() {
    setBusy(true);
    const { resetDemo } = await import("@/lib/demo/runtime");
    await resetDemo();
    window.location.assign(homeFor(current));
  }

  return (
    <>
      <div className="safe-top sticky top-0 z-30 bg-[var(--gold-500)] text-[var(--navy-900)]">
        <div className="mx-auto flex max-w-lg items-center gap-2 px-3 py-1.5">
          <button type="button" onClick={() => setOpen(true)} className="pressable inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--navy-900)] px-2.5 py-1 text-[11px] font-bold tracking-wide text-[var(--cream-100)]">
            <FlaskConical className="size-3.5" /> DEMO
          </button>
          <div role="tablist" aria-label="Demo perspective" className="flex flex-1 gap-1 rounded-xl bg-black/10 p-0.5">
            {VIEWS.map((v) => (
              <button key={v.role} role="tab" type="button" aria-selected={current === v.role} onClick={() => switchTo(v.role)}
                className={cn("pressable h-7 flex-1 rounded-lg text-xs font-semibold", current === v.role ? "bg-[var(--cream-100)] shadow-sm" : "opacity-80")}>
                {v.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <Sheet open={open} onClose={() => setOpen(false)} title="You're in the demo"
        footer={<div className="flex gap-2">
          <Button variant="secondary" block loading={busy} onClick={reset}><RotateCcw className="size-4" /> Reset demo</Button>
          {/* eslint-disable-next-line @next/next/no-location-assign-relative-destination -- full reload restarts the demo engine */}
          <Button variant="secondary" block className="text-danger" onClick={() => { leaveDemo(); window.location.assign("/"); }}>
            <LogOut className="size-4" /> Exit demo
          </Button>
        </div>}>
        <div className="space-y-3 pb-2 text-[15px]">
          <p>Everything here is a simulation that runs <b>only in this browser</b>. People, books, sales and locations are fictional, and nothing you do reaches the real YES app.</p>
          <p>Switch perspective with the tabs at the top:</p>
          <ul className="space-y-1.5">
            {VIEWS.map((v) => (
              <li key={v.role} className="flex justify-between rounded-xl bg-sunken px-3 py-2 text-sm">
                <span className="font-semibold">{v.label}</span><span className="text-muted">{v.who}</span>
              </li>
            ))}
          </ul>
          <p className="text-sm text-muted">Reset demo brings back the original example data. Closing this tab ends the demo.</p>
        </div>
      </Sheet>
    </>
  );
}
