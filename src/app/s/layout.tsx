"use client";

import { AppShell } from "@/components/app/shell";

const ROLES = ["student", "leader", "admin"] as const;

/** Field screens. Leaders and admins can canvass too, so they may use them. */
export default function StudentLayout({ children }: { children: React.ReactNode }) {
  return <AppShell roles={[...ROLES]} tabRole="student">{children}</AppShell>;
}
