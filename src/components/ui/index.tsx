"use client";

import Link from "next/link";
import { forwardRef, useEffect, useId, useRef, useState } from "react";
import { AnimatePresence, motion, useDragControls, useReducedMotion } from "motion/react";
import { ChevronRight, Loader2, Minus, Plus, X } from "lucide-react";
import { cn } from "@/lib/format";

/* ───────────── Button ───────────── */
type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger" | "success";
  size?: "sm" | "md" | "lg" | "xl";
  loading?: boolean;
  block?: boolean;
};

const variants = {
  primary: "bg-primary text-primary-fg shadow-card",
  secondary: "bg-elevated text-fg shadow-card ring-1 ring-line",
  ghost: "bg-transparent text-fg",
  danger: "bg-danger text-white shadow-card",
  success: "bg-success text-white shadow-card",
};
const sizes = {
  sm: "h-9 px-3.5 text-sm rounded-xl gap-1.5",
  md: "h-12 px-5 text-[15px] rounded-2xl gap-2",
  lg: "h-14 px-6 text-base rounded-2xl gap-2",
  xl: "h-20 px-8 text-lg rounded-[1.75rem] gap-3 tracking-wide",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading, block, className, children, disabled, ...rest }, ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "pressable inline-flex items-center justify-center font-semibold disabled:opacity-50",
        variants[variant], sizes[size], block && "w-full", className,
      )}
      {...rest}
    >
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
});

export function LinkButton({ href, variant = "primary", size = "md", block, className, children }: {
  href: string; variant?: ButtonProps["variant"]; size?: ButtonProps["size"]; block?: boolean; className?: string; children: React.ReactNode;
}) {
  return (
    <Link href={href} className={cn(
      "pressable inline-flex items-center justify-center font-semibold no-select",
      variants[variant ?? "primary"], sizes[size ?? "md"], block && "w-full", className,
    )}>
      {children}
    </Link>
  );
}

/* ───────────── Surfaces ───────────── */
export function Card({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-3xl bg-elevated shadow-card", className)} {...rest}>{children}</div>;
}

export function Section({ title, action, children, className }: {
  title?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string;
}) {
  return (
    <section className={cn("space-y-2.5", className)}>
      {(title || action) && (
        <div className="flex items-end justify-between px-1">
          {title && <h2 className="text-overline text-muted">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, tone, sub, className }: {
  label: string; value: React.ReactNode; tone?: "default" | "success" | "warning" | "danger"; sub?: React.ReactNode; className?: string;
}) {
  return (
    <div className={cn("rounded-2xl bg-elevated p-4 shadow-card", className)}>
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className={cn("mt-1 text-2xl font-bold text-numeric",
        tone === "success" && "text-success", tone === "warning" && "text-warning", tone === "danger" && "text-danger")}>
        {value}
      </div>
      {sub && <div className="mt-0.5 text-xs text-subtle">{sub}</div>}
    </div>
  );
}

export function Badge({ tone = "default", children, className }: {
  tone?: "default" | "success" | "warning" | "danger" | "info" | "navy"; children: React.ReactNode; className?: string;
}) {
  const tones = {
    default: "bg-sunken text-muted",
    success: "bg-success-bg text-success",
    warning: "bg-warning-bg text-warning",
    danger: "bg-danger-bg text-danger",
    info: "bg-info-bg text-fg",
    navy: "bg-primary text-primary-fg",
  };
  return <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold", tones[tone], className)}>{children}</span>;
}

export function ListGroup({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("divide-y divide-line overflow-hidden rounded-3xl bg-elevated shadow-card", className)}>{children}</div>;
}

export function ListRow({ href, onClick, icon, title, subtitle, trailing, chevron = true, className }: {
  href?: string; onClick?: () => void; icon?: React.ReactNode; title: React.ReactNode; subtitle?: React.ReactNode;
  trailing?: React.ReactNode; chevron?: boolean; className?: string;
}) {
  const inner = (
    <>
      {icon && <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-sunken text-fg">{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{title}</span>
        {subtitle && <span className="block truncate text-sm text-muted">{subtitle}</span>}
      </span>
      {trailing && <span className="shrink-0 text-sm text-muted">{trailing}</span>}
      {(href || onClick) && chevron && <ChevronRight className="size-4 shrink-0 text-subtle rtl:rotate-180" aria-hidden />}
    </>
  );
  const cls = cn("flex min-h-14 w-full items-center gap-3 px-4 py-3 text-start", (href || onClick) && "pressable active:bg-sunken", className);
  if (href) return <Link href={href} className={cls}>{inner}</Link>;
  if (onClick) return <button type="button" onClick={onClick} className={cls}>{inner}</button>;
  return <div className={cls}>{inner}</div>;
}

export function EmptyState({ icon, title, body, action }: { icon?: React.ReactNode; title: string; body?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      {icon && <div className="mb-3 grid size-14 place-items-center rounded-2xl bg-sunken text-muted">{icon}</div>}
      <p className="font-semibold">{title}</p>
      {body && <p className="mt-1 max-w-xs text-sm text-muted">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("size-5 animate-spin text-muted", className)} aria-label="Loading" />;
}

export function PageLoader() {
  return <div className="grid min-h-[50dvh] place-items-center"><Spinner /></div>;
}

export function Notice({ tone = "info", children, className }: { tone?: "info" | "warning" | "danger" | "success"; children: React.ReactNode; className?: string }) {
  const tones = { info: "bg-info-bg", warning: "bg-warning-bg text-warning", danger: "bg-danger-bg text-danger", success: "bg-success-bg text-success" };
  return <div role={tone === "danger" ? "alert" : "status"} className={cn("rounded-2xl px-4 py-3 text-sm font-medium", tones[tone], className)}>{children}</div>;
}

/* ───────────── Inputs ───────────── */
type FieldProps = React.InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; error?: string | null };

export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field({ label, hint, error, className, id, ...rest }, ref) {
  const autoId = useId();
  const fid = id ?? autoId;
  return (
    <label htmlFor={fid} className={cn("block", className)}>
      <span className="mb-1.5 block px-1 text-sm font-medium text-muted">{label}</span>
      <input
        ref={ref}
        id={fid}
        aria-invalid={!!error || undefined}
        aria-describedby={error || hint ? `${fid}-msg` : undefined}
        className={cn(
          "h-13 w-full rounded-2xl bg-elevated px-4 text-[16px] text-fg shadow-card outline-none ring-1 ring-line placeholder:text-subtle",
          "focus:ring-2 focus:ring-[var(--navy-500)]",
          error && "ring-2 ring-danger",
        )}
        style={{ height: "3.25rem" }}
        {...rest}
      />
      {(error || hint) && (
        <span id={`${fid}-msg`} className={cn("mt-1.5 block px-1 text-sm", error ? "text-danger" : "text-subtle")}>{error || hint}</span>
      )}
    </label>
  );
});

export function TextArea({ label, className, ...rest }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string }) {
  const id = useId();
  return (
    <label htmlFor={id} className={cn("block", className)}>
      <span className="mb-1.5 block px-1 text-sm font-medium text-muted">{label}</span>
      <textarea id={id} rows={3}
        className="w-full rounded-2xl bg-elevated px-4 py-3 text-[16px] shadow-card outline-none ring-1 ring-line placeholder:text-subtle focus:ring-2 focus:ring-[var(--navy-500)]"
        {...rest} />
    </label>
  );
}

export function Select({ label, className, children, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement> & { label: string }) {
  const id = useId();
  return (
    <label htmlFor={id} className={cn("block", className)}>
      <span className="mb-1.5 block px-1 text-sm font-medium text-muted">{label}</span>
      <select id={id}
        className="w-full appearance-none rounded-2xl bg-elevated px-4 text-[16px] shadow-card outline-none ring-1 ring-line focus:ring-2 focus:ring-[var(--navy-500)]"
        style={{ height: "3.25rem" }} {...rest}>
        {children}
      </select>
    </label>
  );
}

export function Toggle({ checked, onChange, label, description }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
      className="pressable flex w-full items-center gap-3 px-4 py-3 text-start">
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{label}</span>
        {description && <span className="block text-sm text-muted">{description}</span>}
      </span>
      <span className={cn("relative h-7 w-12 shrink-0 rounded-full transition-colors duration-200", checked ? "bg-success" : "bg-line-strong")}>
        <span className={cn("absolute top-0.5 size-6 rounded-full bg-white shadow transition-transform duration-200 ease-[var(--ease-out)]",
          checked ? "translate-x-[1.375rem] rtl:-translate-x-[1.375rem]" : "translate-x-0.5 rtl:-translate-x-0.5")} />
      </span>
    </button>
  );
}

/** Big, thumb-friendly − qty + control */
export function Stepper({ value, onChange, min = 0, max, label }: { value: number; onChange: (v: number) => void; min?: number; max?: number; label?: string }) {
  const dec = () => onChange(Math.max(min, value - 1));
  const inc = () => onChange(max === undefined ? value + 1 : Math.min(max, value + 1));
  return (
    <div className="flex items-center gap-1 rounded-2xl bg-sunken p-1" role="group" aria-label={label}>
      <button type="button" onClick={dec} disabled={value <= min} aria-label="Decrease"
        className="pressable grid size-10 place-items-center rounded-xl bg-elevated shadow-card disabled:opacity-40"><Minus className="size-4" /></button>
      <input
        inputMode="numeric" pattern="[0-9]*" value={value}
        onChange={(e) => {
          const n = parseInt(e.target.value.replace(/\D/g, "") || "0", 10);
          onChange(max === undefined ? Math.max(min, n) : Math.min(max, Math.max(min, n)));
        }}
        className="w-11 bg-transparent text-center text-lg font-bold text-numeric outline-none"
        aria-label={label ? `${label} quantity` : "Quantity"}
      />
      <button type="button" onClick={inc} disabled={max !== undefined && value >= max} aria-label="Increase"
        className="pressable grid size-10 place-items-center rounded-xl bg-elevated shadow-card disabled:opacity-40"><Plus className="size-4" /></button>
    </div>
  );
}

/** Money input: decimal keyboard, currency prefix */
export function MoneyInput({ label, value, onChange, currency = "$", hint, autoFocus }: {
  label: string; value: string; onChange: (v: string) => void; currency?: string; hint?: string; autoFocus?: boolean;
}) {
  const id = useId();
  return (
    <label htmlFor={id} className="block">
      <span className="mb-1.5 block px-1 text-sm font-medium text-muted">{label}</span>
      <span className="flex items-center rounded-2xl bg-elevated px-4 shadow-card ring-1 ring-line focus-within:ring-2 focus-within:ring-[var(--navy-500)]" style={{ height: "3.25rem" }}>
        <span className="me-1 text-muted">{currency}</span>
        <input id={id} inputMode="decimal" autoFocus={autoFocus} placeholder="0" value={value}
          onChange={(e) => onChange(e.target.value.replace(",", ".").replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1"))}
          className="h-full w-full bg-transparent text-[16px] font-semibold text-numeric outline-none" />
      </span>
      {hint && <span className="mt-1.5 block px-1 text-sm text-subtle">{hint}</span>}
    </label>
  );
}

export function Segmented<T extends string>({ value, onChange, options, className }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; className?: string;
}) {
  return (
    <div role="tablist" className={cn("flex gap-1 overflow-x-auto rounded-2xl bg-sunken p-1", className)}>
      {options.map((o) => (
        <button key={o.value} role="tab" aria-selected={value === o.value} type="button" onClick={() => onChange(o.value)}
          className={cn("pressable h-9 shrink-0 grow rounded-xl px-3 text-sm font-semibold transition-colors",
            value === o.value ? "bg-elevated text-fg shadow-card" : "text-muted")}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ───────────── Bottom sheet ─────────────
   Enters from the bottom and leaves the same way. Drag the handle to dismiss;
   a flick dismisses even if short (velocity, not just distance). */
export function Sheet({ open, onClose, title, children, footer }: {
  open: boolean; onClose: () => void; title?: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode;
}) {
  const reduce = useReducedMotion();
  const controls = useDragControls();
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
          <motion.div className="absolute inset-0 bg-[var(--scrim)]" onClick={onClose}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} />
          <motion.div
            ref={panelRef}
            role="dialog" aria-modal="true" tabIndex={-1}
            className="relative flex max-h-[88dvh] w-full max-w-lg flex-col rounded-t-[1.75rem] bg-bg shadow-float outline-none sm:rounded-[1.75rem]"
            initial={reduce ? { opacity: 0 } : { y: "100%" }}
            animate={reduce ? { opacity: 1 } : { y: 0 }}
            exit={reduce ? { opacity: 0 } : { y: "100%" }}
            transition={reduce ? { duration: 0.2 } : { type: "spring", bounce: 0, duration: 0.38 }}
            drag={reduce ? false : "y"} dragControls={controls} dragListener={false}
            dragConstraints={{ top: 0, bottom: 0 }} dragElastic={{ top: 0.05, bottom: 0.9 }}
            onDragEnd={(_, info) => { if (info.offset.y > 120 || info.velocity.y > 600) onClose(); }}
          >
            <div className="flex shrink-0 cursor-grab touch-none flex-col items-center pt-2.5"
                 onPointerDown={(e) => controls.start(e)}>
              <span className="h-1.5 w-10 rounded-full bg-line-strong" aria-hidden />
            </div>
            <div className="flex shrink-0 items-center justify-between gap-3 px-5 pb-2 pt-2">
              <div className="text-headline">{title}</div>
              <button type="button" onClick={onClose} aria-label="Close"
                className="pressable grid size-9 place-items-center rounded-full bg-sunken text-muted"><X className="size-4" /></button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-4">{children}</div>
            {footer && <div className="shrink-0 border-t border-line px-5 pt-3" style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom, 0px))" }}>{footer}</div>}
            {!footer && <div className="safe-bottom" />}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

/** Confirmation for destructive or irreversible actions only. */
export function useConfirm() {
  const [state, setState] = useState<{ title: string; body?: string; confirm: string; tone?: "danger" | "primary"; resolve: (v: boolean) => void } | null>(null);
  const ask = (title: string, opts: { body?: string; confirm?: string; tone?: "danger" | "primary" } = {}) =>
    new Promise<boolean>((resolve) => setState({ title, body: opts.body, confirm: opts.confirm ?? "Confirm", tone: opts.tone, resolve }));
  const close = (v: boolean) => { state?.resolve(v); setState(null); };
  const node = (
    <Sheet open={!!state} onClose={() => close(false)} title={state?.title}
      footer={<div className="flex gap-2">
        <Button variant="secondary" block onClick={() => close(false)}>Cancel</Button>
        <Button variant={state?.tone === "danger" ? "danger" : "primary"} block onClick={() => close(true)}>{state?.confirm}</Button>
      </div>}>
      {state?.body && <p className="pb-2 text-muted">{state.body}</p>}
    </Sheet>
  );
  return { ask, node };
}
