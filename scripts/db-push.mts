/**
 * Applies supabase/migrations to your Supabase project.
 *   npm run db:push
 * Needs SUPABASE_DB_URL in .env.local (Supabase → Connect → Session pooler).
 */
import { config } from "dotenv";
import { spawnSync } from "node:child_process";

config({ path: ".env.local" });
const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) {
  console.error("Missing SUPABASE_DB_URL in .env.local — see .env.example");
  process.exit(1);
}
const r = spawnSync("npx", ["--yes", "supabase@2", "db", "push", "--db-url", dbUrl, "--include-all"], {
  stdio: "inherit",
  shell: process.platform === "win32",
});
process.exit(r.status ?? 1);
