"use client";

import { AppShell } from "@/components/app/shell";
import type { Role } from "@/lib/types";

const ROLES: Role[] = ["leader", "admin"];

/** Leader screens. Admins can open them too (with their own tab bar). */
export default function LeaderLayout({ children }: { children: React.ReactNode }) {
  return <AppShell roles={ROLES}>{children}</AppShell>;
}
