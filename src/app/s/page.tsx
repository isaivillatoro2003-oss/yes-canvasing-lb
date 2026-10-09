"use client";

import { useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { BookOpen, FileText, MapPin, MapPinOff, Minus, Pause, Play, Plus, Square } from "lucide-react";
import { useApp } from "@/lib/app-context";
import { useData, useNow } from "@/lib/hooks";
import { getActiveSession, getInventory, getReport } from "@/lib/queries";
import { rpc, toAppError } from "@/lib/supabase";
import { cn, elapsedLabel, minutesToLabel, money, todayIn } from "@/lib/format";
import type { WorkSession } from "@/lib/types";
import { currentLocation, locationExplained, markLocationExplained, placeLabel, type Loc } from "@/lib/location";
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
  const [busy, setBusy] = useState<"" | "start" | "pause" | "stop">("");
  const [place, setPlace] = useState<Loc | null>(null);
  const now = useNow(1000);

  const active = session.data ?? null;
  const r = report.data;
  const booksLeft = (inventory.data ?? []).reduce((s, row) => s + row.remaining, 0);
  const firstName = profile!.full_name.split(" ")[0];

  // Live clock without paused time: a paused session freezes at the moment it was paused.
  const paused = active?.status === "paused";
  const clockNow = paused && active?.paused_at ? new Date(active.paused_at).getTime() : now;
  const clockStart = active ? new Date(new Date(active.started_at).getTime() + (active.paused_minutes ?? 0) * 60000).toISOString() : "";
  const liveMinutes = active ? Math.max(0, Math.floor((clockNow - new Date(clockStart).getTime()) / 60000)) : 0;
  const completedMinutes = (r?.work_minutes ?? 0) - (r?.active_minutes ?? 0);
  const workMinutes = Math.max(0, completedMinutes) + liveMinutes;

  /** Explains location once (Law 81/2018, Art. 88), then reads it. Never blocks work if refused. */
  async function locate(): Promise<Loc> {
    if (!locationExplained()) {
      await confirm.ask("Location during work", {
        body: "YES records where you are when you start, pause, resume and stop work, with each sale, and every 10 minutes while the app is open during work. Never outside work. Only you, your leader and the program admins can see it.",
        confirm: "Continue",
      });
      markLocationExplained();
    }
    const loc = await currentLocation();
    setPlace(loc);
    return loc;
  }

  function placeToast(verb: string, loc: Loc) {
    const where = placeLabel(loc);
    toast(loc.status === "ok" ? `${verb}${where ? ` · ${where}` : ""}` : `${verb} · location not shared`, loc.status === "ok" ? "success" : "default");
  }

  async function start() {
    setBusy("start");
    try {
      const loc = await locate();
      const s = await rpc<WorkSession>("start_work", { p_loc: loc });
      session.setData(s);
      placeToast("Work started", loc);
      report.refresh();
    } catch (e) {
      toast(toAppError(e).message, "error");
      session.refresh();
    } finally {
      setBusy("");
    }
  }

  async function togglePause() {
    if (!active) return;
    setBusy("pause");
    try {
      const loc = await locate();
      const s = await rpc<WorkSession>(paused ? "resume_work" : "pause_work", { p_loc: loc });
      session.setData(s);
      placeToast(paused ? "Work resumed" : "Work paused", loc);
    } catch (e) {
      toast(toAppError(e).message, "error");
      session.refresh();
    } finally {
      setBusy("");
    }
  }

  async function stop() {
    const ok = await confirm.ask("Stop work?", { body: "Your work time will be saved for today's report.", confirm: "Stop work", tone: "danger" });
    if (!ok) return;
    setBusy("stop");
    try {
      const loc = await locate();
      await rpc<WorkSession>("stop_work", { p_session: active?.id ?? null, p_loc: loc });
      session.setData(null);
      placeToast("Work stopped. Time saved", loc);
      report.refresh();
    } catch (e) {
      toast(toAppError(e).message, "error");
      session.refresh();
    } finally {
      setBusy("");
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
              <Card className={cn("overflow-hidden p-0 text-[var(--cream-100)]", paused ? "bg-[#5b4a2a]" : "bg-[var(--navy-900)]")}>
                <div className="p-6">
                  <div className="flex items-center gap-2 text-overline text-[var(--cream-200)]/80">
                    {paused ? <><Pause className="size-3.5 fill-current" /> PAUSED</> : <><span className="live-dot size-2 rounded-full bg-[#4cc38a]" /> {t("home.workingNow")}</>}
                  </div>
                  <div className={cn("mt-2 text-[3.25rem] font-bold leading-none text-numeric", paused && "opacity-60")} aria-live="off">
                    {elapsedLabel(clockStart, clockNow)}
                  </div>
                  <p className="mt-2 text-sm text-[var(--cream-200)]/70">
                    Started {new Date(active.started_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: settings.timezone })}
                    {paused && active.paused_at && <> · paused at {new Date(active.paused_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: settings.timezone })}</>}
                  </p>
                  {place && (
                    <p className="mt-1 inline-flex items-center gap-1.5 text-sm text-[var(--cream-200)]/70">
                      {place.status === "ok" ? <><MapPin className="size-3.5" /> {placeLabel(place) || "Location recorded"}</> : <><MapPinOff className="size-3.5" /> Location not shared</>}
                    </p>
                  )}
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
              <Button size="xl" block onClick={start} loading={busy === "start"} className="h-24 text-xl">
                <Play className="size-6 fill-current" /> {t("home.startWork")}
              </Button>
              <p className="mt-2 text-center text-sm text-muted">{t("home.notWorking")} · {booksLeft} books in your bag</p>
            </motion.div>
          )}
        </AnimatePresence>

        {active && (
          <div className="grid grid-cols-2 gap-3">
            <Button variant={paused ? "primary" : "secondary"} size="lg" onClick={togglePause} loading={busy === "pause"} disabled={!!busy}>
              {paused ? <><Play className="size-4 fill-current" /> Resume</> : <><Pause className="size-4 fill-current" /> Pause</>}
            </Button>
            <Button variant="secondary" size="lg" onClick={stop} loading={busy === "stop"} disabled={!!busy} className="text-danger">
              <Square className="size-4 fill-current" /> {t("home.stopWork")}
            </Button>
          </div>
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
              active && !paused ? "bg-primary text-primary-fg" : "bg-elevated text-muted ring-1 ring-line")}>
            <Plus className="size-6" /> {t("home.newTransaction")}
          </Link>
          {!active && <p className="px-1 text-center text-xs text-subtle">Start work before recording transactions.</p>}
          {paused && <p className="px-1 text-center text-xs text-subtle">Resume work to record transactions.</p>}
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
