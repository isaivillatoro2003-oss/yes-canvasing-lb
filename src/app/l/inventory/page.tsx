"use client";

import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeftRight, PackageMinus, PackagePlus, Search } from "lucide-react";
import { useApp } from "@/lib/app-context";
import { useData } from "@/lib/hooks";
import { getBooks, getInventory } from "@/lib/queries";
import { getMyStudents } from "@/lib/leader";
import { rpc, toAppError } from "@/lib/supabase";
import { money } from "@/lib/format";
import { Badge, Button, Card, EmptyState, Notice, PageLoader, Section, Segmented, Select, Stepper, TextArea } from "@/components/ui";
import { PageHeader } from "@/components/app/shell";

type Mode = "assign" | "receive" | "transfer";

function InventoryDesk() {
  const params = useSearchParams();
  const { profile, settings, toast } = useApp();
  const [mode, setMode] = useState<Mode>("assign");
  const [studentId, setStudentId] = useState(params.get("student") ?? "");
  const [toId, setToId] = useState("");
  const [qty, setQty] = useState<Record<string, number>>({});
  const [notes, setNotes] = useState("");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const students = useData(`leader:students:${profile!.id}`, () => getMyStudents(profile!.id), [profile!.id]);
  const books = useData("books:active", () => getBooks());
  const inv = useData(studentId ? `inventory:${studentId}` : null, () => getInventory(studentId), [studentId]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = (code: string, name: string | null) => !q || code.toLowerCase().includes(q) || (name ?? "").toLowerCase().includes(q);
    if (mode === "assign") {
      return (books.data ?? []).filter((b) => match(b.code, b.name)).map((b) => ({
        book_id: b.id, code: b.code, name: b.name, price: b.unit_value,
        max: b.warehouse_qty, hint: `${b.warehouse_qty} in warehouse`,
        holds: (inv.data ?? []).find((r) => r.book_id === b.id)?.remaining ?? 0,
      }));
    }
    return (inv.data ?? []).filter((r) => r.remaining > 0 && r.books && match(r.books.code, r.books.name)).map((r) => ({
      book_id: r.book_id, code: r.books!.code, name: r.books!.name, price: r.books!.unit_value,
      max: r.remaining, hint: `Holds ${r.remaining}`, holds: r.remaining,
    }));
  }, [mode, books.data, inv.data, query]);

  const total = Object.values(qty).reduce((s, n) => s + n, 0);
  const student = students.data?.find((s) => s.id === studentId);

  function switchMode(m: Mode) { setMode(m); setQty({}); setError(null); }

  async function submit() {
    setError(null);
    const items = Object.entries(qty).filter(([, n]) => n > 0).map(([book_id, quantity]) => ({ book_id, quantity }));
    if (!studentId || items.length === 0) return;
    setBusy(true);
    try {
      if (mode === "assign") {
        await rpc("assign_inventory", { p_student: studentId, p_items: items, p_notes: notes || null });
        toast(`${total} books assigned to ${student?.full_name ?? "student"}`, "success");
      } else if (mode === "receive") {
        await rpc("return_inventory", { p_student: studentId, p_items: items, p_notes: notes || null });
        toast(`${total} books received back`, "success");
      } else {
        if (!toId) { setError("Choose who receives the books."); return; }
        for (const it of items) {
          await rpc("transfer_inventory", { p_from: studentId, p_to: toId, p_book: it.book_id, p_qty: it.quantity, p_notes: notes || null });
        }
        toast(`${total} books transferred`, "success");
      }
      setQty({}); setNotes("");
      inv.refresh(); books.refresh();
    } catch (e) {
      setError(toAppError(e).message);
    } finally {
      setBusy(false);
    }
  }

  const verb = mode === "assign" ? "Assign" : mode === "receive" ? "Receive" : "Transfer";

  return (
    <>
      <PageHeader title="Inventory" subtitle="Assign books, receive returns, or move books between students." />
      <div className="space-y-5 px-5 pb-40">
        <Segmented value={mode} onChange={switchMode} options={[
          { value: "assign", label: "Assign" }, { value: "receive", label: "Receive" }, { value: "transfer", label: "Transfer" },
        ]} />

        <Card className="space-y-3 p-4">
          <Select label={mode === "transfer" ? "From student" : "Student"} value={studentId} onChange={(e) => { setStudentId(e.target.value); setQty({}); }}>
            <option value="">Choose a student…</option>
            {(students.data ?? []).filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
          </Select>
          {mode === "transfer" && (
            <Select label="To student" value={toId} onChange={(e) => setToId(e.target.value)}>
              <option value="">Choose a student…</option>
              {(students.data ?? []).filter((s) => s.active && s.id !== studentId).map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
            </Select>
          )}
        </Card>

        {!studentId ? (
          <Card><EmptyState icon={<PackagePlus className="size-6" />} title="Choose a student to start" /></Card>
        ) : (
          <Section title={mode === "assign" ? "From the warehouse" : "Books the student holds"}>
            <label className="flex h-12 items-center gap-2 rounded-2xl bg-elevated px-4 shadow-card ring-1 ring-line">
              <Search className="size-4 text-subtle" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Code or title" className="h-full w-full bg-transparent outline-none" />
            </label>
            {(mode === "assign" ? books.loading && !books.data : inv.loading && !inv.data) ? <PageLoader /> : rows.length === 0 ? (
              <Card><EmptyState title={mode === "assign" ? "No books match" : "This student holds no books"} /></Card>
            ) : (
              <Card className="divide-y divide-line">
                {rows.map((r) => (
                  <div key={r.book_id} className="flex items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2"><Badge tone="navy">{r.code}</Badge>
                        <span className="text-xs text-subtle">{r.price == null ? "No price" : money(r.price, settings.currency)}</span></div>
                      <div className="mt-0.5 truncate text-sm text-muted">{r.name ?? "Name not set"}</div>
                      <div className="text-xs text-subtle">{r.hint}{mode === "assign" && r.holds ? ` · student holds ${r.holds}` : ""}</div>
                    </div>
                    <Stepper value={qty[r.book_id] ?? 0} min={0} max={r.max} label={r.code}
                      onChange={(n) => setQty((q) => ({ ...q, [r.book_id]: n }))} />
                  </div>
                ))}
              </Card>
            )}
            <TextArea label="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Section>
        )}
      </div>

      {studentId && (
        <div className="material fixed inset-x-0 z-30 border-t border-line" style={{ bottom: "calc(4rem + env(safe-area-inset-bottom, 0px))" }}>
          <div className="mx-auto max-w-lg space-y-2 px-5 py-3">
            {error && <Notice tone="danger">{error}</Notice>}
            <Button size="lg" block disabled={total === 0 || (mode === "transfer" && !toId)} loading={busy} onClick={submit}>
              {mode === "assign" ? <PackagePlus className="size-5" /> : mode === "receive" ? <PackageMinus className="size-5" /> : <ArrowLeftRight className="size-5" />}
              {verb} {total || ""} book{total === 1 ? "" : "s"}
            </Button>
          </div>
        </div>
      )}
    </>
  );
}

export default function LeaderInventory() {
  return <Suspense fallback={<PageLoader />}><InventoryDesk /></Suspense>;
}
