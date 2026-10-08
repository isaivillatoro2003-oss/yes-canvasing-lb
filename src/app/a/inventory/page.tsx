"use client";

import { useState } from "react";
import { Boxes, PackagePlus } from "lucide-react";
import { useApp } from "@/lib/app-context";
import { useData } from "@/lib/hooks";
import { getBooks } from "@/lib/queries";
import { rpc, sb, toAppError } from "@/lib/supabase";
import { dateTimeLabel } from "@/lib/format";
import type { Book, InventoryRow, Profile } from "@/lib/types";
import { Badge, Button, Card, EmptyState, LinkButton, ListGroup, ListRow, PageLoader, Segmented, Sheet, Stepper, TextArea } from "@/components/ui";
import { PageHeader } from "@/components/app/shell";
import { DetailLine, unwrap } from "@/components/admin/bits";

type Seg = "warehouse" | "students" | "history";
type Student = Pick<Profile, "id" | "full_name" | "email">;
type Movement = {
  id: string; movement_type: string; quantity: number; created_at: string; notes: string | null;
  books: { code: string } | null; profiles: { full_name: string } | null;
};
type Target = { student: Student | null; book: Book | { id: string; code: string; name: string | null }; current: number };

const MOVE_LABEL: Record<string, string> = {
  ASSIGN: "Assigned", SALE: "Sale", RETURN: "Return", ADJUSTMENT: "Adjustment", TRANSFER_IN: "Transfer in",
  TRANSFER_OUT: "Transfer out", WAREHOUSE_IN: "Warehouse in", CANCEL_SALE: "Sale cancelled",
};

export default function AdminInventory() {
  const { settings, toast } = useApp();
  const [seg, setSeg] = useState<Seg>("warehouse");
  const books = useData<Book[]>("a:inv-books", () => getBooks(true));
  const students = useData<Student[]>("a:inv-students", async () => {
    const res = await sb().from("profiles").select("id, full_name, email").eq("role", "student").eq("active", true).order("full_name");
    return unwrap<Student[]>(res, toAppError);
  });
  const rows = useData<InventoryRow[]>("a:inv-rows", async () => {
    const res = await sb().from("inventory").select("*, books(*)").limit(5000);
    return unwrap<InventoryRow[]>(res, toAppError);
  });
  const moves = useData<Movement[]>("a:inv-moves", async () => {
    const res = await sb().from("inventory_movements")
      .select("id, movement_type, quantity, created_at, notes, books(code), profiles!inventory_movements_user_id_fkey(full_name)")
      .order("created_at", { ascending: false }).limit(50);
    return unwrap<Movement[]>(res, toAppError);
  });

  const [selStudent, setSelStudent] = useState<Student | null>(null);
  const [target, setTarget] = useState<Target | null>(null);
  const [sign, setSign] = useState<"add" | "remove">("add");
  const [qty, setQty] = useState(1);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const remainingBy = new Map<string, number>();
  for (const r of rows.data ?? []) remainingBy.set(r.user_id, (remainingBy.get(r.user_id) ?? 0) + r.remaining);
  const studentRows = (rows.data ?? [])
    .filter((r) => r.user_id === selStudent?.id)
    .sort((a, b) => (a.books?.sort_order ?? 0) - (b.books?.sort_order ?? 0));

  function startAdjust(t: Target) { setTarget(t); setSign("add"); setQty(1); setNotes(""); }

  async function submit() {
    if (!target) return;
    if (target.student && !notes.trim()) return toast("Explain the adjustment", "error");
    const delta = sign === "add" ? qty : -qty;
    if (qty < 1) return toast("Enter a quantity", "error");
    setBusy(true);
    try {
      if (target.student) {
        await rpc("student_inventory_adjust", { p_student: target.student.id, p_book: target.book.id, p_delta: delta, p_notes: notes.trim() });
      } else {
        await rpc("warehouse_adjust", { p_book: target.book.id, p_delta: delta, p_notes: notes.trim() || null });
      }
      await Promise.all([books.refresh(), rows.refresh(), moves.refresh()]);
      setTarget(null);
      toast("Inventory updated", "success");
    } catch (e) {
      toast(toAppError(e).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Inventory" />
      <div className="space-y-4 px-5">
        <LinkButton block href="/l/inventory"><PackagePlus className="size-5" /> Assign / receive books</LinkButton>
        <Segmented<Seg> value={seg} onChange={setSeg} options={[
          { value: "warehouse", label: "Warehouse" }, { value: "students", label: "Students" }, { value: "history", label: "History" },
        ]} />

        {seg === "warehouse" && (!books.data ? <PageLoader /> : books.data.length === 0 ? (
          <Card><EmptyState icon={<Boxes className="size-6" />} title="No books in the catalog" body="Add books first, then receive stock here." /></Card>
        ) : (
          <ListGroup>
            {books.data.map((b) => (
              <ListRow key={b.id} onClick={() => startAdjust({ student: null, book: b, current: b.warehouse_qty })}
                icon={<span className="text-[10px] font-bold">{b.code}</span>}
                title={b.name ?? "Name not set"}
                subtitle={b.active ? b.code : `${b.code} · Inactive`}
                trailing={<span className="text-lg font-bold text-fg text-numeric">{b.warehouse_qty}</span>} />
            ))}
          </ListGroup>
        ))}

        {seg === "students" && (!students.data || !rows.data ? <PageLoader /> : students.data.length === 0 ? (
          <Card><EmptyState icon={<Boxes className="size-6" />} title="No active students" body="Students appear here once they sign up." /></Card>
        ) : (
          <ListGroup>
            {students.data.map((s) => (
              <ListRow key={s.id} onClick={() => setSelStudent(s)} title={s.full_name} subtitle={s.email}
                trailing={<span className="text-lg font-bold text-fg text-numeric">{remainingBy.get(s.id) ?? 0}</span>} />
            ))}
          </ListGroup>
        ))}

        {seg === "history" && (!moves.data ? <PageLoader /> : moves.data.length === 0 ? (
          <Card><EmptyState icon={<Boxes className="size-6" />} title="No movements yet" body="Stock changes will be listed here." /></Card>
        ) : (
          <ListGroup>
            {moves.data.map((m) => (
              <ListRow key={m.id} chevron={false}
                icon={<span className="text-[10px] font-bold">{m.books?.code ?? "?"}</span>}
                title={`${MOVE_LABEL[m.movement_type] ?? m.movement_type} · ${m.quantity > 0 ? "+" : ""}${m.quantity}`}
                subtitle={`${m.profiles?.full_name ?? "Warehouse"} · ${dateTimeLabel(m.created_at, settings.timezone)}${m.notes ? ` · ${m.notes}` : ""}`} />
            ))}
          </ListGroup>
        ))}
      </div>

      <Sheet open={!!selStudent && !target} onClose={() => setSelStudent(null)} title={selStudent?.full_name}>
        {studentRows.length === 0 ? (
          <p className="pb-4 text-sm text-muted">This student holds no books yet. Use Assign / receive books to give them some.</p>
        ) : (
          <div className="pb-2">
            <ListGroup>
              {studentRows.map((r) => (
                <div key={r.book_id} className="flex items-center gap-3 px-4 py-3">
                  <Badge tone="navy">{r.books?.code ?? "?"}</Badge>
                  <div className="min-w-0 flex-1 text-sm text-muted">
                    <div className="font-medium text-fg">{r.remaining} remaining</div>
                    <div>Assigned {r.assigned} · Distributed {r.distributed} · Returned {r.returned}</div>
                  </div>
                  <Button size="sm" variant="secondary"
                    onClick={() => selStudent && startAdjust({ student: selStudent, book: r.books ?? { id: r.book_id, code: "?", name: null }, current: r.remaining })}>
                    Adjust
                  </Button>
                </div>
              ))}
            </ListGroup>
          </div>
        )}
      </Sheet>

      <Sheet open={!!target} onClose={() => setTarget(null)}
        title={target ? (target.student ? `Adjust ${target.book.code}` : "Receive stock / Adjust") : undefined}
        footer={<Button block size="lg" loading={busy} onClick={submit}>Save</Button>}>
        {target && (
          <div className="space-y-4 pb-2">
            <ListGroup>
              <DetailLine label="Book" value={`${target.book.code}${target.book.name ? ` · ${target.book.name}` : ""}`} />
              <DetailLine label={target.student ? `${target.student.full_name} holds` : "In warehouse"} value={target.current} />
            </ListGroup>
            <Segmented value={sign} onChange={setSign} options={[
              { value: "add", label: target.student ? "Add" : "Receive (+)" }, { value: "remove", label: target.student ? "Remove" : "Correct (−)" },
            ]} />
            <div className="flex items-center justify-between px-1">
              <span className="text-sm font-medium text-muted">Quantity</span>
              <Stepper value={qty} onChange={setQty} min={1} label="Quantity" />
            </div>
            <p className="px-1 text-sm text-muted">New total: <span className="font-semibold text-fg">{target.current + (sign === "add" ? qty : -qty)}</span></p>
            <TextArea label={target.student ? "Reason (required)" : "Notes (optional)"} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        )}
      </Sheet>
    </>
  );
}
