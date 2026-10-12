"use client";

import { useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import type { WeekDay } from "@/lib/leader";
import { money } from "@/lib/format";
import { Card, Segmented } from "@/components/ui";

type Measure = "books" | "money";

const W = 320, H = 150, TOP = 22, BOTTOM = 24, GAP = 10;

function dayLabel(iso: string, short = true) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", short ? { weekday: "short", timeZone: "UTC" } : { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" });
}

/** Last 7 days as one bar series. One measure at a time (never two y-scales). */
export function WeekChart({ days, currency }: { days: WeekDay[]; currency: string }) {
  const [measure, setMeasure] = useState<Measure>("books");
  const [hover, setHover] = useState<number | null>(null);
  const reduce = useReducedMotion();
  const value = (d: WeekDay) => (measure === "books" ? d.books : d.money);
  const fmt = (n: number) => (measure === "books" ? `${n} book${n === 1 ? "" : "s"}` : money(n, currency));
  const max = Math.max(1, ...days.map(value));
  const total = days.reduce((n, d) => n + value(d), 0);
  const plotH = H - TOP - BOTTOM;
  const bw = (W - GAP * (days.length - 1)) / days.length;
  const focus = hover ?? days.length - 1;
  const best = days.reduce((b, d, i) => (value(d) > value(days[b]) ? i : b), 0);

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-subtle">Last 7 days</div>
          <div className="mt-1.5 text-[26px] font-semibold leading-none tracking-[-0.03em] text-numeric">{fmt(total)}</div>
        </div>
        <Segmented value={measure} onChange={setMeasure} className="w-40 shrink-0"
          options={[{ value: "books", label: "Books" }, { value: "money", label: "Value" }]} />
      </div>

      <p className="mt-3 h-5 text-sm text-muted" aria-live="polite">
        <span className="font-semibold text-fg">{dayLabel(days[focus].date, false)}</span> · {fmt(value(days[focus]))}
        {measure === "books" && <> · {days[focus].transactions} sale{days[focus].transactions === 1 ? "" : "s"}</>}
      </p>

      <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 w-full overflow-visible" role="img"
        aria-label={`${measure === "books" ? "Books distributed" : "Book value and donations"} per day: ` + days.map((d) => `${dayLabel(d.date)} ${fmt(value(d))}`).join(", ")}
        onPointerLeave={() => setHover(null)}>
        <line x1={0} x2={W} y1={TOP + plotH + 0.5} y2={TOP + plotH + 0.5} stroke="var(--line-strong, var(--line))" />
        {days.map((d, i) => {
          const v = value(d);
          const h = v === 0 ? 0 : Math.max(4, (v / max) * plotH);
          const x = i * (bw + GAP);
          const y = TOP + plotH - h;
          const isToday = i === days.length - 1;
          const showLabel = v > 0 && (i === best || i === focus);
          return (
            <g key={d.date}>
              {/* Hit target is the whole column, bigger than the bar */}
              <rect x={x - GAP / 2} y={0} width={bw + GAP} height={H} fill="transparent"
                onPointerEnter={() => setHover(i)} onPointerDown={() => setHover(i)} />
              {v === 0 ? (
                <rect x={x} y={TOP + plotH - 2} width={bw} height={2} rx={1} fill="var(--fg-subtle)" opacity={0.35} pointerEvents="none" />
              ) : (
                <motion.path pointerEvents="none"
                  initial={reduce ? false : { opacity: 0, scaleY: 0 }} animate={{ opacity: focus === i || hover === null ? 1 : 0.55, scaleY: 1 }}
                  style={{ originY: 1, transformBox: "fill-box" }}
                  transition={reduce ? { duration: 0 } : { type: "spring", bounce: 0.15, duration: 0.5, delay: hover === null ? i * 0.04 : 0 }}
                  d={`M${x},${y + h} V${y + 4} Q${x},${y} ${x + 4},${y} H${x + bw - 4} Q${x + bw},${y} ${x + bw},${y + 4} V${y + h} Z`}
                  fill="var(--accent)" key={`${measure}-${d.date}`} />
              )}
              {showLabel && (
                <text x={x + bw / 2} y={y - 6} textAnchor="middle" className="fill-[var(--fg-muted)] text-[10px] font-semibold" pointerEvents="none">
                  {measure === "books" ? v : money(v, currency)}
                </text>
              )}
              <text x={x + bw / 2} y={H - 6} textAnchor="middle" pointerEvents="none"
                className={isToday ? "fill-[var(--fg)] text-[11px] font-semibold" : "fill-[var(--fg-subtle)] text-[11px]"}>
                {isToday ? "Today" : dayLabel(d.date)}
              </text>
            </g>
          );
        })}
      </svg>
    </Card>
  );
}
