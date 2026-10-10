"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createDemoFetch, Translator, type DemoDb } from "./postgrest";
import { demoPerspective } from "./state";
import { SHIM } from "./shim";
import { MIGRATIONS } from "./schema.generated";
import { DEMO_USERS, seedDemo, type DemoKey } from "./seed";
import type { Role } from "../types";

const DATA_DIR = "idb://yes-demo-v1";
const PERSPECTIVE_USER: Record<Role, DemoKey> = { student: "maya", leader: "leader", admin: "admin" };

type Engine = { client: SupabaseClient; ids: Record<DemoKey, string>; close: () => Promise<void> };
let engine: Promise<Engine> | null = null;

async function compile(url: string): Promise<WebAssembly.Module> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load ${url}`);
  try {
    return await WebAssembly.compileStreaming(res.clone());
  } catch {
    return WebAssembly.compile(await res.arrayBuffer());
  }
}

/**
 * Starts (once per page) a Postgres database inside the browser with the app's real
 * migrations and fictional data, and a Supabase client whose requests are answered
 * by that database. Nothing is ever sent to the real backend.
 */
export function startDemo(onStep?: (step: string) => void): Promise<Engine> {
  if (engine) return engine;
  engine = (async () => {
    onStep?.("Loading the demo database…");
    const { PGlite } = await import("@electric-sql/pglite");
    const [pgliteWasmModule, initdbWasmModule, fsBundle] = await Promise.all([
      compile("/pglite/pglite.wasm"),
      compile("/pglite/initdb.wasm"),
      fetch("/pglite/pglite.data").then((r) => r.blob()),
    ]);
    const pg = await PGlite.create({ dataDir: DATA_DIR, pgliteWasmModule, initdbWasmModule, fsBundle, relaxedDurability: true });
    const db = pg as unknown as DemoDb;

    const ready = await db.query<{ ok: boolean }>(`select to_regclass('public.profiles') is not null as ok`);
    if (!ready.rows[0]?.ok) {
      onStep?.("Building the demo (first time only)…");
      await pg.exec(SHIM);
      for (const m of MIGRATIONS) await pg.exec(m);
      onStep?.("Adding example students, books and sales…");
      await seedDemo(db);
    }
    const users = await db.query<{ id: string; email: string }>(`select id, email from profiles where email like 'demo.%@example.com'`);
    const ids = {} as Record<DemoKey, string>;
    for (const [key, u] of Object.entries(DEMO_USERS) as [DemoKey, { email: string }][]) {
      ids[key] = users.rows.find((r) => r.email === u.email)?.id ?? "";
    }
    const tr = new Translator();
    await tr.load(db);
    const demoFetch = createDemoFetch(db, tr, () => ids[PERSPECTIVE_USER[demoPerspective()]] || null);
    const client = createClient("https://demo.yes.invalid", "demo-anon-key", {
      global: { fetch: demoFetch },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    return { client, ids, close: () => pg.close() };
  })();
  engine.catch(() => { engine = null; });
  return engine;
}

export function demoUserId(ids: Record<DemoKey, string>, as: Role): string {
  return ids[PERSPECTIVE_USER[as]];
}

/** Wipes the demo database; the next start re-creates it with fresh example data. */
export async function resetDemo() {
  try { await (await engine)?.close(); } catch { /* not started */ }
  engine = null;
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase("/pglite/yes-demo-v1");
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
}
