"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, useReducedMotion } from "motion/react";
import { BookPlus, LocateFixed, Check, ChevronDown, CloudUpload, HandHeart, Plus, Search, Trash2, UserRound, Wallet } from "lucide-react";
import { useApp } from "@/lib/app-context";
import { useData } from "@/lib/hooks";
import { getActiveSession, getInventory } from "@/lib/queries";
import { sb } from "@/lib/supabase";
import { submitTransaction, type TxPayload } from "@/lib/sync";
import { balanceOf, cn, methodLabel, money } from "@/lib/format";
import { uuid } from "@/lib/uuid";
import { currentLocation, placeLabel, type Loc } from "@/lib/location";
import type { InventoryRow, Territory, TxSummary } from "@/lib/types";
import {
  Badge, Button, Card, EmptyState, Field, LinkButton, MoneyInput, Notice, Section, Segmented, Sheet, Stepper, TextArea, Toggle,
} from "@/components/ui";
import { PageHeader } from "@/components/app/shell";

type Line = { book_id: string; quantity: number };
type Pay = { key: string; method: string; amount: string; reference: string };

const LAST_PLACE = "yes:last-place";

function readPlace(): { city: string; neighborhood: string; territory_id: string } {
  try { return JSON.parse(localStorage.getItem(LAST_PLACE) || "") } catch { return { city: "", neighborhood: "", territory_id: "" }; }
}

export default function NewTransaction() {
  const { profile, settings } = useApp();
  const router = useRouter();
  const reduce = useReducedMotion();
  const uid = profile!.id;

  const session = useData(`session:${uid}`, () => getActiveSession(uid), [uid]);
  const inventory = useData(`inventory:${uid}`, () => getInventory(uid), [uid]);
  const territories = useData("territories", async () => {
    const { data } = await sb().from("territories").select("*").eq("active", true).order("territory_name");
    return (data ?? []) as Territory[];
  });

  // The idempotency key: created once per form, so a double tap or a retry can't create two sales.
  const txId = useRef(uuid());
  const [lines, setLines] = useState<Line[]>([]);
  const [donation, setDonation] = useState("");
  const [donorName, setDonorName] = useState("");
  const [pays, setPays] = useState<Pay[]>([{ key: "p1", method: settings.payment_methods[0] ?? "cash", amount: "", reference: "" }]);
  const [amountTouched, setAmountTouched] = useState(false);
  const [place, setPlace] = useState(readPlace);
  const [loc, setLoc] = useState<Loc | null>(null);
  const [locating, setLocating] = useState(true);

  // City and neighborhood come from the phone's location; the student can still correct them.
  function applyLocation(l: Loc) {
    setLoc(l);
    if (l.status === "ok" && (l.city || l.neighborhood)) {
      setPlace((p) => ({ ...p, city: l.city ?? p.city, neighborhood: l.neighborhood ?? p.neighborhood }));
    }
    setLocating(false);
  }
  async function detect() {
    setLocating(true);
    applyLocation(await currentLocation());
  }
  useEffect(() => {
    let alive = true;
    currentLocation().then((l) => { if (alive) applyLocation(l); });
    return () => { alive = false; };
  }, []);
  const [showCustomer, setShowCustomer] = useState(false);
  const [customer, setCustomer] = useState({ name: "", phone: "", whatsapp: "", email: "", notes: "", consent: false });
  const [notes, setNotes] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<null | { queued: boolean; summary: TxSummary }>(null);

  const invById = useMemo(() => new Map((inventory.data ?? []).map((r) => [r.book_id, r])), [inventory.data]);
  const bookValue = lines.reduce((s, l) => s + l.quantity * Number(invById.get(l.book_id)?.books?.unit_value ?? 0), 0);
  const donationNum = Number(donation || 0);
  const expected = Math.round((bookValue + donationNum) * 100) / 100;
  // Until the student types an amount, the first payment follows the expected total.
  const effectivePays = pays.map((p, i) => (i === 0 && !amountTouched ? { ...p, amount: expected ? String(expected) : "" } : p));
  const received = effectivePays.reduce((s, p) => s + Number(p.amount || 0), 0);
  const bookCount = lines.reduce((s, l) => s + l.quantity, 0);

  const active = session.data ?? null;
  const canSave = !!active && (bookCount > 0 || donationNum > 0) && !saving;

  function addBook(row: InventoryRow) {
    setLines((ls) => (ls.some((l) => l.book_id === row.book_id)
      ? ls.map((l) => (l.book_id === row.book_id ? { ...l, quantity: Math.min(row.remaining, l.quantity + 1) } : l))
      : [...ls, { book_id: row.book_id, quantity: 1 }]));
    setPickerOpen(false);
  }

  async function save() {
    if (!active) return;
    setError(null);
    // Client-side check mirrors the server rule so the message is instant, even offline.
    for (const l of lines) {
      const row = invById.get(l.book_id);
      if (!row || l.quantity > row.remaining) {
        setError(`Not enough inventory. You currently have ${row?.remaining ?? 0} copies of ${row?.books?.code} available.`);
        return;
      }
      if (row.books?.unit_value == null) { setError(`${row.books?.code} has no price yet. Ask your admin to set it.`); return; }
    }
    setSaving(true);
    const payload: TxPayload = {
      id: txId.current,
      session_id: active.id,
      client_created_at: new Date().toISOString(),
      items: lines.filter((l) => l.quantity > 0),
      donation: donationNum > 0 ? { amount: donationNum, donor_name: donorName || undefined } : undefined,
      payments: effectivePays.filter((p) => Number(p.amount) > 0).map((p) => ({ amount: Number(p.amount), method: p.method, reference: p.reference || undefined })),
      customer: showCustomer ? customer : null,
      territory_id: place.territory_id || null,
      city: place.city || null,
      neighborhood: place.neighborhood || null,
      notes: notes || null,
      location: loc ?? { status: "unavailable" },
    };
    try { localStorage.setItem(LAST_PLACE, JSON.stringify(place)); } catch { /* ignore */ }
    const label = `${bookCount} book${bookCount === 1 ? "" : "s"} · ${money(expected, settings.currency)}`;
    const result = await submitTransaction(payload, label);
    setSaving(false);
    if (result.state === "error") { setError(result.message); return; }

    // Optimistically update the cached inventory so the next sale sees the right numbers.
    const nextInv = (inventory.data ?? []).map((r) => {
      const l = lines.find((x) => x.book_id === r.book_id);
      return l ? { ...r, distributed: r.distributed + l.quantity, remaining: r.remaining - l.quantity } : r;
    });
    inventory.setData(nextInv);
    if (result.state === "saved") {
      setDone({ queued: false, summary: result.summary });
      inventory.refresh();
    } else {
      setDone({
        queued: true,
        summary: {
          id: payload.id, status: "queued", books: bookCount, book_value: bookValue, donation: donationNum, expected,
          received, difference: received - expected, remaining_inventory: nextInv.reduce((s, r) => s + r.remaining, 0),
        },
      });
    }
  }

  function reset() {
    txId.current = uuid();
    setLines([]); setDonation(""); setDonorName(""); setAmountTouched(false); setNotes("");
    setPays([{ key: "p1", method: settings.payment_methods[0] ?? "cash", amount: "", reference: "" }]);
    setCustomer({ name: "", phone: "", whatsapp: "", email: "", notes: "", consent: false }); setShowCustomer(false);
    setDone(null); setError(null);
    window.scrollTo({ top: 0 });
  }

  /* ───────── Confirmation ───────── */
  if (done) {
    const s = done.summary;
    return (
      <div className="px-5 pt-[calc(env(safe-area-inset-top,0px)+3rem)]">
        <motion.div initial={reduce ? { opacity: 0 } : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
          transition={{ type: "spring", bounce: 0, duration: 0.4 }} className="text-center">
          <motion.div initial={reduce ? false : { scale: 0.6 }} animate={{ scale: 1 }} transition={{ type: "spring", bounce: 0.35, duration: 0.5 }}
            className={cn("mx-auto grid size-20 place-items-center rounded-full", done.queued ? "bg-warning-bg text-warning" : "bg-success-bg text-success")}>
            {done.queued ? <CloudUpload className="size-9" /> : <Check className="size-10 stroke-[2.5]" />}
          </motion.div>
          <h1 className="text-title mt-5">{done.queued ? "Saved on this phone" : "TRANSACTION SAVED"}</h1>
          <p className="mt-1 text-muted">{done.queued ? "Waiting to sync. It will upload automatically when you're back online." : "Inventory updated."}</p>
        </motion.div>
        <Card className="mt-8 divide-y divide-line">
          {[
            ["Books", String(s.books)],
            ["Book Value", money(s.book_value, settings.currency)],
            ["Donation", money(s.donation, settings.currency)],
            ["Received", money(s.received, settings.currency)],
            ["Remaining Inventory", String(s.remaining_inventory)],
          ].map(([k, v]) => (
            <div key={k} className="flex items-center justify-between px-5 py-3.5">
              <span className="text-muted">{k}</span><span className="font-semibold text-numeric">{v}</span>
            </div>
          ))}
          <div className="flex items-center justify-between px-5 py-3.5">
            <span className="text-muted">Status</span><BalanceBadge received={s.received} expected={s.expected} currency={settings.currency} />
          </div>
        </Card>
        <div className="mt-6 space-y-3">
          <Button size="lg" block onClick={reset}><Plus className="size-5" /> New Transaction</Button>
          <Button size="lg" variant="secondary" block onClick={() => router.push("/s")}>Done</Button>
        </div>
      </div>
    );
  }

  /* ───────── No active session ───────── */
  if (active?.status === "paused") {
    return (
      <>
        <PageHeader title="New Transaction" />
        <div className="px-5">
          <Card>
            <EmptyState icon={<Wallet className="size-6" />} title="Your work is paused"
              body="Resume work from Home to record transactions."
              action={<LinkButton href="/s" size="lg">Go to Home</LinkButton>} />
          </Card>
        </div>
      </>
    );
  }

  if (!session.loading && !active) {
    return (
      <>
        <PageHeader title="New Transaction" />
        <div className="px-5">
          <Card>
            <EmptyState icon={<Wallet className="size-6" />} title="Start work first"
              body="Transactions are linked to your work session. Start work from Home, then come back."
              action={<LinkButton href="/s" size="lg">Go to Home</LinkButton>} />
          </Card>
        </div>
      </>
    );
  }

  const available = (inventory.data ?? []).filter((r) => r.remaining > 0 && r.books?.active !== false);

  return (
    <>
      <PageHeader title="New Transaction" />
      <div className="space-y-7 px-5 pb-40">
        {/* 1 — Books */}
        <Section title="Books" action={lines.length > 0 && <span className="text-sm text-muted">{bookCount} · {money(bookValue, settings.currency)}</span>}>
          <div className="space-y-2">
            {lines.map((l) => {
              const row = invById.get(l.book_id)!;
              return (
                <motion.div key={l.book_id} layout={!reduce} initial={reduce ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                  className="flex items-center gap-3 rounded-3xl bg-elevated p-3 ps-4 shadow-card">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2"><Badge tone="navy">{row?.books?.code}</Badge>
                      <span className="text-sm font-semibold text-numeric">{money(Number(row?.books?.unit_value ?? 0) * l.quantity, settings.currency)}</span></div>
                    <div className="mt-1 truncate text-sm text-muted">{row?.books?.name ?? "—"}</div>
                    <div className="text-xs text-subtle">{row ? row.remaining - l.quantity : 0} left after this</div>
                  </div>
                  <Stepper value={l.quantity} min={0} max={row?.remaining ?? 0} label={row?.books?.code}
                    onChange={(q) => setLines((ls) => (q === 0 ? ls.filter((x) => x.book_id !== l.book_id) : ls.map((x) => (x.book_id === l.book_id ? { ...x, quantity: q } : x))))} />
                </motion.div>
              );
            })}
            <button type="button" onClick={() => setPickerOpen(true)}
              className="pressable flex h-14 w-full items-center justify-center gap-2 rounded-3xl border-2 border-dashed border-line-strong font-semibold text-muted">
              <BookPlus className="size-5" /> {lines.length ? "Add another book" : "Choose book"}
            </button>
          </div>
        </Section>

        {/* 2 — Donation */}
        {settings.donations_enabled && (
          <Section title="Donation">
            <Card className="space-y-3 p-4">
              <MoneyInput label="Donation (separate from book value)" value={donation} onChange={setDonation} currency="$" />
              {donationNum > 0 && <Field label="Donor name (optional)" value={donorName} onChange={(e) => setDonorName(e.target.value)} />}
            </Card>
          </Section>
        )}

        {/* 3 — Payment */}
        <Section title="Payment" action={
          <button type="button" className="pressable text-sm font-semibold text-fg"
            onClick={() => { setAmountTouched(true); setPays(() => [...effectivePays, { key: uuid(), method: settings.payment_methods.find((m) => !effectivePays.some((x) => x.method === m)) ?? "cash", amount: "", reference: "" }].slice(0, 4)); }}>
            <span className="inline-flex items-center gap-1"><Plus className="size-4" /> Split</span>
          </button>}>
          <div className="space-y-2">
            {effectivePays.map((p, i) => (
              <Card key={p.key} className="space-y-3 p-4">
                <div className="flex items-center gap-2">
                  <Segmented className="flex-1" value={p.method}
                    onChange={(m) => setPays(effectivePays.map((x) => (x.key === p.key ? { ...x, method: m } : x)))}
                    options={settings.payment_methods.map((m) => ({ value: m, label: methodLabel(m) }))} />
                  {i > 0 && (
                    <button type="button" aria-label="Remove payment" onClick={() => setPays(effectivePays.filter((x) => x.key !== p.key))}
                      className="pressable grid size-10 place-items-center rounded-xl bg-sunken text-muted"><Trash2 className="size-4" /></button>
                  )}
                </div>
                <MoneyInput label="Amount received" value={p.amount}
                  onChange={(v) => { setAmountTouched(true); setPays(effectivePays.map((x) => (x.key === p.key ? { ...x, amount: v } : x))); }} />
                {p.method !== "cash" && (
                  <Field label="Reference (optional)" placeholder="Transfer ID / note" value={p.reference}
                    onChange={(e) => setPays(effectivePays.map((x) => (x.key === p.key ? { ...x, reference: e.target.value } : x)))} />
                )}
              </Card>
            ))}
          </div>
        </Section>

        {/* 4 — Where */}
        <Section title="Where" action={
          <button type="button" onClick={detect} disabled={locating} className="pressable inline-flex items-center gap-1 text-sm font-semibold disabled:opacity-50">
            <LocateFixed className={locating ? "size-4 animate-pulse" : "size-4"} /> {locating ? "Locating…" : "Detect"}
          </button>}>
          {loc && (
            <p className="px-1 text-xs text-muted">
              {loc.status === "ok" ? `Detected: ${placeLabel(loc) || "location recorded"}${loc.accuracy ? ` (±${loc.accuracy} m)` : ""} · © OpenStreetMap`
                : loc.status === "denied" ? "Location is blocked on this phone. Allow it in the browser settings, or type the place."
                : "Couldn't get the location. Type the place below."}
            </p>
          )}
          <Card className="space-y-3 p-4">
            {(territories.data?.length ?? 0) > 0 && (
              <label className="block">
                <span className="mb-1.5 block px-1 text-sm font-medium text-muted">Territory (optional)</span>
                <select value={place.territory_id} onChange={(e) => {
                  const t = territories.data!.find((x) => x.id === e.target.value);
                  setPlace({ ...place, territory_id: e.target.value, city: t?.city ?? place.city });
                }} className="h-13 w-full rounded-2xl bg-elevated px-4 shadow-card ring-1 ring-line" style={{ height: "3.25rem" }}>
                  <option value="">—</option>
                  {territories.data!.map((t) => <option key={t.id} value={t.id}>{t.territory_name}{t.city ? ` · ${t.city}` : ""}</option>)}
                </select>
              </label>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Field label="City" value={place.city} onChange={(e) => setPlace({ ...place, city: e.target.value })} />
              <Field label="Neighborhood" value={place.neighborhood} onChange={(e) => setPlace({ ...place, neighborhood: e.target.value })} />
            </div>
          </Card>
        </Section>

        {/* 5 — Customer (optional) */}
        {settings.collect_contacts && (
          <Section>
            <button type="button" onClick={() => setShowCustomer((v) => !v)}
              className="pressable flex w-full items-center gap-3 rounded-3xl bg-elevated px-4 py-4 text-start shadow-card">
              <span className="grid size-9 place-items-center rounded-xl bg-sunken"><UserRound className="size-[18px]" /></span>
              <span className="flex-1"><span className="block font-medium">Customer information</span><span className="block text-sm text-muted">Optional</span></span>
              <ChevronDown className={cn("size-5 text-subtle transition-transform duration-200", showCustomer && "rotate-180")} />
            </button>
            {showCustomer && (
              <Card className="enter space-y-3 p-4">
                <Field label="Name" value={customer.name} onChange={(e) => setCustomer({ ...customer, name: e.target.value })} />
                <div className="overflow-hidden rounded-2xl bg-sunken">
                  <Toggle checked={customer.consent} onChange={(v) => setCustomer({ ...customer, consent: v })}
                    label="They agreed to be contacted" description="Phone, WhatsApp and email are only saved with permission." />
                </div>
                <fieldset disabled={!customer.consent} className={cn("space-y-3", !customer.consent && "opacity-50")}>
                  <Field label="Phone" type="tel" inputMode="tel" value={customer.phone} onChange={(e) => setCustomer({ ...customer, phone: e.target.value })} />
                  <Field label="WhatsApp" type="tel" inputMode="tel" value={customer.whatsapp} onChange={(e) => setCustomer({ ...customer, whatsapp: e.target.value })} />
                  <Field label="Email" type="email" inputMode="email" autoCapitalize="none" value={customer.email} onChange={(e) => setCustomer({ ...customer, email: e.target.value })} />
                </fieldset>
                <TextArea label="Notes" value={customer.notes} onChange={(e) => setCustomer({ ...customer, notes: e.target.value })} />
                <p className="px-1 text-xs text-muted">
                  Tell the person: this is optional, it is only used by YES to follow up, and they can ask to have it removed.
                  Never write health information (illnesses, conditions) in notes.
                </p>
              </Card>
            )}
          </Section>
        )}

        <TextArea label="Transaction notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>

      {/* Sticky summary + Save — sits above the tab bar */}
      <div className="material fixed inset-x-0 z-30 border-t border-line" style={{ bottom: "calc(4rem + env(safe-area-inset-bottom, 0px))" }}>
        <div className="mx-auto max-w-lg space-y-2 px-5 py-3">
          {error && <Notice tone="danger">{error}</Notice>}
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted">Expected <b className="text-fg text-numeric">{money(expected, settings.currency)}</b> · Received <b className="text-fg text-numeric">{money(received, settings.currency)}</b></span>
            <BalanceBadge received={received} expected={expected} currency={settings.currency} />
          </div>
          <Button size="lg" block onClick={save} disabled={!canSave} loading={saving}>
            {saving ? "Saving…" : "Save Transaction"}
          </Button>
        </div>
      </div>

      <BookPicker open={pickerOpen} onClose={() => setPickerOpen(false)} rows={available} onPick={addBook} currency={settings.currency}
        loading={inventory.loading && !inventory.data} />
    </>
  );
}

function BalanceBadge({ received, expected, currency }: { received: number; expected: number; currency: string }) {
  const b = balanceOf(received, expected);
  if (b.kind === "balanced") return <Badge tone="success"><Check className="size-3.5" /> Balanced</Badge>;
  if (b.kind === "underpaid") return <Badge tone="warning">Underpaid: {money(b.amount, currency)}</Badge>;
  return <Badge tone="info">Over: {money(b.amount, currency)}</Badge>;
}

function BookPicker({ open, onClose, rows, onPick, currency, loading }: {
  open: boolean; onClose: () => void; rows: InventoryRow[]; onPick: (r: InventoryRow) => void; currency: string; loading: boolean;
}) {
  const [query, setQuery] = useState("");
  const filtered = rows.filter((r) => {
    const qy = query.trim().toLowerCase();
    return !qy || r.books?.code.toLowerCase().includes(qy) || (r.books?.name ?? "").toLowerCase().includes(qy);
  });
  return (
    <Sheet open={open} onClose={onClose} title="Choose book">
      <div className="sticky top-0 z-10 bg-bg pb-3">
        <label className="flex h-12 items-center gap-2 rounded-2xl bg-sunken px-4">
          <Search className="size-4 text-subtle" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Code or title"
            className="h-full w-full bg-transparent outline-none" autoCapitalize="characters" autoCorrect="off" />
        </label>
      </div>
      {loading ? null : rows.length === 0 ? (
        <EmptyState icon={<HandHeart className="size-6" />} title="No books in your inventory"
          body="Ask your leader to assign books to you. You can still record a donation-only transaction." />
      ) : (
        <div className="grid grid-cols-2 gap-2 pb-2">
          {filtered.map((r) => (
            <button key={r.book_id} type="button" onClick={() => onPick(r)}
              className="pressable flex flex-col items-start rounded-2xl bg-elevated p-3 text-start shadow-card ring-1 ring-line">
              <span className="text-lg font-bold">{r.books?.code}</span>
              <span className="line-clamp-2 min-h-10 text-sm text-muted">{r.books?.name ?? "Name not set"}</span>
              <span className="mt-2 flex w-full items-center justify-between text-xs">
                <span className="font-semibold text-numeric">{r.books?.unit_value == null ? "No price" : money(r.books.unit_value, currency)}</span>
                <span className="text-subtle">{r.remaining} left</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </Sheet>
  );
}
