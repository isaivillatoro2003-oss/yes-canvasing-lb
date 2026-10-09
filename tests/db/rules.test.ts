/**
 * Database rules — the mandatory flows (§49) and error cases (§50) of the spec,
 * executed against the real migrations. Run: npm run test:db
 */
import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { as, call, createDb, expectError, signUp, type Db } from "./harness";

let db: Db;
let admin: string, leader: string, leader2: string, s1: string, s2: string, s3: string;
let team1: string, team2: string;
let nm: string, egs: string, fth: string; // book ids
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Beirut" });

type Tx = { books: number; book_value: string; donation: string; received: string; difference: string; remaining_inventory: number; duplicate: boolean };

async function newCode(opts: Record<string, unknown> = {}) {
  const c = await call<{ code: string; id: string }>(db, admin, "create_access_code", { p_role: "student", p_max_uses: 1, ...opts });
  return c;
}

before(async () => {
  db = await createDb();
  admin = await signUp(db, "test.admin@example.com", { full_name: "TEST Admin" }, { provisioned: "true", role: "admin" });
  leader = await signUp(db, "test.leader@example.com", { full_name: "TEST Leader" }, { provisioned: "true", role: "leader" });
  leader2 = await signUp(db, "test.leader2@example.com", { full_name: "TEST Leader Two" }, { provisioned: "true", role: "leader" });
  team1 = (await call<{ id: string }>(db, admin, "upsert_team", { p_id: null, p_name: "TEST Team A", p_leader: leader, p_active: true, p_notes: null })).id;
  team2 = (await call<{ id: string }>(db, admin, "upsert_team", { p_id: null, p_name: "TEST Team B", p_leader: leader2, p_active: true, p_notes: null })).id;
  const books = await db.query<{ id: string; code: string }>(`select id, code from books where code in ('NML','EGS','FTH')`);
  nm = books.rows.find((b) => b.code === "NML")!.id;
  egs = books.rows.find((b) => b.code === "EGS")!.id;
  fth = books.rows.find((b) => b.code === "FTH")!.id;
  for (const b of [nm, egs, fth]) await call(db, admin, "warehouse_adjust", { p_book: b, p_delta: 100, p_notes: "TEST stock" });
});

describe("§49 mandatory flow", () => {
  it("admin creates a student code; a student registers with it", async () => {
    const code = await newCode({ p_team: team1 });
    assert.match(code.code, /^YES-[A-Z2-9]{6}$/);
    assert.equal(await call(db, null, "check_access_code", { p_code: code.code.toLowerCase() }), "valid");
    s1 = await signUp(db, "test.s1@example.com", { full_name: "TEST Student One", phone: "000", access_code: code.code });
    const [p] = await as<{ role: string; team_id: string; leader_id: string }>(db, s1, "select role, team_id, leader_id from profiles where id = auth.uid()");
    assert.deepEqual(p, { role: "student", team_id: team1, leader_id: leader });
    const [c] = await db.query<{ current_uses: number; used_by: string }>("select current_uses, used_by from access_codes where id = $1", [code.id]).then((r) => r.rows);
    assert.equal(c.current_uses, 1);
    assert.equal(c.used_by, s1);
    // two more students on the same team, one on the other team
    s2 = await signUp(db, "test.s2@example.com", { full_name: "TEST Student Two", access_code: (await newCode({ p_team: team1 })).code });
    s3 = await signUp(db, "test.s3@example.com", { full_name: "TEST Student Three", access_code: (await newCode({ p_team: team2 })).code });
  });

  it("leader assigns inventory; warehouse goes down", async () => {
    const n = await call<number>(db, leader, "assign_inventory", { p_student: s1, p_items: [{ book_id: nm, quantity: 10 }, { book_id: egs, quantity: 5 }], p_notes: null });
    assert.equal(n, 15);
    const inv = await as<{ remaining: number }>(db, s1, "select remaining from inventory where user_id = auth.uid() and book_id = $1", [nm]);
    assert.equal(inv[0].remaining, 10);
    const [w] = (await db.query<{ warehouse_qty: number }>("select warehouse_qty from books where id = $1", [nm])).rows;
    assert.equal(w.warehouse_qty, 90);
  });

  it("start work → transaction (books + donation + cash + whish) → inventory decreases → stop → report → close → approve", async () => {
    const session = await call<{ id: string; status: string }>(db, s1, "start_work");
    assert.equal(session.status, "active");
    const tx = await call<Tx>(db, s1, "create_transaction", {
      p: {
        id: "11111111-1111-4111-8111-111111111111",
        items: [{ book_id: nm, quantity: 2 }, { book_id: egs, quantity: 1 }],
        donation: { amount: 20, donor_name: "TEST donor" },
        payments: [{ amount: 30, method: "cash" }, { amount: 20, method: "whish", reference: "W-1" }],
        customer: { name: "TEST Customer", phone: "000", consent: false },
        city: "Beirut", neighborhood: "Hamra",
      },
    });
    // NML $10 ×2 + EGS $10 ×1 = $30 books + $20 donation = $50 expected, $50 received
    assert.equal(tx.books, 3);
    assert.equal(Number(tx.book_value), 30);
    assert.equal(Number(tx.donation), 20);
    assert.equal(Number(tx.received), 50);
    assert.equal(Number(tx.difference), 0);
    assert.equal(tx.remaining_inventory, 12);
    // customer without consent: phone was dropped
    const [cust] = await as<{ phone: string | null; name: string }>(db, s1, "select phone, name from customers where created_by = auth.uid()");
    assert.equal(cust.phone, null);
    assert.equal(cust.name, "TEST Customer");
    // movement history exists
    const mv = await as<{ n: string }>(db, s1, "select count(*) n from inventory_movements where related_transaction_id = '11111111-1111-4111-8111-111111111111'");
    assert.equal(Number(mv[0].n), 2);

    await call(db, s1, "stop_work", { p_session: null });
    const rep = await call<{ books_distributed: number; received: string; by_method: Record<string, string>; transactions: number }>(
      db, s1, "report_summary", { p_from: today(), p_to: today(), p_user: s1 });
    assert.equal(rep.books_distributed, 3);
    assert.equal(Number(rep.received), 50);
    assert.equal(Number(rep.by_method.cash), 30);
    assert.equal(Number(rep.by_method.whish), 20);

    // leader receives the remaining books back and reconciles
    await call(db, leader, "return_inventory", { p_student: s1, p_items: [{ book_id: nm, quantity: 8 }, { book_id: egs, quantity: 4 }], p_notes: "TEST end of day" });
    const day = await call<{ books: { remaining: number; returned: number }; finance: { expected: string } }>(db, leader, "day_summary", { p_student: s1, p_date: today() });
    assert.equal(day.books.remaining, 0);
    assert.equal(day.books.returned, 12);
    assert.equal(Number(day.finance.expected), 50);
    const rec = await call<{ id: string; status: string; money_difference: string }>(db, leader, "close_day", {
      p_student: s1, p_date: today(), p_cash: 30, p_whish: 20, p_other: 0, p_books_counted: 0, p_notes: null, p_override: false });
    assert.equal(rec.status, "balanced");
    assert.equal(Number(rec.money_difference), 0);
    const ok = await call<{ status: string; approved_by: string }>(db, leader, "approve_day", { p_id: rec.id, p_notes: null });
    assert.equal(ok.status, "approved");
    assert.equal(ok.approved_by, leader);
    // approved day is frozen
    await expectError(call(db, leader, "cancel_transaction", { p_id: "11111111-1111-4111-8111-111111111111", p_reason: "test" }), /already approved/);
    // and audited
    const audit = await as<{ action: string }>(db, admin, "select action from audit_log");
    const actions = audit.map((a) => a.action);
    for (const a of ["Admin created access code", "Leader assigned inventory", "Student completed transaction", "Leader received returned books", "Leader approved reconciliation"]) {
      assert.ok(actions.includes(a), `audit missing: ${a}`);
    }
  });
});

describe("a brand-new person who signs up gets the simple (student) view only", () => {
  it("is a student, even when they try every way to become admin or leader", async () => {
    const c = await newCode();
    const n = await signUp(db, "test.newperson@example.com",
      { full_name: "TEST New Person", access_code: c.code, role: "admin", is_admin: true, app_metadata: { role: "admin" } });
    const [me] = await as<{ role: string }>(db, n, "select role from profiles where id = auth.uid()");
    assert.equal(me.role, "student");

    // Admin-only actions are refused by the database itself
    for (const [fn, args] of [
      ["create_access_code", {}],
      ["admin_set_role", { p_user: n, p_role: "admin" }],
      ["admin_set_role", { p_user: n, p_role: "leader" }],
      ["admin_set_active", { p_user: s1, p_active: false }],
      ["admin_assign_team", { p_user: n, p_team: team1 }],
      ["upsert_team", { p_id: null, p_name: "hack", p_leader: n }],
      ["warehouse_adjust", { p_book: nm, p_delta: 5 }],
      ["student_inventory_adjust", { p_student: n, p_book: nm, p_delta: 50, p_notes: "x" }],
      ["lock_day", { p_id: "00000000-0000-4000-8000-000000000000" }],
    ] as const) {
      await expectError(call(db, n, fn, args as Record<string, unknown>), /Only an admin|admin/);
    }
    // Leader-only actions too
    await expectError(call(db, n, "assign_inventory", { p_student: n, p_items: [{ book_id: nm, quantity: 99 }] }), /your own students/);
    await expectError(call(db, n, "close_day", { p_student: n, p_date: today(), p_cash: 0, p_whish: 0, p_other: 0 }), /leader or an admin/);

    // Direct table writes are refused
    await expectError(as(db, n, "update profiles set role = 'admin' where id = auth.uid()"), /permission denied/);
    await expectError(as(db, n, "insert into access_codes (code) values ('YES-HACK01')"), /permission denied/);
    await expectError(as(db, n, "update books set unit_value = 0"), /row-level security|permission denied|0 rows/).catch(async () => {
      // RLS may silently match zero rows instead of erroring: prove nothing changed
      const [b] = (await db.query<{ unit_value: string }>("select unit_value from books where id = $1", [nm])).rows;
      assert.equal(Number(b.unit_value), 10);
    });

    // And they see only their own data
    assert.equal((await as(db, n, "select id from profiles")).length, 1);
    assert.equal((await as(db, n, "select id from audit_log")).length, 0);
    assert.equal((await as(db, n, "select id from access_codes")).length, 0);
    assert.equal((await as(db, n, "select id from transactions")).length, 0);
    assert.equal((await as(db, n, "select * from active_sessions()")).length, 0);
    assert.equal((await as(db, n, "select * from pending_days(100)")).length, 0);
  });
});

describe("work location and pauses", () => {
  const HAMRA = { lat: 33.8966, lng: 35.4823, accuracy: 12, city: "Beirut", neighborhood: "Hamra", status: "ok" };
  let w: string;

  it("start/pause/resume/stop are stamped with time and place; paused time is not work time", async () => {
    w = await signUp(db, "test.walker@example.com", { full_name: "TEST Walker", access_code: (await newCode({ p_team: team1 })).code });
    const s = await call<{ id: string }>(db, w, "start_work", { p_loc: HAMRA });
    const [ev] = await as<{ event_type: string; city: string; latitude: string; location_status: string }>(
      db, w, "select event_type, city, latitude, location_status from work_session_events where session_id = $1", [s.id]);
    assert.deepEqual([ev.event_type, ev.city, Number(ev.latitude), ev.location_status], ["start", "Beirut", 33.8966, "ok"]);

    // pretend the session started 90 minutes ago, then pause
    await db.query("update work_sessions set started_at = now() - interval '90 minutes' where id = $1", [s.id]);
    await call(db, w, "pause_work", { p_loc: { status: "denied" } });
    await expectError(call(db, w, "start_work", { p_loc: HAMRA }), /already have an active work session/);
    await expectError(call(db, w, "create_transaction", { p: { items: [], donation: { amount: 5 }, payments: [] } }), /paused/);
    // the pause lasted 30 minutes
    await db.query("update work_sessions set paused_at = now() - interval '30 minutes' where id = $1", [s.id]);
    await call(db, w, "resume_work", { p_loc: HAMRA });
    const stopped = await call<{ duration_minutes: number; paused_minutes: number }>(db, w, "stop_work", { p_loc: HAMRA });
    assert.equal(stopped.paused_minutes, 30);
    assert.equal(stopped.duration_minutes, 60);
    const types = (await as<{ event_type: string; location_status: string }>(db, w,
      "select event_type, location_status from work_session_events where session_id = $1 order by occurred_at, created_at", [s.id]));
    assert.deepEqual(types.map((t) => t.event_type), ["start", "pause", "resume", "stop"]);
    assert.equal(types[1].location_status, "denied");
  });

  it("pings are recorded only while working, at most every 4 minutes", async () => {
    const s = await call<{ id: string }>(db, w, "start_work", { p_loc: HAMRA });
    await call(db, w, "log_location", { p_loc: HAMRA });
    await call(db, w, "log_location", { p_loc: HAMRA });
    const pings = () => as(db, w, "select 1 from work_session_events where session_id = $1 and event_type = 'ping'", [s.id]);
    assert.equal((await pings()).length, 1);
    await call(db, w, "pause_work", {});
    await db.query("update work_session_events set occurred_at = now() - interval '10 minutes' where session_id = $1", [s.id]);
    await call(db, w, "log_location", { p_loc: HAMRA });
    assert.equal((await pings()).length, 1); // paused: nothing recorded
    await call(db, w, "resume_work", {});
  });

  it("the leader sees where and when; other leaders and students don't", async () => {
    const live = await as<{ full_name: string; start_place: string; last_place: string }>(db, leader, "select * from active_sessions() where user_id = $1", [w]);
    assert.equal(live.length, 1);
    assert.equal(live[0].start_place, "Hamra, Beirut");
    assert.equal((await as(db, leader, "select 1 from work_session_events where user_id = $1", [w])).length > 0, true);
    assert.equal((await as(db, leader2, "select 1 from work_session_events where user_id = $1", [w])).length, 0);
    assert.equal((await as(db, s2, "select 1 from work_session_events where user_id = $1", [w])).length, 0);
    await expectError(as(db, w, "insert into work_session_events (session_id, user_id, event_type) select id, user_id, 'ping' from work_sessions where user_id = auth.uid() limit 1"),
      /permission denied/);
  });

  it("a transaction carries its location", async () => {
    await call(db, w, "create_transaction", { p: { items: [], donation: { amount: 5 }, payments: [{ amount: 5, method: "cash" }], location: HAMRA } });
    const t = await as(db, w, "select 1 from work_session_events where user_id = auth.uid() and event_type = 'transaction' and city = 'Beirut'");
    assert.equal(t.length, 1);
    await call(db, w, "stop_work", {});
  });

  it("admin can require location to start work", async () => {
    await db.query("update app_settings set location_required = true");
    await expectError(call(db, w, "start_work", { p_loc: { status: "denied" } }), /Turn on location/);
    const s = await call<{ id: string }>(db, w, "start_work", { p_loc: HAMRA });
    assert.ok(s.id);
    await call(db, w, "stop_work", {});
    await db.query("update app_settings set location_required = false");
  });
});

describe("Lebanon Law 81/2018 — privacy", () => {
  it("sign-up without accepting the privacy notice is refused; acceptance is recorded", async () => {
    const c = await newCode();
    await expectError(signUp(db, "test.noconsent@example.com", { access_code: c.code, privacy_accepted: "false" }), /privacy notice/);
    assert.equal(await call(db, null, "check_access_code", { p_code: c.code }), "valid"); // code not consumed
    const u = await signUp(db, "test.consent@example.com", { access_code: c.code });
    const [p] = await as<{ privacy_accepted_at: string | null }>(db, u, "select privacy_accepted_at from profiles where id = auth.uid()");
    assert.ok(p.privacy_accepted_at);
  });

  it("a person can download a copy of their own data (Art. 99)", async () => {
    const d = await call<{ profile: { id: string }; transactions: unknown[]; inventory: unknown[] }>(db, s1, "export_my_data");
    assert.equal(d.profile.id, s1);
    assert.ok(d.transactions.length >= 1);
  });

  it("admin can erase a customer's personal data; sales stay intact (Art. 101)", async () => {
    const [c] = await as<{ id: string }>(db, admin, "select id from customers limit 1");
    await expectError(call(db, s1, "admin_erase_customer", { p_id: c.id, p_reason: "x" }), /Only an admin/);
    await call(db, admin, "admin_erase_customer", { p_id: c.id, p_reason: "TEST request by phone" });
    const [after] = (await db.query<{ name: string; phone: string | null }>("select name, phone from customers where id = $1", [c.id])).rows;
    assert.equal(after.name, "[erased]");
    assert.equal(after.phone, null);
    const n = await as<{ n: string }>(db, admin, "select count(*) n from transactions where customer_id = $1", [c.id]);
    assert.equal(Number(n[0].n), 1);
  });

  it("oversized input is rejected by the database", async () => {
    await expectError(as(db, s1, "insert into customers (created_by, name) values (auth.uid(), repeat('x', 5000))"), /customers_len/);
  });
});

describe("§50 error cases", () => {
  it("wrong access code", async () => {
    assert.equal(await call(db, null, "check_access_code", { p_code: "YES-NOPE00" }), "invalid");
    await expectError(signUp(db, "test.x1@example.com", { access_code: "YES-NOPE00" }), /Invalid access code/);
  });

  it("expired access code", async () => {
    const c = await newCode({ p_expires_at: new Date(Date.now() - 86400000).toISOString() });
    assert.equal(await call(db, null, "check_access_code", { p_code: c.code }), "expired");
    await expectError(signUp(db, "test.x2@example.com", { access_code: c.code }), /expired/);
  });

  it("used access code", async () => {
    const c = await newCode();
    await signUp(db, "test.x3@example.com", { access_code: c.code });
    assert.equal(await call(db, null, "check_access_code", { p_code: c.code }), "used");
    await expectError(signUp(db, "test.x4@example.com", { access_code: c.code }), /already been used/);
  });

  it("revoked code is invalid; multi-use code works until its limit", async () => {
    const c = await newCode({ p_max_uses: 2 });
    await signUp(db, "test.m1@example.com", { access_code: c.code });
    assert.equal(await call(db, null, "check_access_code", { p_code: c.code }), "valid");
    await call(db, admin, "set_access_code_active", { p_id: c.id, p_active: false });
    assert.equal(await call(db, null, "check_access_code", { p_code: c.code }), "invalid");
  });

  it("student tries to become admin", async () => {
    // metadata from the browser can't pick a role
    const c = await newCode();
    const sneaky = await signUp(db, "test.sneaky@example.com", { access_code: c.code, role: "admin" });
    const [p] = await as<{ role: string }>(db, sneaky, "select role from profiles where id = auth.uid()");
    assert.equal(p.role, "student");
    // direct table write is refused
    await expectError(as(db, s2, "update profiles set role = 'admin' where id = auth.uid()"), /permission denied/);
    // admin RPCs are refused
    await expectError(call(db, s2, "admin_set_role", { p_user: s2, p_role: "admin" }), /Only an admin/);
    await expectError(call(db, s2, "create_access_code", {}), /Only an admin/);
    // the anon key can't call privileged functions at all
    await expectError(call(db, null, "admin_set_role", { p_user: s2, p_role: "admin" }), /permission denied/);
  });

  it("student cannot see another student", async () => {
    const others = await as(db, s2, "select id from profiles where id <> auth.uid()");
    assert.equal(others.length, 0);
    const tx = await as(db, s2, "select id from transactions");
    assert.equal(tx.length, 0);
    await expectError(call(db, s2, "day_summary", { p_student: s1, p_date: today() }), /not allowed/);
    const rep = await call<{ by_user: { id: string }[] }>(db, s2, "report_summary", { p_user: s1 });
    assert.equal(rep.by_user.length, 0);
  });

  it("student starts work twice", async () => {
    await call(db, s2, "start_work");
    await expectError(call(db, s2, "start_work"), /already have an active work session/);
  });

  it("student sells more inventory than available; zero and negative quantities", async () => {
    await call(db, leader, "assign_inventory", { p_student: s2, p_items: [{ book_id: fth, quantity: 3 }], p_notes: null });
    await expectError(call(db, s2, "create_transaction", { p: { items: [{ book_id: fth, quantity: 5 }], payments: [] } }),
      /Not enough inventory of FTH\. You currently have 3 copies available\./);
    await expectError(call(db, s2, "create_transaction", { p: { items: [{ book_id: fth, quantity: 0 }], payments: [] } }), /at least 1/);
    await expectError(call(db, s2, "create_transaction", { p: { items: [{ book_id: fth, quantity: -2 }], payments: [] } }), /at least 1/);
    await expectError(call(db, s2, "create_transaction", { p: { items: [], payments: [] } }), /at least one book or a donation/);
    // nothing was partially written
    const [inv] = await as<{ remaining: number }>(db, s2, "select remaining from inventory where user_id = auth.uid()");
    assert.equal(inv.remaining, 3);
  });

  it("student double-clicks Save (same transaction id twice)", async () => {
    const p = { id: "22222222-2222-4222-8222-222222222222", items: [{ book_id: fth, quantity: 1 }], payments: [{ amount: 10, method: "cash" }] };
    const [a, b] = [await call<Tx>(db, s2, "create_transaction", { p }), await call<Tx>(db, s2, "create_transaction", { p })];
    assert.equal(a.duplicate, false);
    assert.equal(b.duplicate, true);
    const n = await as<{ n: string }>(db, s2, "select count(*) n from transactions");
    assert.equal(Number(n[0].n), 1);
    const [inv] = await as<{ remaining: number }>(db, s2, "select remaining from inventory where user_id = auth.uid()");
    assert.equal(inv.remaining, 2);
  });

  it("partial payment, overpayment and donation-only", async () => {
    const under = await call<Tx>(db, s2, "create_transaction", { p: { items: [{ book_id: fth, quantity: 1 }], payments: [{ amount: 6, method: "cash" }] } });
    assert.equal(Number(under.difference), -4);
    const over = await call<Tx>(db, s2, "create_transaction", { p: { items: [{ book_id: fth, quantity: 1 }], payments: [{ amount: 15, method: "other" }] } });
    assert.equal(Number(over.difference), 5);
    const don = await call<Tx>(db, s2, "create_transaction", { p: { items: [], donation: { amount: 25 }, payments: [{ amount: 25, method: "whish" }] } });
    assert.equal(don.books, 0);
    assert.equal(Number(don.donation), 25);
    assert.equal(Number(don.difference), 0);
    await expectError(call(db, s2, "create_transaction", { p: { items: [], donation: { amount: 5 }, payments: [{ amount: 5, method: "bitcoin" }] } }), /Invalid payment method/);
  });

  it("returned inventory can't exceed what the student holds", async () => {
    await expectError(call(db, leader, "return_inventory", { p_student: s2, p_items: [{ book_id: fth, quantity: 1 }], p_notes: null }), /only holds 0/);
  });

  it("leader attempts an unauthorized team", async () => {
    await expectError(call(db, leader2, "assign_inventory", { p_student: s1, p_items: [{ book_id: nm, quantity: 1 }], p_notes: null }), /your own students/);
    const seen = await as(db, leader2, "select id from profiles where id = $1", [s1]);
    assert.equal(seen.length, 0);
    await expectError(call(db, leader2, "close_day", { p_student: s1, p_date: today(), p_cash: 0, p_whish: 0, p_other: 0 }), /leader or an admin/);
    // but leader 2 does see their own student
    const own = await as(db, leader2, "select id from profiles where id = $1", [s3]);
    assert.equal(own.length, 1);
  });

  it("close day while working is blocked; admin override is audited", async () => {
    await expectError(call(db, leader, "close_day", { p_student: s2, p_date: today(), p_cash: 0, p_whish: 0, p_other: 0 }),
      /still has an active work session/);
    const rec = await call<{ status: string; override_used: boolean; money_difference: string }>(db, admin, "close_day", {
      p_student: s2, p_date: today(), p_cash: 40, p_whish: 25, p_other: 15, p_override: true });
    assert.equal(rec.override_used, true);
    // expected: 10 + 10 + 10 + 25 = 55; submitted 80 → +25
    assert.equal(Number(rec.money_difference), 25);
    assert.equal(rec.status, "difference");
    const a = await as(db, admin, "select 1 from audit_log where action like 'Admin override%'");
    assert.equal(a.length, 1);
    await expectError(call(db, leader, "approve_day", { p_id: (await as<{ id: string }>(db, admin, "select id from daily_reconciliations where student_id = $1", [s2]))[0].id, p_notes: null }),
      /discrepancy notes/);
  });

  it("inactive user is refused", async () => {
    await call(db, admin, "admin_set_active", { p_user: s3, p_active: false });
    const r = await call<{ active: boolean; reason: string }>(db, s3, "touch_login");
    assert.deepEqual(r, { active: false, reason: "inactive" });
    await expectError(call(db, s3, "start_work"), /inactive/);
    const rows = await as(db, s3, "select id from profiles");
    assert.equal(rows.length, 0);
  });

  it("no inventory can go negative, even by direct SQL as a superuser", async () => {
    await expectError(db.query("update inventory set distributed = distributed + 999 where user_id = $1", [s2]), /inventory_never_negative/);
  });

  it("cancelling a transaction restores inventory", async () => {
    const before = (await as<{ remaining: number }>(db, s2, "select remaining from inventory where user_id = auth.uid()"))[0].remaining;
    await call(db, leader, "cancel_transaction", { p_id: "22222222-2222-4222-8222-222222222222", p_reason: "TEST mistake" });
    const after = (await as<{ remaining: number }>(db, s2, "select remaining from inventory where user_id = auth.uid()"))[0].remaining;
    assert.equal(after, before + 1);
  });

  it("the last admin cannot be demoted; a student can be promoted to leader", async () => {
    await expectError(call(db, admin, "admin_set_role", { p_user: admin, p_role: "student" }), /last admin/);
    const p = await call<{ role: string }>(db, admin, "admin_set_role", { p_user: s2, p_role: "leader" });
    assert.equal(p.role, "leader");
  });

  it("books without a price can't be sold", async () => {
    const [b] = (await db.query<{ id: string }>("insert into books (code, name) values ('TSTX', 'TEST unpriced') returning id")).rows;
    await call(db, admin, "warehouse_adjust", { p_book: b.id, p_delta: 5, p_notes: null });
    await call(db, leader, "assign_inventory", { p_student: s1, p_items: [{ book_id: b.id, quantity: 2 }], p_notes: null });
    await call(db, s1, "start_work");
    await expectError(call(db, s1, "create_transaction", { p: { items: [{ book_id: b.id, quantity: 1 }], payments: [] } }), /no price yet/);
  });
});
