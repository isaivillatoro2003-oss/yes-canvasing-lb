const moneyFormatters = new Map<string, Intl.NumberFormat>();

export function money(value: number | string | null | undefined, currency = "USD"): string {
  const n = Number(value ?? 0);
  let f = moneyFormatters.get(currency);
  if (!f) {
    try {
      f = new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: 0, maximumFractionDigits: 2 });
    } catch {
      f = new Intl.NumberFormat("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
    }
    moneyFormatters.set(currency, f);
  }
  return f.format(n);
}

export function minutesToLabel(min: number | null | undefined): string {
  const m = Math.max(0, Math.round(Number(min ?? 0)));
  const h = Math.floor(m / 60);
  const r = m % 60;
  return h ? `${h}h ${r}m` : `${r}m`;
}

export function elapsedLabel(fromIso: string, now = Date.now()): string {
  const s = Math.max(0, Math.floor((now - new Date(fromIso).getTime()) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

/** Calendar date (YYYY-MM-DD) in the organisation's timezone. */
export function todayIn(tz = "Asia/Beirut", d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export function shiftDate(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

export function dateLabel(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

export function timeLabel(iso: string | null | undefined, tz = "Asia/Beirut"): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: tz });
}

export function dateTimeLabel(iso: string | null | undefined, tz = "Asia/Beirut"): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: tz });
}

export type Balance = { kind: "balanced" | "underpaid" | "over"; amount: number };

/** Difference = Received − Expected → Balanced / Underpaid / Over */
export function balanceOf(received: number, expected: number): Balance {
  const diff = Math.round((Number(received) - Number(expected)) * 100) / 100;
  if (diff === 0) return { kind: "balanced", amount: 0 };
  return diff < 0 ? { kind: "underpaid", amount: -diff } : { kind: "over", amount: diff };
}

export function methodLabel(m: string): string {
  return m === "cash" ? "Cash" : m === "whish" ? "Whish Money" : m === "other" ? "Other" : m.charAt(0).toUpperCase() + m.slice(1);
}

export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

export function initials(name: string | null | undefined): string {
  return (name ?? "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}
