/**
 * The in-browser demo: real migrations + fictional seed, queried through supabase-js
 * with the PostgREST emulator — the same path the app uses in demo mode.
 * Run: npm run test:demo
 */
import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createDb, type Db } from "../db/harness";
import { createDemoFetch, Translator, type DemoDb } from "../../src/lib/demo/postgrest";
import { seedDemo, type DemoKey } from "../../src/lib/demo/seed";

let db: Db;
let ids: Record<DemoKey, string>;
let as: DemoKey = "maya";
let client: SupabaseClient;
const use = (k: DemoKey) => { as = k; return client; };
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Beirut" });

before(async () => {
  db = await createDb();
  ids = await seedDemo(db as unknown as DemoDb);
  const tr = new Translator();
  await tr.load(db as unknown as DemoDb);
  client = createClient("https://demo.yes.invalid", "demo-anon-key", {
    global: { fetch: createDemoFetch(db as unknown as DemoDb, tr, () => ids[as]) },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
});

describe("demo engine (PostgREST emulator over the real schema)", () => {
  it("leader sees their team with the team embed", async () => {
    const { data, error } = await use("leader").from("profiles").select("*, teams!profiles_team_fk(team_name)").eq("role", "student").order("full_name");
    assert.equal(error, null);
    assert.equal(data!.length, 4);
    assert.equal(data![0].teams.team_name, "Beirut Team");
  });

  it("a student sees only themself (RLS applies)", async () => {
    const { data } = await use("maya").from("profiles").select("id, full_name");
    assert.deepEqual(data!.map((p) => p.full_name), ["Maya Khoury"]);
  });

  it("active session via in() + order + maybeSingle", async () => {
    const { data, error } = await use("maya").from("work_sessions").select("*").eq("user_id", ids.maya)
      .in("status", ["active", "paused"]).order("started_at", { ascending: false }).limit(1).maybeSingle();
    assert.equal(error, null);
    assert.equal(data!.status, "active");
    const none = await use("omar").from("work_sessions").select("*").eq("user_id", ids.omar).in("status", ["active", "paused"]).limit(1).maybeSingle();
    assert.equal(none.data, null);
    assert.equal(none.error, null);
  });

  it("inventory with books(*)", async () => {
    const { data } = await use("maya").from("inventory").select("*, books(*)").eq("user_id", ids.maya);
    assert.ok(data!.length >= 5);
    assert.ok(data!.every((r) => typeof r.books.code === "string"));
  });

  it("transaction detail with nested one-to-many and hinted embeds", async () => {
    const { data: list } = await use("maya").from("transactions").select("*").eq("user_id", ids.maya).order("transaction_datetime", { ascending: false }).limit(100);
    const withCustomer = list!.find((t) => t.customer_id);
    const { data, error } = await client.from("transactions")
      .select("*, transaction_items(*, books(name)), payments(*), donations(*), customers(*), profiles!transactions_user_id_fkey(full_name), territories(territory_name)")
      .eq("id", withCustomer.id).maybeSingle();
    assert.equal(error, null);
    assert.equal(data.profiles.full_name, "Maya Khoury");
    assert.ok(data.transaction_items.length === 2 && data.transaction_items[0].books.name);
    assert.equal(data.customers.name, "Nadine (DEMO)");
    assert.equal(data.donations.length, 1);
  });

  it("finance filter: payments!inner + payments.method", async () => {
    const { data, error } = await use("admin").from("transactions")
      .select("*, profiles!transactions_user_id_fkey(full_name), payments!inner(method)").eq("payments.method", "whish");
    assert.equal(error, null);
    assert.ok(data!.length >= 1);
    assert.ok(data!.every((t) => t.payments.every((p: { method: string }) => p.method === "whish")));
  });

  it("live list for leaders (set-returning RPC): Maya working in Hamra, Karim paused", async () => {
    const { data, error } = await use("leader").rpc("active_sessions");
    assert.equal(error, null);
    const byName = Object.fromEntries(data.map((s: { full_name: string }) => [s.full_name, s]));
    assert.equal(byName["Maya Khoury"].status, "active");
    assert.equal(byName["Maya Khoury"].start_place, "Hamra, Beirut");
    assert.equal(byName["Karim Nassar"].status, "paused");
  });

  it("reports and yesterday's approved reconciliations", async () => {
    const r = await use("leader").rpc("report_summary", { p_from: today(), p_to: today() });
    assert.equal(r.error, null);
    assert.ok(r.data.transactions >= 4);
    const recons = await client.from("daily_reconciliations").select("*, profiles!daily_reconciliations_student_id_fkey(full_name)").order("work_date", { ascending: false });
    assert.equal(recons.data!.length, 2);
    assert.ok(recons.data!.every((x) => x.status === "approved"));
  });

  it("writes: insert a customer, schedule and update a follow-up; errors come back like Supabase", async () => {
    const ins = await use("omar").from("customers").insert({ created_by: ids.omar, name: "Test person", consent: false });
    assert.equal(ins.error, null);
    const { data: c } = await client.from("customers").select("*").eq("created_by", ids.omar).maybeSingle();
    const fu = await client.from("follow_ups").insert({ customer_id: c.id, assigned_to: ids.omar, created_by: ids.omar, follow_up_type: "Visit" });
    assert.equal(fu.error, null);
    const list = await client.from("follow_ups").select("*, customers(name, phone, city), profiles!follow_ups_assigned_to_fkey(full_name)")
      .order("due_date", { ascending: true, nullsFirst: false });
    assert.equal(list.data![0].customers.name, "Test person");
    const upd = await client.from("follow_ups").update({ status: "contacted" }).eq("id", list.data![0].id);
    assert.equal(upd.error, null);
    const bad = await client.rpc("admin_set_role", { p_user: ids.omar, p_role: "admin" });
    assert.match(bad.error!.message, /Only an admin/);
    const denied = await client.from("profiles").update({ role: "admin" }).eq("id", ids.omar);
    assert.match(denied.error!.message, /permission denied/);
  });

  it("a full sale through the emulator updates inventory", async () => {
    await use("omar").rpc("start_work", { p_loc: { status: "ok", lat: 33.9, lng: 35.5, city: "Beirut", neighborhood: "Hamra" } });
    const { data: inv } = await client.from("inventory").select("*, books(*)").eq("user_id", ids.omar);
    const fth = inv!.find((r) => r.books.code === "FTH");
    const tx = await client.rpc("create_transaction", { p: { items: [{ book_id: fth.book_id, quantity: 2 }], payments: [{ amount: 20, method: "cash" }] } });
    assert.equal(tx.error, null);
    assert.equal(tx.data.books, 2);
    const after = await client.from("inventory").select("remaining").eq("user_id", ids.omar).eq("book_id", fth.book_id).maybeSingle();
    assert.equal(after.data!.remaining, fth.remaining - 2);
  });

  it("admin reset in the demo empties activity but keeps people and the catalog", async () => {
    const r = await use("admin").rpc("admin_reset_data", { p_confirm: "RESET" });
    assert.equal(r.error, null);
    assert.ok(r.data.transactions > 0);
    assert.equal((await client.from("transactions").select("id")).data!.length, 0);
    assert.equal((await client.from("profiles").select("id")).data!.length, 6);
    assert.ok((await client.from("books").select("id")).data!.length >= 60);
    const stock = await client.from("books").select("warehouse_qty");
    assert.ok(stock.data!.every((b) => b.warehouse_qty === 0));
  });
});
