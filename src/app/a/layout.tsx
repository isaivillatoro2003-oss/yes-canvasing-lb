"use client";

import { AppShell } from "@/components/app/shell";

const ROLES = ["admin"] as const;

/** Admin screens. Only admins get in; everyone else is redirected by AppShell. */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AppShell roles={[...ROLES]} tabRole="admin">{children}</AppShell>;
}
