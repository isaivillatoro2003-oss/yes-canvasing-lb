export function SetupNotice() {
  return (
    <main className="app-height grid place-items-center p-6">
      <div className="max-w-md rounded-3xl bg-elevated p-6 shadow-card">
        <h1 className="text-headline">Almost ready</h1>
        <p className="mt-2 text-muted">
          Connect the database: add <code>NEXT_PUBLIC_SUPABASE_URL</code> and <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> to
          <code> .env.local</code> (or the Vercel project settings) and restart.
        </p>
      </div>
    </main>
  );
}
