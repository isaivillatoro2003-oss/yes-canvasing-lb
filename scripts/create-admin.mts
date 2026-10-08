/**
 * Creates (or promotes) the first Admin. Runs on your computer with the
 * service-role key — never in the browser.
 *
 *   npm run create-admin -- you@example.com "Your Name" "a-strong-password"
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const [email, fullName, password] = process.argv.slice(2);
if (!email || !fullName || !password) {
  console.error('Usage: npm run create-admin -- email "Full Name" password');
  process.exit(1);
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const { data, error } = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  user_metadata: { full_name: fullName },
  app_metadata: { provisioned: "true", role: "admin" }, // only the service role can set this
});

if (error) {
  console.error("Could not create the admin:", error.message);
  process.exit(1);
}
console.log(`Admin created: ${data.user.email} (${data.user.id}). Sign in at /sign-in.`);
