"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, CloudUpload, RefreshCw } from "lucide-react";
import { useApp } from "@/lib/app-context";
import { discardQueued, flushQueue, subscribeQueue, type QueuedTx } from "@/lib/sync";
import { dateTimeLabel } from "@/lib/format";
import { Badge, Button, Card, EmptyState, Notice, useConfirm } from "@/components/ui";
import { PageHeader } from "@/components/app/shell";

export default function Pending() {
  const { online, toast, settings } = useApp();
  const [queue, setQueue] = useState<QueuedTx[]>([]);
  const [busy, setBusy] = useState(false);
  const confirm = useConfirm();
  useEffect(() => subscribeQueue(setQueue), []);

  async function retry() {
    setBusy(true);
    const r = await flushQueue();
    setBusy(false);
    if (r.synced) toast(`${r.synced} synced`, "success");
    else if (!online) toast("Still offline. We'll keep trying.", "default");
  }

  return (
    <>
      <PageHeader back title="Sync status" subtitle="Sales saved on this phone upload automatically." />
      <div className="space-y-4 px-5">
        {!online && <Notice tone="warning">You&apos;re offline. Everything below is safe on this phone.</Notice>}
        {queue.length === 0 ? (
          <Card><EmptyState icon={<CheckCircle2 className="size-6" />} title="Everything is synced" body="No transactions waiting on this phone." /></Card>
        ) : (
          <>
            <Card className="divide-y divide-line">
              {queue.map((q) => (
                <div key={q.id} className="space-y-2 px-4 py-3">
                  <div className="flex items-center gap-3">
                    {q.failed ? <AlertTriangle className="size-5 text-danger" /> : <CloudUpload className="size-5 text-warning" />}
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{q.label}</div>
                      <div className="text-xs text-subtle">Saved {dateTimeLabel(q.queuedAt, settings.timezone)} · {q.attempts} attempts</div>
                    </div>
                    <Badge tone={q.failed ? "danger" : "warning"}>{q.failed ? "Needs attention" : "Waiting to sync"}</Badge>
                  </div>
                  {q.failed && (
                    <>
                      <Notice tone="danger">{q.lastError}</Notice>
                      <Button variant="secondary" size="sm" className="text-danger" onClick={async () => {
                        const ok = await confirm.ask("Discard this transaction?", {
                          body: "The server rejected it, so it was never recorded. Discard only after you have recorded it again correctly.",
                          confirm: "Discard", tone: "danger",
                        });
                        if (ok) discardQueued(q.id);
                      }}>Discard</Button>
                    </>
                  )}
                </div>
              ))}
            </Card>
            <Button block size="lg" onClick={retry} loading={busy}><RefreshCw className="size-5" /> Sync now</Button>
          </>
        )}
      </div>
      {confirm.node}
    </>
  );
}
