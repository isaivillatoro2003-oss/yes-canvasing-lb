"use client";

import { get, set } from "idb-keyval";
import { rpc, toAppError } from "./supabase";
import type { TxSummary } from "./types";

/**
 * Offline-safe transaction pipeline.
 *
 * Every transaction gets a UUID on the phone before anything is sent. That id
 * is the idempotency key: the server creates at most one transaction per id,
 * so retries, double taps and flaky networks can never duplicate a sale.
 *
 * If the network fails, the payload is written to IndexedDB first and retried
 * on reconnect / every 20s. Business errors (e.g. not enough inventory) are
 * NOT retried — they stay in the queue as "needs attention" until the student
 * resolves them, so nothing is ever dropped silently.
 */

export type TxPayload = {
  id: string;
  session_id?: string | null;
  client_created_at: string;
  items: { book_id: string; quantity: number }[];
  donation?: { amount: number; donor_name?: string; donor_email?: string; method?: string };
  payments: { amount: number; method: string; reference?: string }[];
  customer?: Record<string, unknown> | null;
  territory_id?: string | null;
  city?: string | null;
  neighborhood?: string | null;
  notes?: string | null;
  location?: { status: string; lat?: number; lng?: number; accuracy?: number; city?: string; neighborhood?: string };
};

export type QueuedTx = {
  id: string;
  payload: TxPayload;
  queuedAt: string;
  attempts: number;
  lastError?: string;
  failed?: boolean; // business error: needs the student's attention
  label: string; // human summary for the list
};

const KEY = "yes:pending-transactions";
type Listener = (q: QueuedTx[]) => void;
const listeners = new Set<Listener>();
let cache: QueuedTx[] | null = null;
let syncing = false;

async function load(): Promise<QueuedTx[]> {
  if (cache) return cache;
  try {
    cache = ((await get(KEY)) as QueuedTx[] | undefined) ?? [];
  } catch {
    cache = [];
  }
  return cache;
}

async function save(q: QueuedTx[]) {
  cache = q;
  try {
    await set(KEY, q);
  } finally {
    listeners.forEach((l) => l(q));
  }
}

export function subscribeQueue(l: Listener): () => void {
  listeners.add(l);
  load().then((q) => l(q));
  return () => listeners.delete(l);
}

export async function pendingCount(): Promise<number> {
  return (await load()).length;
}

const TIMEOUT_MS = 12000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

export type SubmitResult =
  | { state: "saved"; summary: TxSummary }
  | { state: "queued" }
  | { state: "error"; message: string };

/** Save now if possible; otherwise queue. Business errors are returned, not queued. */
export async function submitTransaction(payload: TxPayload, label: string): Promise<SubmitResult> {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    await enqueue(payload, label);
    return { state: "queued" };
  }
  try {
    const summary = await withTimeout(rpc<TxSummary>("create_transaction", { p: payload }), TIMEOUT_MS);
    return { state: "saved", summary };
  } catch (e) {
    const err = toAppError(e);
    const isNetwork = err.network || (e as Error)?.message === "timeout";
    if (isNetwork) {
      // The request may or may not have reached the server. Queueing is safe:
      // the server answers a retry of the same id with the original result.
      await enqueue(payload, label);
      return { state: "queued" };
    }
    return { state: "error", message: err.message };
  }
}

async function enqueue(payload: TxPayload, label: string) {
  const q = await load();
  if (q.some((x) => x.id === payload.id)) return;
  await save([...q, { id: payload.id, payload, queuedAt: new Date().toISOString(), attempts: 0, label }]);
}

export async function discardQueued(id: string) {
  const q = await load();
  await save(q.filter((x) => x.id !== id));
}

/** Push every queued transaction. Safe to call often; runs one at a time. */
export async function flushQueue(): Promise<{ synced: number; failed: number }> {
  if (syncing) return { synced: 0, failed: 0 };
  if (typeof navigator !== "undefined" && !navigator.onLine) return { synced: 0, failed: 0 };
  syncing = true;
  let synced = 0;
  let failed = 0;
  try {
    const q = [...(await load())];
    for (const item of q) {
      if (item.failed) continue;
      try {
        await withTimeout(rpc<TxSummary>("create_transaction", { p: item.payload }), TIMEOUT_MS);
        const current = await load();
        await save(current.filter((x) => x.id !== item.id));
        synced++;
      } catch (e) {
        const err = toAppError(e);
        const isNetwork = err.network || (e as Error)?.message === "timeout";
        const current = await load();
        await save(
          current.map((x) =>
            x.id === item.id
              ? { ...x, attempts: x.attempts + 1, lastError: err.message, failed: !isNetwork }
              : x,
          ),
        );
        if (isNetwork) break; // still offline; try again later
        failed++;
      }
    }
  } finally {
    syncing = false;
  }
  return { synced, failed };
}

let started = false;
/** Starts background retry: on reconnect, on focus, and every 20 seconds. */
export function startSyncLoop(onSynced?: (n: number) => void) {
  if (started || typeof window === "undefined") return;
  started = true;
  const run = async () => {
    const r = await flushQueue();
    if (r.synced && onSynced) onSynced(r.synced);
  };
  window.addEventListener("online", run);
  window.addEventListener("focus", run);
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && run());
  setInterval(run, 20000);
  run();
}

/** Small key/value cache so screens can render last-known data offline. */
export async function cacheSet(key: string, value: unknown) {
  try { await set(`yes:cache:${key}`, value); } catch { /* storage unavailable */ }
}
export async function cacheGet<T>(key: string): Promise<T | undefined> {
  try { return (await get(`yes:cache:${key}`)) as T | undefined; } catch { return undefined; }
}
