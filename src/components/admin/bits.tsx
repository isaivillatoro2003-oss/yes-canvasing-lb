"use client";

import { Search } from "lucide-react";

export function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <label className="relative block">
      <Search className="pointer-events-none absolute start-4 top-1/2 size-4 -translate-y-1/2 text-subtle" aria-hidden />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder}
        className="h-12 w-full rounded-2xl bg-elevated ps-11 pe-4 text-[16px] shadow-card ring-1 ring-line outline-none placeholder:text-subtle focus:ring-2 focus:ring-[var(--navy-500)]" />
    </label>
  );
}

/** Label / value line used inside detail sheets. */
export function DetailLine({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 px-4 py-3">
      <span className="text-sm text-muted">{label}</span>
      <span className="min-w-0 break-words text-end text-sm font-medium">{value}</span>
    </div>
  );
}

/** Unwraps a Supabase { data, error } result or throws. */
export function unwrap<T>(res: { data: unknown; error: unknown }, toErr: (e: unknown) => Error): T {
  if (res.error) throw toErr(res.error);
  return res.data as T;
}
