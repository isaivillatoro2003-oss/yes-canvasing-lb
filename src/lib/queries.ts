"use client";

import { rpc, sb, toAppError } from "./supabase";
import type { Book, InventoryRow, ReportSummary, WorkSession } from "./types";

async function q<T>(p: PromiseLike<{ data: unknown; error: unknown }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw toAppError(error);
  return data as T;
}

export const getActiveSession = (uid: string) =>
  q<WorkSession | null>(
    sb().from("work_sessions").select("*").eq("user_id", uid).in("status", ["active", "paused"])
      .order("started_at", { ascending: false }).limit(1).maybeSingle(),
  );

export const getInventory = (uid: string) =>
  q<InventoryRow[]>(
    sb().from("inventory").select("*, books(*)").eq("user_id", uid).order("book_id"),
  ).then((rows) =>
    rows.sort((a, b) => (a.books?.sort_order ?? 0) - (b.books?.sort_order ?? 0) || (a.books?.code ?? "").localeCompare(b.books?.code ?? "")),
  );

export const getBooks = (includeInactive = false) => {
  let query = sb().from("books").select("*").order("sort_order").order("code");
  if (!includeInactive) query = query.eq("active", true);
  return q<Book[]>(query);
};

export const getReport = (args: {
  from?: string | null; to?: string | null; user?: string | null; team?: string | null; leader?: string | null;
  territory?: string | null; book?: string | null; method?: string | null;
}) =>
  rpc<ReportSummary>("report_summary", {
    p_from: args.from ?? null, p_to: args.to ?? null, p_user: args.user ?? null, p_team: args.team ?? null,
    p_leader: args.leader ?? null, p_territory: args.territory ?? null, p_book: args.book ?? null, p_method: args.method ?? null,
  });
