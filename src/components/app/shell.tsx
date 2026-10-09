"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  BarChart3, BookOpen, CloudOff, Home, LayoutDashboard, MoreHorizontal, Plus, RefreshCw, Settings, Users, Wallet, ChevronLeft,
} from "lucide-react";
import { useApp, useRequireRole } from "@/lib/app-context";
import { rpc, toAppError } from "@/lib/supabase";
import { subscribeQueue, type QueuedTx } from "@/lib/sync";
import { cn } from "@/lib/format";
import type { Role } from "@/lib/types";
import type { TKey } from "@/lib/i18n";
import { Button, PageLoader, Sheet } from "@/components/ui";
import { LocationPinger } from "./location-pinger";

export function Logo({ size = 40, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} role="img" aria-label="YES">
      <rect width="64" height="64" rx="16" fill="#0B1F3A" />
      <path d="M14 46c6-4 12-4 18 0 6-4 12-4 18 0" stroke="#C79A3A" strokeWidth="3" fill="none" strokeLinecap="round" />
      <text x="32" y="36" textAnchor="middle" fontFamily="system-ui,-apple-system,Segoe UI,Roboto,sans-serif"
        fontWeight="800" fontSize="21" letterSpacing="-0.5" fill="#F6F1E7">YES</text>
    </svg>
  );
}

type Tab = { href: string; key: TKey; icon: React.ComponentType<{ className?: string }>; exact?: boolean; primary?: boolean };

const TABS: Record<Role, Tab[]> = {
  student: [
    { href: "/s", key: "nav.home", icon: Home, exact: true },
    { href: "/s/add", key: "nav.add", icon: Plus, primary: true },
    { href: "/s/inventory", key: "nav.inventory", icon: BookOpen },
    { href: "/s/reports", key: "nav.reports", icon: BarChart3 },
    { href: "/s/more", key: "nav.more", icon: MoreHorizontal },
  ],
  leader: [
    { href: "/l", key: "nav.dashboard", icon: LayoutDashboard, exact: true },
    { href: "/l/team", key: "nav.team", icon: Users },
    { href: "/l/inventory", key: "nav.inventory", icon: BookOpen },
    { href: "/l/reports", key: "nav.reports", icon: BarChart3 },
    { href: "/l/more", key: "nav.more", icon: MoreHorizontal },
  ],
  admin: [
    { href: "/a", key: "nav.dashboard", icon: LayoutDashboard, exact: true },
    { href: "/a/users", key: "nav.users", icon: Users },
    { href: "/a/inventory", key: "nav.inventory", icon: BookOpen },
    { href: "/a/finance", key: "nav.finance", icon: Wallet },
    { href: "/a/settings", key: "nav.settings", icon: Settings },
  ],
};

function TabBar({ role }: { role: Role }) {
  const pathname = usePathname();
  const { t } = useApp();
  const tabs = TABS[role];
  return (
    <nav className="material fixed inset-x-0 bottom-0 z-40 border-t border-line safe-bottom" aria-label="Main">
      <ul className="mx-auto flex max-w-lg items-stretch justify-around px-2">
        {tabs.map((tab) => {
          const active = tab.exact ? pathname === tab.href : pathname === tab.href || pathname.startsWith(tab.href + "/");
          const Icon = tab.icon;
          return (
            <li key={tab.href} className="flex-1">
              <Link href={tab.href} aria-current={active ? "page" : undefined}
                className={cn("pressable flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-semibold no-select",
                  active ? "text-fg" : "text-subtle")}>
                {tab.primary ? (
                  <span className={cn("grid size-9 place-items-center rounded-2xl", active ? "bg-primary text-primary-fg" : "bg-primary/90 text-primary-fg")}>
                    <Icon className="size-5" />
                  </span>
                ) : (
                  <Icon className={cn("size-6", active && "stroke-[2.25]")} />
                )}
                {!tab.primary && <span>{t(tab.key)}</span>}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Shows "Waiting to sync" / "Synced" and offline state in the header. */
export function SyncPill() {
  const { online, t } = useApp();
  const [queue, setQueue] = useState<QueuedTx[]>([]);
  useEffect(() => subscribeQueue(setQueue), []);
  const failed = queue.filter((q) => q.failed).length;
  const waiting = queue.length - failed;
  if (failed) {
    return <Link href="/s/more/pending" className="pressable inline-flex items-center gap-1.5 rounded-full bg-danger-bg px-3 py-1 text-xs font-semibold text-danger">
      {failed} need attention
    </Link>;
  }
  if (waiting) {
    return <Link href="/s/more/pending" className="pressable inline-flex items-center gap-1.5 rounded-full bg-warning-bg px-3 py-1 text-xs font-semibold text-warning">
      <RefreshCw className="size-3.5 animate-spin [animation-duration:2s]" /> {waiting} · {t("sync.waiting")}
    </Link>;
  }
  if (!online) {
    return <span className="inline-flex items-center gap-1.5 rounded-full bg-sunken px-3 py-1 text-xs font-semibold text-muted">
      <CloudOff className="size-3.5" /> {t("sync.offline")}
    </span>;
  }
  return <span className="inline-flex items-center gap-1.5 rounded-full px-1 py-1 text-xs font-medium text-subtle">
    <span className="size-1.5 rounded-full bg-success" /> {t("sync.synced")}
  </span>;
}

export function AppShell({ roles, children, tabRole }: { roles: Role[]; children: React.ReactNode; tabRole?: Role }) {
  const { ready, online } = useApp();
  const { allowed, profile } = useRequireRole(roles);
  if (!ready || !allowed) return <div className="app-height bg-bg"><PageLoader /></div>;
  return (
    <div className="app-height bg-bg">
      {!online && (
        <div className="safe-top sticky top-0 z-30 bg-warning-bg text-center text-xs font-semibold text-warning">
          <div className="py-1.5">Offline — sales are saved on this phone and sync automatically</div>
        </div>
      )}
      <main className="pb-tabbar mx-auto max-w-lg">{children}</main>
      <TabBar role={tabRole ?? profile?.role ?? "student"} />
      <PrivacyGate />
      <LocationPinger />
    </div>
  );
}

/** Large-title header, Apple style. */
export function PageHeader({ title, subtitle, back, action, showSync = true }: {
  title: React.ReactNode; subtitle?: React.ReactNode; back?: string | true; action?: React.ReactNode; showSync?: boolean;
}) {
  const router = useRouter();
  return (
    <header className="safe-top px-5 pb-3">
      <div className="flex h-11 items-center justify-between gap-2">
        {back ? (
          <button type="button"
            onClick={() => (back === true ? router.back() : router.push(back))}
            className="pressable -ms-2 inline-flex items-center gap-0.5 rounded-xl px-2 py-1 text-[15px] font-medium text-muted">
            <ChevronLeft className="size-5 rtl:rotate-180" /> Back
          </button>
        ) : showSync ? <SyncPill /> : <span />}
        <div className="flex items-center gap-2">{action}</div>
      </div>
      <h1 className="text-title mt-1">{title}</h1>
      {subtitle && <p className="mt-1 text-[15px] text-muted">{subtitle}</p>}
    </header>
  );
}

/** Accounts created before the privacy notice existed accept it once (Lebanon Law 81/2018, Art. 88). */
function PrivacyGate() {
  const { profile, refreshProfile, toast } = useApp();
  const [busy, setBusy] = useState(false);
  // null = column exists and nothing recorded yet; undefined = database not migrated yet (don't nag)
  const open = !!profile && profile.privacy_accepted_at === null;
  async function accept() {
    setBusy(true);
    try { await rpc("accept_privacy"); await refreshProfile(); }
    catch (e) { toast(toAppError(e).message, "error"); }
    finally { setBusy(false); }
  }
  return (
    <Sheet open={open} onClose={() => {}} title="Privacy notice"
      footer={<Button block size="lg" loading={busy} onClick={accept}>I agree</Button>}>
      <p className="pb-2 text-muted">
        YES uses your name, contact details and program activity only to run the canvassing program. Your leader and the
        program administrators can see it. You can download, correct or ask to erase your data at any time.{" "}
        <Link href="/privacy" className="font-semibold text-fg underline">Read the full notice</Link>.
      </p>
    </Sheet>
  );
}
