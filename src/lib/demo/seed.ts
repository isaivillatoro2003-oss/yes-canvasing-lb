/**
 * Demo data — every person and number here is fictional (DEMO).
 * The seed runs the app's REAL database functions as each demo user, so the
 * demo shows exactly the behaviour of production (inventory, reports,
 * reconciliation…), then shifts some timestamps into the past.
 */
import type { DemoDb } from "./postgrest";

export const DEMO_USERS = {
  admin: { email: "demo.admin@example.com", name: "Demo Admin", role: "admin" },
  leader: { email: "demo.leader@example.com", name: "Rami Haddad", role: "leader" },
  maya: { email: "demo.maya@example.com", name: "Maya Khoury", role: "student" },
  karim: { email: "demo.karim@example.com", name: "Karim Nassar", role: "student" },
  lea: { email: "demo.lea@example.com", name: "Lea Saade", role: "student" },
  omar: { email: "demo.omar@example.com", name: "Omar Fares", role: "student" },
} as const;

export type DemoKey = keyof typeof DEMO_USERS;

const PLACES = {
  hamra: { lat: 33.8966, lng: 35.4823, accuracy: 14, city: "Beirut", neighborhood: "Hamra", status: "ok" },
  achrafieh: { lat: 33.8886, lng: 35.5195, accuracy: 18, city: "Beirut", neighborhood: "Achrafieh", status: "ok" },
  gemmayze: { lat: 33.8957, lng: 35.5147, accuracy: 11, city: "Beirut", neighborhood: "Gemmayze", status: "ok" },
  jounieh: { lat: 33.9808, lng: 35.6178, accuracy: 25, city: "Jounieh", neighborhood: "Kaslik", status: "ok" },
};

export async function seedDemo(db: DemoDb): Promise<Record<DemoKey, string>> {
  const ids = {} as Record<DemoKey, string>;
  for (const [key, u] of Object.entries(DEMO_USERS) as [DemoKey, (typeof DEMO_USERS)[DemoKey]][]) {
    const r = await db.query<{ id: string }>(
      `insert into auth.users (email, raw_user_meta_data, raw_app_meta_data) values ($1, $2, $3) returning id`,
      [u.email, JSON.stringify({ full_name: u.name }), JSON.stringify({ provisioned: "true", role: u.role })],
    );
    ids[key] = r.rows[0].id;
  }
  await db.query(`update profiles set privacy_accepted_at = now(), phone = '+961 70 000 000'`);

  async function as<T = unknown>(key: DemoKey, fn: string, args: Record<string, unknown> = {}): Promise<T> {
    const names = Object.keys(args);
    return db.transaction(async (tx) => {
      await tx.exec("set local role authenticated");
      await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [ids[key]]);
      const r = await tx.query<{ v: T }>(
        `select to_jsonb(public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(", ")})) as v`,
        names.map((n) => (args[n] !== null && typeof args[n] === "object" ? JSON.stringify(args[n]) : args[n])),
      );
      return r.rows[0].v;
    });
  }

  // Organisation, team, territories
  await db.query(`update app_settings set privacy_contact = 'privacy@yes-demo.example', campaign_start_date = app_today() - 21`);
  const team = await as<{ id: string }>("admin", "upsert_team", { p_id: null, p_name: "Beirut Team", p_leader: ids.leader, p_active: true, p_notes: "DEMO" });
  for (const k of ["maya", "karim", "lea", "omar"] as DemoKey[]) await as("admin", "admin_assign_team", { p_user: ids[k], p_team: team.id });
  await db.query(`insert into territories (territory_name, city, area, territory_type, latitude, longitude, notes) values
    ('Hamra', 'Beirut', 'Ras Beirut', 'Residential', 33.8966, 35.4823, 'DEMO'),
    ('Achrafieh', 'Beirut', 'Achrafieh', 'Residential', 33.8886, 35.5195, 'DEMO'),
    ('AUB & LAU campuses', 'Beirut', 'Ras Beirut', 'Institution', 33.9006, 35.4800, 'DEMO'),
    ('Jounieh souks', 'Jounieh', 'Kaslik', 'Business', 33.9808, 35.6178, 'DEMO')`);

  // Warehouse stock and assignments
  const books = (await db.query<{ id: string; code: string }>(`select id, code from books where code in ('FTH','HYP','NML','EGS','HVS','SWH','PATS','GDA')`)).rows;
  const B = Object.fromEntries(books.map((b) => [b.code, b.id])) as Record<string, string>;
  for (const id of Object.values(B)) await as("admin", "warehouse_adjust", { p_book: id, p_delta: 60, p_notes: "DEMO stock received" });
  const kit = [{ book_id: B.FTH, quantity: 8 }, { book_id: B.HYP, quantity: 8 }, { book_id: B.NML, quantity: 5 }, { book_id: B.HVS, quantity: 5 }, { book_id: B.SWH, quantity: 4 }];
  for (const k of ["maya", "karim", "lea", "omar"] as DemoKey[]) await as("leader", "assign_inventory", { p_student: ids[k], p_items: kit, p_notes: "DEMO weekly kit" });

  // ── Yesterday: Maya and Karim worked, sold, and the leader closed and approved the day
  for (const [k, place, sales] of [
    ["maya", PLACES.achrafieh, [[B.FTH, 2, 20, 20, "cash"], [B.HYP, 1, 0, 10, "whish"], [B.NML, 1, 5, 10, "cash"]]],
    ["karim", PLACES.gemmayze, [[B.HYP, 2, 0, 20, "cash"], [B.SWH, 1, 10, 10, "whish"]]],
  ] as [DemoKey, typeof PLACES.hamra, [string, number, number, number, string][]][]) {
    const s = await as<{ id: string }>(k, "start_work", { p_loc: place });
    for (const [book, qty, donation, paid, method] of sales) {
      await as(k, "create_transaction", { p: {
        items: [{ book_id: book, quantity: qty }], donation: donation ? { amount: donation } : undefined,
        payments: [{ amount: paid + donation, method }], city: place.city, neighborhood: place.neighborhood, location: place,
      } });
    }
    await as(k, "add_presentations", { p_delta: 14 });
    await as(k, "stop_work", { p_loc: place });
    await db.query(`
      update work_sessions set work_date = app_today() - 1, started_at = now() - interval '1 day 5 hours',
             ended_at = now() - interval '1 day 1 hour', duration_minutes = 240 where id = $1;
      `, [s.id]);
    await db.query(`update work_session_events set occurred_at = occurred_at - interval '1 day 3 hours' where session_id = $1`, [s.id]);
    await db.query(`update transactions set work_date = app_today() - 1, transaction_datetime = transaction_datetime - interval '1 day 3 hours' where session_id = $1`, [s.id]);
    await db.query(`update inventory_movements set created_at = created_at - interval '1 day 3 hours'
                     where movement_type = 'SALE' and related_transaction_id in (select id from transactions where session_id = $1)`, [s.id]);
  }
  for (const k of ["maya", "karim"] as DemoKey[]) {
    const d = await as<{ finance: { expected: number }; payments: { cash: number; whish: number } }>("leader", "day_summary", { p_student: ids[k], p_date: yesterday() });
    const r = await as<{ id: string }>("leader", "close_day", {
      p_student: ids[k], p_date: yesterday(), p_cash: d.payments.cash, p_whish: d.payments.whish, p_other: 0, p_books_counted: null, p_notes: null, p_override: false,
    });
    await as("leader", "approve_day", { p_id: r.id, p_notes: null });
  }

  // ── Today: Maya is working in Hamra, Karim is on a break, Lea already finished, Omar hasn't started
  const maya = await as<{ id: string }>("maya", "start_work", { p_loc: PLACES.hamra });
  await as("maya", "create_transaction", { p: {
    items: [{ book_id: B.FTH, quantity: 1 }, { book_id: B.NML, quantity: 1 }], donation: { amount: 10 },
    payments: [{ amount: 30, method: "cash" }], city: "Beirut", neighborhood: "Hamra", location: PLACES.hamra,
    customer: { name: "Nadine (DEMO)", phone: "+961 3 000 000", consent: true, notes: "Wants the Arabic edition" },
  } });
  await as("maya", "create_transaction", { p: {
    items: [{ book_id: B.HVS, quantity: 1 }], payments: [{ amount: 5, method: "whish", reference: "W-2231" }],
    city: "Beirut", neighborhood: "Hamra", location: PLACES.hamra,
  } });
  await as("maya", "add_presentations", { p_delta: 9 });
  await db.query(`update work_sessions set started_at = now() - interval '2 hours 10 minutes' where id = $1`, [maya.id]);
  await db.query(`update work_session_events set occurred_at = now() - interval '2 hours 10 minutes' where session_id = $1 and event_type = 'start'`, [maya.id]);
  await db.query(`insert into work_session_events (session_id, user_id, event_type, occurred_at, latitude, longitude, accuracy_m, city, neighborhood, location_status)
                  select $1, $2, 'ping', now() - (g * interval '10 minutes'), 33.8966 + g * 0.0004, 35.4823 + g * 0.0003, 15, 'Beirut', 'Hamra', 'ok'
                  from generate_series(1, 6) g`, [maya.id, ids.maya]);

  const karim = await as<{ id: string }>("karim", "start_work", { p_loc: PLACES.gemmayze });
  await as("karim", "create_transaction", { p: {
    items: [{ book_id: B.HYP, quantity: 2 }], payments: [{ amount: 15, method: "cash" }],
    city: "Beirut", neighborhood: "Gemmayze", location: PLACES.gemmayze,
  } });
  await as("karim", "pause_work", { p_loc: PLACES.gemmayze });
  await db.query(`update work_sessions set started_at = now() - interval '1 hour 35 minutes', paused_at = now() - interval '12 minutes' where id = $1`, [karim.id]);

  await as("lea", "start_work", { p_loc: PLACES.jounieh });
  await as("lea", "create_transaction", { p: {
    items: [{ book_id: B.SWH, quantity: 1 }], donation: { amount: 5 }, payments: [{ amount: 15, method: "cash" }],
    city: "Jounieh", neighborhood: "Kaslik", location: PLACES.jounieh,
  } });
  await as("lea", "stop_work", { p_loc: PLACES.jounieh });

  return ids;
}

function yesterday(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Beirut", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
