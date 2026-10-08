"use client";

import { useState } from "react";
import { BookOpen, Plus } from "lucide-react";
import { useApp } from "@/lib/app-context";
import { useData } from "@/lib/hooks";
import { getBooks } from "@/lib/queries";
import { sb, toAppError } from "@/lib/supabase";
import { money } from "@/lib/format";
import type { Book } from "@/lib/types";
import { Badge, Button, Card, EmptyState, Field, ListGroup, MoneyInput, Notice, PageLoader, Section, Sheet, Toggle } from "@/components/ui";
import { PageHeader } from "@/components/app/shell";

const EMPTY = { id: null as string | null, code: "", name: "", category: "", price: "", language: "", active: true };

export default function BooksPage() {
  const { settings, toast } = useApp();
  const books = useData<Book[]>("a:books", () => getBooks(true));
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);

  const list = books.data ?? [];
  const incomplete = list.filter((b) => b.active && (!b.name || b.unit_value === null)).length;
  const groups = new Map<string, Book[]>();
  for (const b of list) {
    const k = b.category?.trim() || "Uncategorized";
    groups.set(k, [...(groups.get(k) ?? []), b]);
  }

  function openNew() { setForm(EMPTY); setOpen(true); }
  function openEdit(b: Book) {
    setForm({ id: b.id, code: b.code, name: b.name ?? "", category: b.category ?? "", price: b.unit_value === null ? "" : String(b.unit_value), language: b.language ?? "", active: b.active });
    setOpen(true);
  }

  async function save() {
    const code = form.code.trim().toUpperCase();
    if (!code) return toast("Enter a book code", "error");
    const price = form.price.trim() === "" ? null : Number(form.price);
    if (price !== null && (!Number.isFinite(price) || price < 0)) return toast("Enter a valid price", "error");
    const row = {
      code, name: form.name.trim() || null, category: form.category.trim() || null,
      unit_value: price, language: form.language.trim() || null, active: form.active, updated_at: new Date().toISOString(),
    };
    setBusy(true);
    try {
      const res = form.id
        ? await sb().from("books").update(row).eq("id", form.id)
        : await sb().from("books").insert({ ...row, sort_order: list.reduce((m, b) => Math.max(m, b.sort_order), 0) + 1 });
      if (res.error) throw toAppError(res.error);
      await books.refresh();
      setOpen(false);
      toast("Book saved", "success");
    } catch (e) {
      toast(toAppError(e).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader back="/a" title="Books" action={<Button size="sm" onClick={openNew}><Plus className="size-4" /> Add</Button>} />
      <div className="space-y-6 px-5">
        {incomplete > 0 && (
          <Notice tone="warning">{incomplete} active {incomplete === 1 ? "book has" : "books have"} no name or price. Admin must complete these before they can be sold.</Notice>
        )}
        {!books.data ? <PageLoader /> : list.length === 0 ? (
          <Card><EmptyState icon={<BookOpen className="size-6" />} title="No books yet" body="Add the first book to your catalog." action={<Button onClick={openNew}>Add book</Button>} /></Card>
        ) : (
          [...groups.entries()].map(([cat, items]) => (
            <Section key={cat} title={cat}>
              <ListGroup>
                {items.map((b) => (
                  <button key={b.id} type="button" onClick={() => openEdit(b)}
                    className="pressable flex min-h-14 w-full items-center gap-3 px-4 py-3 text-start active:bg-sunken">
                    <Badge tone="navy">{b.code}</Badge>
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate font-medium ${b.name ? "" : "text-warning"}`}>{b.name ?? "Name not set"}</span>
                      <span className="block truncate text-sm text-muted">
                        {[b.language, `Warehouse ${b.warehouse_qty}`].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      {b.unit_value === null ? <Badge tone="warning">No price</Badge> : <span className="font-semibold text-numeric">{money(b.unit_value, settings.currency)}</span>}
                      {!b.active && <Badge tone="danger">Inactive</Badge>}
                    </span>
                  </button>
                ))}
              </ListGroup>
            </Section>
          ))
        )}
      </div>

      <Sheet open={open} onClose={() => setOpen(false)} title={form.id ? "Edit book" : "New book"}
        footer={<Button block size="lg" loading={busy} onClick={save}>Save</Button>}>
        <div className="space-y-3 pb-2">
          <Field label="Code" value={form.code} autoCapitalize="characters" onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} />
          <Field label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Field label="Category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
          <MoneyInput label="Price per book" currency={settings.currency} value={form.price} onChange={(v) => setForm({ ...form, price: v })}
            hint="Books without a price cannot be sold." />
          <Field label="Language" value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })} />
          <Card><Toggle label="Active" description="Inactive books cannot be sold" checked={form.active} onChange={(v) => setForm({ ...form, active: v })} /></Card>
        </div>
      </Sheet>
    </>
  );
}
