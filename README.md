# YES Canvassing App

**Youth Education Scholarship** — a mobile-first PWA for student canvassers, their leaders and admins:
access-code registration, work sessions, book inventory, transactions with separate donations and split
payments, daily reports, end-of-day reconciliation, follow-ups and a full audit log. Works on weak
connections: sales are saved on the phone and sync automatically, never twice.

Built with Next.js 16 · TypeScript · Tailwind CSS v4 · Supabase (Postgres, Auth, Row Level Security).

## How security works

Hiding buttons is not security, so the browser is never trusted:

- **Row Level Security** on every table. Students read only their own rows, leaders only their team's, admins everything.
- **Every write that touches money, inventory, roles or sessions is a Postgres function** (`supabase/migrations/…02_security_and_logic.sql`) that re-checks permissions and runs atomically. If any step fails, nothing is saved.
- Browser roles have **no write privilege** on sensitive tables at all, so a student can't change their role from the API.
- **Sign-up is validated inside the database.** No valid access code means no account, and the role comes from the code. Leaders and admins are created only by admins, and the first admin by a server script.
- Each transaction carries an **idempotency key** generated on the phone. Retries and double taps can't duplicate a sale.
- Inventory has a `CHECK` constraint, so it **can never go negative**, even by direct SQL.

## Setup

### 1. Supabase
1. Create a project at [supabase.com](https://supabase.com) (region: Frankfurt is closest to Beirut).
2. Copy `.env.example` to `.env.local` and fill in:
   - `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` (Project Settings → API)
   - `SUPABASE_SERVICE_ROLE_KEY` (same page, keep secret, local scripts only)
   - `SUPABASE_DB_URL` (Connect → Session pooler connection string)
3. Apply the database: `npm run db:push`
   Alternatively, paste the three files in `supabase/migrations/` in order into the SQL Editor.
4. Authentication → URL Configuration: set **Site URL** to your Vercel URL and add `https://YOUR-APP.vercel.app/**` to the redirect URLs.
5. Optional: Authentication → Sign In / Providers → Email → turn off **Confirm email** so students can work right after registering. If it stays on, they confirm by email first.

### 2. First admin
```bash
npm install
npm run create-admin -- you@yourmail.com "Your Name" "a-strong-password"
```

### 3. Run locally
```bash
npm run dev
```

### 4. Deploy (Vercel)
Import the GitHub repo in Vercel and add the two `NEXT_PUBLIC_*` variables. Never add the service-role key to Vercel. Every push to `main` deploys.

## Demo data (optional)
`npm run seed-demo` creates the following, all marked DEMO:
- 1 Admin, 1 Leader and 3 Students (`demo.*@example.com`)
- a DEMO team and territory
- a little warehouse stock

## Tests
```bash
npm run test:db      # 21 database tests: the full flow (§49) and every error case (§50)
npm run typecheck
npm run lint
npm run build
```
The database tests run the real migrations inside PGlite (Postgres in WebAssembly), so they need no
Docker and no cloud project.

## Book catalog
`supabase/migrations/…03_books_catalog.sql` loads the 60 books (codes, titles, categories, USD prices) from
the team's operating spreadsheet. Admins edit names, prices and add books under **Settings → Books**.
A book without a price cannot be sold until an admin sets one.

## Languages
English is complete. French and Arabic are wired in (`src/lib/i18n.ts`), and Arabic switches the layout
to right-to-left. Add a string by adding its key to `en` and, when ready, to `fr` and `ar`.

## Project map
```
supabase/migrations/   schema · security & business logic · book catalog
src/app/               /  sign-in  sign-up  (public)
                       /s   student: home, add, inventory, reports, more
                       /l   leader: dashboard, team, student, inventory, reports, reconcile
                       /a   admin: dashboard, users, codes, teams, books, inventory, finance, settings, audit
                       /tx  transaction detail (all roles)
src/lib/               supabase client, offline sync queue, i18n, formatting, data hooks
src/components/        UI kit (ui/), app shell & shared views (app/), admin bits (admin/)
public/sw.js           service worker (app shell offline)
tests/db/              database rule tests
scripts/               db-push, create-admin, seed-demo
```
