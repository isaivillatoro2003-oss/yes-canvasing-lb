/**
 * A small PostgREST emulator for the demo.
 *
 * The real app talks to Supabase through supabase-js, which turns every query into
 * an HTTP request to PostgREST. In demo mode we hand supabase-js a custom `fetch`
 * that answers those requests from a Postgres database running *inside the
 * browser* (PGlite) with the exact same migrations. Every rule, permission and
 * calculation is the real one — but nothing ever leaves the visitor's device.
 *
 * Supported: select with nested embeds (many-to-one, one-to-many, `!fk_hint`,
 * `!inner`), filters eq/neq/gt/gte/lt/lte/in/is/like/ilike (also on embeds),
 * order, limit/offset, single-object responses, insert/update/delete with
 * `return=representation`, and RPC calls (scalar, composite and set-returning).
 * Requests run as role `authenticated` (or `anon`) with the demo user's id as
 * the JWT subject, so Row Level Security applies exactly as in production.
 */

export type DemoDb = {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  transaction<T>(fn: (tx: { query: DemoDb["query"]; exec(sql: string): Promise<unknown> }) => Promise<T>): Promise<T>;
};

type Fk = { conname: string; tbl: string; ftbl: string; cols: string[]; fcols: string[] };
type Field = { kind: "col"; name: string } | { kind: "star" } | { kind: "embed"; name: string; hints: string[]; fields: Field[] };
type Filter = { path: string[]; col: string; op: string; value: string };

const IDENT = /^[a-z_][a-z0-9_]*$/;
function ident(s: string): string {
  if (!IDENT.test(s)) throw new PgrstError(400, "PGRST100", `Invalid identifier: ${s}`);
  return `"${s}"`;
}

class PgrstError extends Error {
  constructor(public status: number, public code: string, message: string, public details: string | null = null, public hint: string | null = null) {
    super(message);
  }
}

/* ───────── select parser ───────── */
function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0, cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

export function parseSelect(s: string | null): Field[] {
  if (!s || s.trim() === "") return [{ kind: "star" }];
  return splitTop(s).map((item): Field => {
    if (item === "*") return { kind: "star" };
    const open = item.indexOf("(");
    if (open > 0 && item.endsWith(")")) {
      const head = item.slice(0, open).replace(/^[a-z_0-9]+:/, ""); // ignore aliases
      const [name, ...hints] = head.split("!");
      return { kind: "embed", name, hints, fields: parseSelect(item.slice(open + 1, -1)) };
    }
    return { kind: "col", name: item.replace(/^[a-z_0-9]+:/, "").replace(/::[a-z]+$/, "") };
  });
}

/* ───────── SQL builder ───────── */
export class Translator {
  private fks: Fk[] = [];
  private setReturning = new Map<string, boolean>();
  private n = 0;

  async load(db: DemoDb) {
    const r = await db.query<Fk>(`
      select c.conname, cl.relname as tbl, ft.relname as ftbl,
        (select array_agg(a.attname::text order by k.ord) from unnest(c.conkey) with ordinality k(attnum, ord)
           join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) as cols,
        (select array_agg(a.attname::text order by k.ord) from unnest(c.confkey) with ordinality k(attnum, ord)
           join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.attnum) as fcols
      from pg_constraint c
      join pg_class cl on cl.oid = c.conrelid
      join pg_class ft on ft.oid = c.confrelid
      join pg_namespace n on n.oid = cl.relnamespace
      where c.contype = 'f' and n.nspname = 'public'`);
    this.fks = r.rows;
    const f = await db.query<{ proname: string; proretset: boolean }>(
      `select p.proname, p.proretset from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'`);
    for (const row of f.rows) this.setReturning.set(row.proname, row.proretset);
  }

  isSetReturning(fn: string) { return this.setReturning.get(fn) ?? false; }

  private relation(parent: string, name: string, hints: string[]) {
    const fkHint = hints.find((h) => h !== "inner" && h !== "left");
    let cands = [
      ...this.fks.filter((f) => f.tbl === parent && f.ftbl === name).map((f) => ({ f, many: false })),
      ...this.fks.filter((f) => f.tbl === name && f.ftbl === parent).map((f) => ({ f, many: true })),
    ];
    if (fkHint) cands = cands.filter((c) => c.f.conname === fkHint || c.f.cols.includes(fkHint));
    if (cands.length === 0) throw new PgrstError(400, "PGRST200", `Could not find a relationship between '${parent}' and '${name}'`);
    if (cands.length > 1) throw new PgrstError(300, "PGRST201", `More than one relationship was found for '${parent}' and '${name}'`);
    return cands[0];
  }

  private alias() { return `t${++this.n}`; }

  /** Columns + embeds of one level, as a SELECT list over `alias`. */
  private selectList(table: string, alias: string, fields: Field[], filters: Filter[], path: string[], params: unknown[]): string {
    const parts: string[] = [];
    for (const f of fields) {
      if (f.kind === "star") parts.push(`${alias}.*`);
      else if (f.kind === "col") parts.push(`${alias}.${ident(f.name)}`);
      else parts.push(`(${this.embed(table, alias, f, filters, [...path, f.name], params)}) as ${ident(f.name)}`);
    }
    return parts.join(", ");
  }

  private joinCond(parentAlias: string, childAlias: string, rel: { f: Fk; many: boolean }) {
    // many: child.cols → parent.fcols ; one: parent.cols → child.fcols
    return rel.f.cols.map((c, i) => rel.many
      ? `${childAlias}.${ident(c)} = ${parentAlias}.${ident(rel.f.fcols[i])}`
      : `${childAlias}.${ident(rel.f.fcols[i])} = ${parentAlias}.${ident(c)}`).join(" and ");
  }

  private embed(parent: string, parentAlias: string, f: Extract<Field, { kind: "embed" }>, filters: Filter[], path: string[], params: unknown[]): string {
    const rel = this.relation(parent, f.name, f.hints);
    const a = this.alias();
    const where = [this.joinCond(parentAlias, a, rel), ...this.filterSql(a, filters.filter((x) => same(x.path, path)), params)];
    const inner = `select ${this.selectList(f.name, a, f.fields, filters, path, params)} from public.${ident(f.name)} ${a} where ${where.join(" and ")}`;
    return rel.many
      ? `select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) from (${inner}) s`
      : `select to_jsonb(s) from (${inner} limit 1) s`;
  }

  /** `exists(...)` conditions for `!inner` embeds (only rows whose embed matches). */
  private innerConds(table: string, alias: string, fields: Field[], filters: Filter[], path: string[], params: unknown[]): string[] {
    const out: string[] = [];
    for (const f of fields) {
      if (f.kind !== "embed" || !f.hints.includes("inner")) continue;
      const rel = this.relation(table, f.name, f.hints);
      const a = this.alias();
      const sub = [this.joinCond(alias, a, rel), ...this.filterSql(a, filters.filter((x) => same(x.path, [...path, f.name])), params),
        ...this.innerConds(f.name, a, f.fields, filters, [...path, f.name], params)];
      out.push(`exists (select 1 from public.${ident(f.name)} ${a} where ${sub.join(" and ")})`);
    }
    return out;
  }

  private filterSql(alias: string, filters: Filter[], params: unknown[]): string[] {
    return filters.map((x) => {
      const col = `${alias}.${ident(x.col)}`;
      const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
      switch (x.op) {
        case "eq": return `${col}::text = ${p(x.value)}`;
        case "neq": return `${col}::text <> ${p(x.value)}`;
        case "gt": return `${col} > ${p(x.value)}`;
        case "gte": return `${col} >= ${p(x.value)}`;
        case "lt": return `${col} < ${p(x.value)}`;
        case "lte": return `${col} <= ${p(x.value)}`;
        case "like": return `${col}::text like ${p(x.value.replace(/\*/g, "%"))}`;
        case "ilike": return `${col}::text ilike ${p(x.value.replace(/\*/g, "%"))}`;
        case "in": {
          const items = x.value.replace(/^\(|\)$/g, "").split(",").map((v) => v.trim().replace(/^"|"$/g, "")).filter((v) => v !== "");
          return items.length ? `${col}::text = any(${p(items)}::text[])` : "false";
        }
        case "is": {
          const v = x.value.toLowerCase();
          if (v === "null") return `${col} is null`;
          if (v === "true") return `${col} is true`;
          if (v === "false") return `${col} is false`;
          throw new PgrstError(400, "PGRST100", `Unsupported is value ${x.value}`);
        }
        default: throw new PgrstError(400, "PGRST100", `Unsupported operator ${x.op}`);
      }
    });
  }

  buildSelect(table: string, url: URL, params: unknown[]): string {
    this.n = 0;
    const fields = parseSelect(url.searchParams.get("select"));
    const filters = parseFilters(url);
    const a = this.alias();
    const where = [
      ...this.filterSql(a, filters.filter((x) => x.path.length === 0), params),
      ...this.innerConds(table, a, fields, filters, [], params),
    ];
    const order = parseOrder(url.searchParams.get("order"), a);
    const limit = url.searchParams.get("limit");
    const offset = url.searchParams.get("offset");
    let sql = `select ${this.selectList(table, a, fields, filters, [], params)} from public.${ident(table)} ${a}`;
    if (where.length) sql += ` where ${where.join(" and ")}`;
    if (order) sql += ` order by ${order}`;
    if (limit && /^\d+$/.test(limit)) sql += ` limit ${limit}`;
    if (offset && /^\d+$/.test(offset)) sql += ` offset ${offset}`;
    return `select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) as v from (${sql}) r`;
  }

  whereFor(url: URL, alias: string, params: unknown[]): string {
    this.n = 0;
    const filters = parseFilters(url).filter((x) => x.path.length === 0);
    const w = this.filterSql(alias, filters, params);
    return w.length ? w.join(" and ") : "true";
  }
}

function same(a: string[], b: string[]) { return a.length === b.length && a.every((x, i) => x === b[i]); }

const RESERVED = new Set(["select", "order", "limit", "offset", "columns", "on_conflict"]);
function parseFilters(url: URL): Filter[] {
  const out: Filter[] = [];
  url.searchParams.forEach((value, key) => {
    if (RESERVED.has(key)) return;
    const segs = key.split(".");
    const col = segs.pop()!;
    const dot = value.indexOf(".");
    let op = value.slice(0, dot);
    let v = value.slice(dot + 1);
    if (op === "not") { // not.eq.x → neq
      const d2 = v.indexOf(".");
      const inner = v.slice(0, d2);
      v = v.slice(d2 + 1);
      if (inner === "eq") op = "neq"; else throw new PgrstError(400, "PGRST100", `Unsupported not.${inner}`);
    }
    out.push({ path: segs, col, op, value: v });
  });
  return out;
}

function parseOrder(s: string | null, alias: string): string {
  if (!s) return "";
  return s.split(",").map((part) => {
    const [col, ...mods] = part.split(".");
    if (col.includes("(")) throw new PgrstError(400, "PGRST100", "Ordering by embedded columns is not supported in the demo");
    let sql = `${alias}.${ident(col)}`;
    if (mods.includes("desc")) sql += " desc"; else sql += " asc";
    if (mods.includes("nullsfirst")) sql += " nulls first";
    if (mods.includes("nullslast")) sql += " nulls last";
    return sql;
  }).join(", ");
}

/* ───────── fetch handler ───────── */
function json(body: unknown, status = 200): Response {
  return new Response(body === undefined ? "" : JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function pgToHttp(e: unknown): Response {
  if (e instanceof PgrstError) return json({ code: e.code, message: e.message, details: e.details, hint: e.hint }, e.status);
  const err = e as { message?: string; code?: string; detail?: string; hint?: string };
  const code = err.code ?? "";
  const status = code === "42501" ? 403 : code === "P0001" ? 400 : code.startsWith("23") ? 409 : 400;
  return json({ code, message: err.message ?? String(e), details: err.detail ?? null, hint: err.hint ?? null }, status);
}

export function createDemoFetch(db: DemoDb, tr: Translator, getUid: () => string | null): typeof fetch {
  async function run<T>(sql: string, params: unknown[]): Promise<T[]> {
    const uid = getUid();
    return db.transaction(async (tx) => {
      await tx.exec(`set local role ${uid ? "authenticated" : "anon"}`);
      await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid ?? ""]);
      return (await tx.query<T>(sql, params)).rows;
    });
  }

  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input as RequestInfo, init);
    const url = new URL(req.url);
    const method = req.method.toUpperCase();
    try {
      if (url.pathname.startsWith("/auth/v1/")) {
        // The demo has no real accounts; perspective switching happens in the app.
        return json({ error: "demo", error_description: "Sign-in is simulated in the demo." }, 400);
      }
      const m = url.pathname.match(/^\/rest\/v1\/(rpc\/)?([a-z_0-9]+)$/);
      if (!m) return json({ message: "Not found" }, 404);
      const [, isRpc, name] = m;
      const wantsObject = (req.headers.get("Accept") ?? "").includes("vnd.pgrst.object+json");
      const prefer = req.headers.get("Prefer") ?? "";
      const body = method === "GET" || method === "DELETE" && !req.body ? null : await req.text();

      if (isRpc) {
        const args = body ? (JSON.parse(body) as Record<string, unknown>) : Object.fromEntries(url.searchParams);
        const names = Object.keys(args).filter((k) => IDENT.test(k));
        const params = names.map((k) => { const v = args[k]; return v !== null && typeof v === "object" ? JSON.stringify(v) : v; });
        const call = `public.${ident(name)}(${names.map((k, i) => `${ident(k)} => $${i + 1}`).join(", ")})`;
        const sql = tr.isSetReturning(name)
          ? `select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) as v from ${call} x`
          : `select to_jsonb(${call}) as v`;
        const rows = await run<{ v: unknown }>(sql, params);
        return json(rows[0]?.v ?? null);
      }

      const table = name;
      const params: unknown[] = [];
      if (method === "GET" || method === "HEAD") {
        const rows = await run<{ v: unknown[] }>(tr.buildSelect(table, url, params), params);
        const data = rows[0]?.v ?? [];
        if (wantsObject) {
          if (data.length !== 1) return json({ code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned", details: `Results contain ${data.length} rows`, hint: null }, 406);
          return json(data[0]);
        }
        return json(data);
      }

      const returning = prefer.includes("return=representation");
      let sql: string;
      if (method === "POST") {
        const payload = JSON.parse(body || "[]");
        params.push(JSON.stringify(Array.isArray(payload) ? payload : [payload]));
        const cols = Object.keys(Array.isArray(payload) ? payload[0] ?? {} : payload).filter((k) => IDENT.test(k)).map(ident);
        sql = `insert into public.${ident(table)} (${cols.join(", ")})
               select ${cols.join(", ")} from jsonb_populate_recordset(null::public.${ident(table)}, $1::jsonb)
               returning *`;
      } else if (method === "PATCH") {
        const payload = JSON.parse(body || "{}") as Record<string, unknown>;
        params.push(JSON.stringify(payload));
        const sets = Object.keys(payload).filter((k) => IDENT.test(k)).map((k) => `${ident(k)} = r.${ident(k)}`);
        const where = tr.whereFor(url, "t", params);
        sql = `update public.${ident(table)} t set ${sets.join(", ")}
               from jsonb_populate_record(null::public.${ident(table)}, $1::jsonb) r where ${where} returning t.*`;
      } else if (method === "DELETE") {
        sql = `delete from public.${ident(table)} t where ${tr.whereFor(url, "t", params)} returning t.*`;
      } else {
        return json({ message: `Method ${method} not supported in the demo` }, 405);
      }
      const rows = await run<{ v: unknown[] }>(`with w as (${sql}) select coalesce(jsonb_agg(to_jsonb(w)), '[]'::jsonb) as v from w`, params);
      const data = rows[0]?.v ?? [];
      if (!returning) return new Response(null, { status: method === "POST" ? 201 : 204 });
      return json(wantsObject ? data[0] ?? null : data, method === "POST" ? 201 : 200);
    } catch (e) {
      return pgToHttp(e);
    }
  };
}
