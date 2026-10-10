/**
 * Runs the real migrations inside PGlite (Postgres compiled to WASM) with a
 * small shim of Supabase's auth schema and roles, so the database rules can be
 * tested on any laptop without Docker or a cloud project.
 */
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SHIM } from "../../src/lib/demo/shim";



export async function createDb() {
  const db = new PGlite();
  await db.exec(SHIM);
  const dir = join(process.cwd(), "supabase", "migrations");
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
    try {
      await db.exec(readFileSync(join(dir, f), "utf8"));
    } catch (e) {
      throw new Error(`Migration ${f} failed: ${(e as Error).message}`);
    }
  }
  return db;
}

export type Db = Awaited<ReturnType<typeof createDb>>;

/** Run SQL as a signed-in browser user (role authenticated + JWT sub), like PostgREST does. */
export async function as<T = Record<string, unknown>>(db: Db, uid: string | null, sql: string, params: unknown[] = []): Promise<T[]> {
  return db.transaction(async (tx) => {
    await tx.exec(`set local role ${uid ? "authenticated" : "anon"}`);
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid ?? ""]);
    const r = await tx.query<T>(sql, params);
    return r.rows;
  });
}

/** Call an RPC as a user and return its single value. */
export async function call<T = unknown>(db: Db, uid: string | null, fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const names = Object.keys(args);
  const sql = `select to_jsonb(public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(", ")})) as v`;
  const rows = await as<{ v: T }>(db, uid, sql, names.map((n) => {
    const v = args[n];
    return v !== null && typeof v === "object" ? JSON.stringify(v) : v;
  }));
  return rows[0]!.v;
}

/** Simulates Supabase Auth inserting a user (this fires the sign-up trigger). */
export async function signUp(db: Db, email: string, meta: Record<string, unknown>, appMeta: Record<string, unknown> = {}): Promise<string> {
  const r = await db.query<{ id: string }>(
    `insert into auth.users (email, raw_user_meta_data, raw_app_meta_data) values ($1, $2, $3) returning id`,
    // Real sign-ups from the app always send privacy_accepted; tests opt out explicitly.
    [email, JSON.stringify({ privacy_accepted: "true", ...meta }), JSON.stringify(appMeta)],
  );
  return r.rows[0]!.id;
}

export async function expectError(p: Promise<unknown>, match: RegExp): Promise<string> {
  try {
    await p;
  } catch (e) {
    const msg = (e as Error).message;
    if (!match.test(msg)) throw new Error(`Expected error ${match}, got: ${msg}`);
    return msg;
  }
  throw new Error(`Expected error ${match}, but the call succeeded`);
}
