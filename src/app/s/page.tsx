"use client";

import { useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { BookOpen, FileText, Minus, Play, Plus, Square } from "lucide-react";
import { useApp } from "@/lib/app-context";
import { useData, useNow } from "@/lib/hooks";
import { getActiveSession, getInventory, getReport } from "@/lib/queries";
import { rpc, toAppError } from "@/lib/supabase";
import { cn, elapsedLabel, minutesToLabel, money, todayIn } from "@/lib/format";
import type { WorkSession } from "@/lib/types";
import { Button, Card, ListGroup, ListRow, Notice, Section, Stat, useConfirm } from "@/components/ui";
import { PageHeader } from "@/components/app/shell";

export default function StudentHome() {
  const { profile, settings, t, toast } = useApp();
  const uid = profile!.id;
  const today = todayIn(settings.timezone);
  const reduce = useReducedMotion();
  const confirm = useConfirm();

  const session = useData(`session:${uid}`, () => getActiveSession(uid), [uid]);
  const report = useData(`today:${uid}:${today}`, () => getReport({ from: today, to: today, user: uid }), [uid, today]);
  const inventory = useData(`inventory:${uid}`, () => getInventory(uid), [uid]);
  const [busy, setBusy] = useState(false);
  const now = useNow(1000);

  const active = session.data ?? null;
  const r = report.data;
  const booksLeft = (inventory.data ?? []).reduce((s, row) => s + row.remaining, 0);
  const firstName = profile!.full_name.split(" ")[0];

  // Minutes from completed sessions today + the live one
  const liveMinutes = active ? Math.floor((now - new Date(active.started_at).getTime()) / 60000) : 0;
  const completedMinutes = (r?.work_minutes ?? 0) - (r?.active_minutes ?? 0);
  const workMinutes = Math.max(0, completedMinutes) + liveMinutes;

  async function start() {
    setBusy(true);
    try {
      const s = await rpc<WorkSession>("start_work");
      session.setData(s);
      toast("Work started. Have a great day!", "success");
      report.refresh();
    } catch (e) {
      toast(toAppError(e).message, "error");
      session.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    const ok = await confirm.ask("Stop work?", { body: "Your work time will be saved for today's report.", confirm: "Stop work", tone: "danger" });
    if (!ok) return;
    setBusy(true);
    try {
      await rpc<WorkSession>("stop_work", { p_session: active?.id ?? null });
      session.setData(null);
      toast("Work stopped. Time saved.", "success");
      report.refresh();
    } catch (e) {
      toast(toAppError(e).message, "error");
      session.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function presentation(delta: number) {
    if (!active) return;
    const prev = active.presentations;
    session.setData({ ...active, presentations: Math.max(0, prev + delta) });
    try {
      const v = await rpc<number>("add_presentations", { p_delta: delta });
      session.setData({ ...active, presentations: v });
    } catch (e) {
      session.setData({ ...active, presentations: prev });
      toast(toAppError(e).message, "error");
    }
  }

  return (
    <>
      <PageHeader title={`${t("home.hello")}, ${firstName}`} subtitle={new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: settings.timezone })} />

      <div className="space-y-6 px-5">
        {session.stale && <Notice tone="warning">Showing saved data — you seem to be offline.</Notice>}

        {/* Work status: the one decision on this screen */}
        <AnimatePresence mode="wait" initial={false}>
          {active ? (
            <motion.div key="working"
              initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
              transition={{ type: "spring", bounce: 0, duration: 0.35 }}>
              <Card className="overflow-hidden bg-[var(--navy-900)] p-0 text-[var(--cream-100)]">
                <div className="p-6">
                  <div className="flex items-center gap-2 text-overline text-[var(--cream-200)]/80">
                    <span className="live-dot size-2 rounded-full bg-[#4cc38a]" /> {t("home.workingNow")}
                  </div>
                  <div className="mt-2 text-[3.25rem] font-bold leading-none text-numeric" aria-live="off">
                    {elapsedLabel(active.started_at, now)}
                  </div>
                  <p className="mt-2 text-sm text-[var(--cream-200)]/70">
                    Started {new Date(active.started_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: settings.timezone })}
                  </p>
                </div>
                <div className="flex items-center justify-between gap-3 border-t border-white/10 px-6 py-4">
                  <div>
                    <div className="text-xs text-[var(--cream-200)]/70">{t("home.presentations")}</div>
                    <div className="text-2xl font-bold text-numeric">{active.presentations}</div>
                  </div>
                  <div className="flex gap-2">
                    <button type="button" aria-label="Remove a presentation" onClick={() => presentation(-1)} disabled={active.presentations === 0}
                      className="pressable grid size-12 place-items-center rounded-2xl bg-white/10 disabled:opacity-40"><Minus className="size-5" /></button>
                    <button type="button" aria-label="Add a presentation" onClick={() => presentation(1)}
                      className="pressable grid h-12 place-items-center rounded-2xl bg-[var(--cream-100)] px-5 font-semibold text-[var(--navy-900)]">
                      <span className="inline-flex items-center gap-1.5"><Plus className="size-5" /> Presentation</span>
                    </button>
                  </div>
                </div>
              </Card>
            </motion.div>
          ) : (
            <motion.div key="idle"
              initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
              transition={{ type: "spring", bounce: 0, duration: 0.35 }}>
              <Button size="xl" block onClick={start} loading={busy} className="h-24 text-xl">
                <Play className="size-6 fill-current" /> {t("home.startWork")}
              </Button>
              <p className="mt-2 text-center text-sm text-muted">{t("home.notWorking")} · {booksLeft} books in your bag</p>
            </motion.div>
          )}
        </AnimatePresence>

        {active && (
          <Button variant="secondary" size="lg" block onClick={stop} loading={busy} className="text-danger">
            <Square className="size-4 fill-current" /> {t("home.stopWork")}
          </Button>
        )}

        <Section title="Today">
          <div className="grid grid-cols-2 gap-3">
            <Stat label={t("home.books")} value={r?.books_distributed ?? 0} sub={`${booksLeft} left`} />
            <Stat label={t("home.bookValue")} value={money(r?.book_value, settings.currency)} />
            <Stat label={t("home.donations")} value={money(r?.donations, settings.currency)} />
            <Stat label={t("home.received")} value={money(r?.received, settings.currency)}
              tone={r && r.received < r.expected ? "warning" : undefined}
              sub={r && r.received !== r.expected ? `Expected ${money(r.expected, settings.currency)}` : undefined} />
            <Stat label={t("home.workTime")} value={minutesToLabel(workMinutes)} className="col-span-2"
              sub={`${r?.transactions ?? 0} transactions · ${(r?.presentations ?? 0)} presentations`} />
          </div>
        </Section>

        <Section>
          <Link href="/s/add"
            className={cn("pressable flex h-16 items-center justify-center gap-2 rounded-3xl text-lg font-semibold shadow-card",
              active ? "bg-primary text-primary-fg" : "bg-elevated text-muted ring-1 ring-line")}>
            <Plus className="size-6" /> {t("home.newTransaction")}
          </Link>
          {!active && <p className="px-1 text-center text-xs text-subtle">Start work before recording transactions.</p>}
        </Section>

        <ListGroup>
          <ListRow href="/s/inventory" icon={<BookOpen className="size-[18px]" />} title={t("home.myInventory")} trailing={`${booksLeft} books`} />
          <ListRow href="/s/reports" icon={<FileText className="size-[18px]" />} title={t("home.todaysReport")} />
        </ListGroup>
      </div>
      {confirm.node}
    </>
  );
}
