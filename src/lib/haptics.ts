"use client";

/** A light tap on phones that support it (Android). Silent everywhere else. */
export function haptic(kind: "light" | "success" | "warning" = "light") {
  try {
    if (typeof navigator === "undefined" || !("vibrate" in navigator)) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    navigator.vibrate(kind === "success" ? [12, 40, 18] : kind === "warning" ? [20, 60, 20] : 10);
  } catch { /* not supported */ }
}
