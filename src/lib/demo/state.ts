"use client";

import type { Role } from "../types";

/**
 * Demo mode lives in sessionStorage: it lasts while this browser tab is open and
 * disappears when the tab is closed, so the real app is never left in demo mode.
 */
const FLAG = "yes:demo";
const AS = "yes:demo-as";
export const DEMO_EVENT = "yes-demo-change";

export function isDemo(): boolean {
  try { return typeof window !== "undefined" && sessionStorage.getItem(FLAG) === "1"; } catch { return false; }
}

export function demoPerspective(): Role {
  try {
    const v = sessionStorage.getItem(AS);
    return v === "leader" || v === "admin" ? v : "student";
  } catch { return "student"; }
}

export function enterDemo(as: Role) {
  sessionStorage.setItem(FLAG, "1");
  sessionStorage.setItem(AS, as);
}

export function setDemoPerspective(as: Role) {
  try { sessionStorage.setItem(AS, as); } catch { /* ignore */ }
  window.dispatchEvent(new Event(DEMO_EVENT));
}

export function leaveDemo() {
  try { sessionStorage.removeItem(FLAG); sessionStorage.removeItem(AS); } catch { /* ignore */ }
}
