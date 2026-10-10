import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
// The Vercel ↔ Supabase integration may provide either the legacy anon key or the newer publishable key.
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export const isConfigured = Boolean(url && key);

let client: SupabaseClient | null = null;
let demoClient: SupabaseClient | null = null;

/** In demo mode every query goes to the in-browser demo database instead of Supabase. */
export function installDemoClient(c: SupabaseClient) { demoClient = c; }

/** Browser client. Security is enforced in Postgres (RLS + RPCs), never here. */
export function sb(): SupabaseClient {
  if (demoClient) return demoClient;
  if (!client) {
    if (!url || !key) throw new Error("Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.");
    client = createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: "yes-auth" },
    });
  }
  return client;
}

type RpcError = { message: string; code?: string };

/** Calls a Postgres function and throws a readable Error on failure. */
export async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await sb().rpc(fn, args);
  if (error) throw toAppError(error);
  return data as T;
}

export class AppError extends Error {
  /** true when the request never reached the server (offline, timeout, DNS…) */
  network: boolean;
  code?: string;
  constructor(message: string, network: boolean, code?: string) {
    super(message);
    this.network = network;
    this.code = code;
  }
}

export function toAppError(e: RpcError | Error | unknown): AppError {
  if (e instanceof AppError) return e;
  const err = e as RpcError;
  const message = err?.message ?? String(e);
  const network =
    !err?.code &&
    /fetch|network|load failed|timeout|offline|ECONN|Failed to/i.test(message);
  return new AppError(network ? "No connection. Please try again." : message, network, err?.code);
}
