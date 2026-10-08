/**
 * DEMO / TEST DATA ONLY. Creates 1 Admin, 1 Leader and 3 Students with
 * @example.com emails (a reserved domain — nobody real), a DEMO team and
 * territory, and puts a little stock in the warehouse so the full flow can be
 * tried. Safe to re-run: existing demo users are left as they are.
 *
 *   npm run seed-demo
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!url || !key) { console.error("Missing env. See .env.example"); process.exit(1); }
const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const PASSWORD = process.env.DEMO_PASSWORD || "YesDemo-2026!";
const USERS = [
  { email: "demo.admin@example.com", name: "DEMO Admin", role: "admin" },
  { email: "demo.leader@example.com", name: "DEMO Leader", role: "leader" },
  { email: "demo.student1@example.com", name: "DEMO Student One", role: "student" },
  { email: "demo.student2@example.com", name: "DEMO Student Two", role: "student" },
  { email: "demo.student3@example.com", name: "DEMO Student Three", role: "student" },
] as const;

async function ensureUser(u: (typeof USERS)[number]): Promise<string> {
  const { data: existing } = await sb.from("profiles").select("id").eq("email", u.email).maybeSingle();
  if (existing) return existing.id as string;
  const { data, error } = await sb.auth.admin.createUser({
    email: u.email, password: PASSWORD, email_confirm: true,
    user_metadata: { full_name: u.name }, app_metadata: { provisioned: "true", role: u.role },
  });
  if (error) throw new Error(`${u.email}: ${error.message}`);
  return data.user.id;
}

const ids: Record<string, string> = {};
for (const u of USERS) ids[u.email] = await ensureUser(u);
const leaderId = ids["demo.leader@example.com"];

let { data: team } = await sb.from("teams").select("id").eq("team_name", "DEMO Team").maybeSingle();
if (!team) {
  const r = await sb.from("teams").insert({ team_name: "DEMO Team", leader_id: leaderId, notes: "DEMO / TEST DATA" }).select("id").single();
  if (r.error) throw r.error;
  team = r.data;
}
await sb.from("profiles").update({ team_id: team!.id, leader_id: leaderId })
  .in("id", [ids["demo.student1@example.com"], ids["demo.student2@example.com"], ids["demo.student3@example.com"]]);

const { data: terr } = await sb.from("territories").select("id").eq("territory_name", "DEMO Hamra").maybeSingle();
if (!terr) await sb.from("territories").insert({ territory_name: "DEMO Hamra", city: "Beirut", area: "Hamra", territory_type: "Residential", notes: "DEMO / TEST DATA" });

// A little warehouse stock on a few books, only if empty.
const { data: books } = await sb.from("books").select("id, code, warehouse_qty").in("code", ["FTH", "HYP", "NML", "EGS", "HVS", "SWH"]);
for (const b of books ?? []) {
  if (b.warehouse_qty === 0) {
    await sb.from("books").update({ warehouse_qty: 50 }).eq("id", b.id);
    await sb.from("inventory_movements").insert({ book_id: b.id, movement_type: "WAREHOUSE_IN", quantity: 50, notes: "DEMO / TEST DATA stock" });
  }
}

console.log("DEMO data ready. Accounts (password:", PASSWORD + "):");
for (const u of USERS) console.log(`  ${u.role.padEnd(8)} ${u.email}`);
