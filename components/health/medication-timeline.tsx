"use client"

import { useLayoutEffect, useMemo, useRef, useState } from "react"
import { ArrowDown, ArrowUp, RotateCcw } from "lucide-react"
import { useFormat } from "@/components/regional-provider"
import {
  axisTicks, buildTimeline, daysBetween, formatSpan, ratingsInWeeks, weeklyObservationCounts,
  type TimelineLane, type TimelineMedication, type TimelineSegment, type WeekCount,
} from "@/lib/medication-timeline"
import { dailyRatings, type DayRatings, type RatedObservation } from "@/lib/day-ratings"
import { cn } from "@/lib/utils"

const DAY = 86_400_000

const RANGES = [
  { value: "all", label: "All", days: null },
  { value: "3y", label: "3Y", days: 365 * 3 },
  { value: "1y", label: "1Y", days: 365 },
  { value: "6m", label: "6M", days: 182 },
] as const
type RangeValue = (typeof RANGES)[number]["value"]

// One hue, light to dark: darker means a higher dose *of that medication*.
// Every lane is its own drug, so identity is carried by the row, never by
// colour, and the full hue is free to encode dose. The floor keeps the
// lightest dose clear of 2:1 against the card in light and dark themes, and
// text flips to the card colour once the fill is dark enough to need it.
const MIN_MIX = 40
const mixFor = (intensity: number) => Math.round(MIN_MIX + (100 - MIN_MIX) * Math.min(1, Math.max(0, intensity)))
const doseFill = (mix: number) => `color-mix(in oklch, var(--cost-bar) ${mix}%, var(--card))`
const UNKNOWN_FILL = "color-mix(in oklch, var(--muted-foreground) 28%, var(--card))"

const LANE_HEIGHT = 36
const BAR_HEIGHT = 18
const OBS_HEIGHT = 28

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setWidth(el.offsetWidth)
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return { ref, width }
}

const changeWord = (s: TimelineSegment) =>
  s.change === "up" ? `Increased from ${s.previousDosage}` :
  s.change === "down" ? `Decreased from ${s.previousDosage}` :
  s.change === "restart" ? "Restarted" :
  s.change === "start" ? "Started" : s.previousDosage ? `Changed from ${s.previousDosage}` : "Continued"

function ChangeIcon({ change, className }: { change: TimelineSegment["change"]; className?: string }) {
  if (change === "up") return <ArrowUp className={className} strokeWidth={2.25} aria-hidden="true" />
  if (change === "down") return <ArrowDown className={className} strokeWidth={2.25} aria-hidden="true" />
  if (change === "restart") return <RotateCcw className={className} strokeWidth={2.25} aria-hidden="true" />
  return null
}

type Readout = { t: number; x: number }

interface Props {
  medications: TimelineMedication[]
  observations: RatedObservation[]
  onSelect: (id: string) => void
}

export function MedicationTimeline({ medications, observations, onSelect }: Props) {
  const fmt = useFormat()
  const [range, setRange] = useState<RangeValue>("all")
  const [readout, setReadout] = useState<Readout | null>(null)
  const { ref: plotRef, width: plotWidth } = useWidth<HTMLDivElement>()

  // `now` is the end of today (UTC), not this millisecond: the server render and
  // the hydrating client then place every bar identically, and hover re-renders
  // never move it. Day resolution is all a dose timeline needs.
  const [now] = useState(() => {
    const t = new Date()
    return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()) + DAY)
  })
  const lanes = useMemo(() => buildTimeline(medications, now), [medications, now])
  const undated = medications.filter((m) => !m.startDate).length

  const nowMs = now.getTime()
  const latest = lanes.length ? Math.max(nowMs, ...lanes.map((l) => l.last)) : nowMs
  const earliest = lanes.length ? Math.min(...lanes.map((l) => l.first)) : nowMs - 365 * DAY
  const spec = RANGES.find((r) => r.value === range)!
  const rawFrom = spec.days ? Math.max(earliest, nowMs - spec.days * DAY) : earliest
  const pad = Math.max(7 * DAY, (latest - rawFrom) * 0.02)
  const from = rawFrom - (spec.days ? 0 : pad)
  const to = latest + pad
  const span = to - from
  const pos = (t: number) => ((Math.min(Math.max(t, from), to) - from) / span) * 100

  const visible = lanes.filter((l) => l.segments.some((s) => s.end > from && s.start < to))
  const ticks = axisTicks(from, to)
  // Each week's bar is its average day (each day rated by its worst entry),
  // scaled to the tallest week but never taller than a full mild week.
  const weeks = useMemo(() => weeklyObservationCounts(observations, from, to), [observations, from, to])
  const weekMax = Math.max(1, ...weeks.map((w) => w.avg))
  const ratings = useMemo(() => dailyRatings(observations), [observations])
  const obsInRange = weeks.reduce((s, w) => s + w.count, 0)
  const periods = visible.reduce((s, l) => s + l.segments.length, 0)
  const activeCount = visible.filter((l) => l.active).length

  const fmtDate = (t: number) => fmt.date(new Date(t), { utc: true })

  function readAt(clientX: number) {
    const el = plotRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const x = Math.min(Math.max(clientX - r.left, 0), r.width)
    setReadout({ t: from + (x / r.width) * span, x })
  }

  // Everything she was taking on the hovered day — the one question a timeline
  // like this exists to answer.
  const onDay = readout
    ? visible
        .map((l) => ({ lane: l, seg: l.segments.find((s) => s.start <= readout.t && readout.t < s.end) }))
        .filter((r): r is { lane: TimelineLane; seg: TimelineSegment } => !!r.seg)
    : []
  const readoutWeek = readout ? weeks.find((w) => w.start <= readout.t && readout.t < w.start + 7 * DAY) : undefined

  if (lanes.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        Add start dates to medications to see them on a timeline.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-md border p-0.5" role="group" aria-label="Time range">
          {RANGES.map((r) => (
            <button
              key={r.value}
              type="button"
              aria-pressed={range === r.value}
              onClick={() => { setRange(r.value); setReadout(null) }}
              className={cn(
                "rounded px-2.5 py-1 text-xs font-medium transition-colors",
                range === r.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{visible.length}</span> medications ·{" "}
          <span className="font-medium text-foreground">{periods}</span> dose periods ·{" "}
          <span className="font-medium text-foreground">{activeCount}</span> current
          {undated > 0 && <> · {undated} without a start date not shown</>}
        </p>
      </div>

      <figure className="rounded-lg border bg-card">
        <figcaption className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b px-4 py-3">
          <div>
            <div className="text-sm font-medium">Medication timeline</div>
            <div className="text-xs text-muted-foreground">Each bar is one dose period. Hover or tap anywhere to see everything taken that day; click a bar to edit it.</div>
          </div>
          <Legend />
        </figcaption>

        <div className="overflow-x-auto">
          <div className="min-w-[640px] px-4 pb-3 pt-2">
            <div className="flex">
              {/* Lane labels */}
              {/* Sticky so the names stay put while a narrow screen scrolls the plot. */}
              <div className="sticky left-0 z-30 -ml-4 w-32 shrink-0 bg-card pl-4 pr-3 sm:w-48">
                <div style={{ height: 22 }} />
                {visible.map((l) => (
                  <div key={l.key} className="flex flex-col justify-center" style={{ height: LANE_HEIGHT }}>
                    <div className="truncate text-sm font-medium leading-tight" title={l.name}>{l.name}</div>
                    <div className="truncate text-[11px] leading-tight text-muted-foreground">
                      {l.active && l.current
                        ? <span className="text-foreground">Now{l.current.med.dosage ? ` · ${l.current.med.dosage}` : ""}</span>
                        : laneYears(l)}
                    </div>
                  </div>
                ))}
                {observations.length > 0 && (
                  <div className="flex flex-col justify-center border-t" style={{ height: OBS_HEIGHT + 10 }}>
                    <div className="text-[11px] font-medium leading-tight text-muted-foreground">Observations</div>
                    <div className="text-[11px] leading-tight text-muted-foreground">avg day · {obsInRange} logged</div>
                  </div>
                )}
              </div>

              {/* Plot */}
              <div
                ref={plotRef}
                className="relative min-w-0 flex-1 select-none"
                onPointerMove={(e) => readAt(e.clientX)}
                onPointerDown={(e) => readAt(e.clientX)}
                onPointerLeave={() => setReadout(null)}
              >
                {/* Month gridlines and year rules */}
                <div className="pointer-events-none absolute inset-0" aria-hidden="true">
                  {ticks.map((t) => (
                    <div
                      key={t.at}
                      className="absolute top-[22px] bottom-0 w-px"
                      style={{ left: `${pos(t.at)}%`, background: t.major ? "var(--chart-crosshair)" : "var(--chart-grid)" }}
                    />
                  ))}
                  {ticks.map((t) => (
                    <div
                      key={`l${t.at}`}
                      className={cn("absolute top-1 -translate-x-1/2 text-[11px] tabular-nums", t.major ? "font-medium text-foreground" : "text-muted-foreground")}
                      style={{ left: `${pos(t.at)}%` }}
                    >
                      {t.label}
                    </div>
                  ))}
                  {nowMs > from && nowMs < to && (
                    <div className="absolute top-[18px] bottom-0" style={{ left: `${pos(nowMs)}%` }}>
                      <div className="absolute top-0 bottom-0 w-px bg-foreground/50" />
                      <div className="absolute -top-[2px] -translate-x-1/2 rounded-sm bg-foreground px-1 text-[9px] font-semibold uppercase leading-[13px] tracking-wide text-background">
                        Today
                      </div>
                    </div>
                  )}
                </div>

                <div style={{ height: 22 }} />
                {visible.map((l) => (
                  <div key={l.key} className="relative border-b border-[var(--chart-grid)] last:border-b-0" style={{ height: LANE_HEIGHT }}>
                    {l.segments.map((s) => (
                      <SegmentMark
                        key={s.med.id}
                        s={s}
                        left={pos(s.start)}
                        right={pos(s.end)}
                        hidden={s.end <= from || s.start >= to}
                        plotWidth={plotWidth}
                        laneName={l.name}
                        describe={(t) => fmtDate(t)}
                        onSelect={() => onSelect(s.med.id)}
                        onFocusAt={(t) => {
                          const w = plotRef.current?.offsetWidth ?? 0
                          setReadout({ t, x: (pos(t) / 100) * w })
                        }}
                        onBlur={() => setReadout(null)}
                      />
                    ))}
                  </div>
                ))}

                {observations.length > 0 && (
                  <div className="relative border-t" style={{ height: OBS_HEIGHT + 10 }} aria-hidden="true">
                    {weeks.map((w) =>
                      w.avg > 0 ? (
                        <div
                          key={w.start}
                          className="absolute bottom-[5px] rounded-t-[2px]"
                          style={{
                            left: `calc(${pos(w.start)}% + 0.5px)`,
                            width: `calc(${pos(w.start + 7 * DAY) - pos(w.start)}% - 1px)`,
                            height: Math.max(3, (w.avg / weekMax) * OBS_HEIGHT),
                            background: "var(--chart-ghost)",
                          }}
                        />
                      ) : null
                    )}
                  </div>
                )}

                {/* Crosshair */}
                {readout && (
                  <div className="pointer-events-none absolute top-[22px] bottom-0 z-10 w-px bg-[var(--chart-trend)]/60" style={{ left: readout.x }} aria-hidden="true" />
                )}
                {readout && (
                  <DayCard
                    x={readout.x}
                    width={plotWidth}
                    title={fmtDate(readout.t)}
                    rows={onDay.map(({ lane, seg }) => ({ lane: lane.name, seg }))}
                    week={observations.length > 0 ? readoutWeek : undefined}
                    ratings={ratings}
                  />
                )}
              </div>
            </div>
          </div>
        </div>
      </figure>
    </div>
  )
}

function laneYears(l: TimelineLane): string {
  const a = new Date(l.first).getUTCFullYear()
  const b = new Date(l.last - DAY).getUTCFullYear()
  const n = l.segments.length
  return `${a === b ? a : `${a}–${b}`} · ${n} ${n === 1 ? "period" : "periods"}`
}

function SegmentMark({
  s, left, right, hidden, plotWidth, laneName, describe, onSelect, onFocusAt, onBlur,
}: {
  s: TimelineSegment
  left: number
  right: number
  hidden: boolean
  plotWidth: number
  laneName: string
  describe: (t: number) => string
  onSelect: () => void
  onFocusAt: (t: number) => void
  onBlur: () => void
}) {
  if (hidden) return null
  const label = [
    laneName,
    s.med.dosage ?? "dose not recorded",
    s.point ? `on ${describe(s.start)}` : `${describe(s.start)} to ${s.ongoing ? "now" : describe(s.end - DAY)}`,
    changeWord(s),
  ].join(", ")
  const common = {
    type: "button" as const,
    "aria-label": label,
    onClick: onSelect,
    onFocus: () => onFocusAt(s.start + (s.end - s.start) / 2),
    onBlur,
  }

  if (s.point) {
    return (
      <button
        {...common}
        className="group absolute top-1/2 flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        style={{ left: `${(left + right) / 2}%` }}
      >
        <span
          className="block h-2.5 w-2.5 rotate-45 rounded-[2px] ring-2 ring-[var(--card)] transition-transform group-hover:scale-125"
          style={{ background: s.intensity == null ? "var(--muted-foreground)" : doseFill(mixFor(s.intensity)) }}
        />
      </button>
    )
  }

  const mix = s.intensity == null ? null : mixFor(s.intensity)
  const fill = mix == null ? UNKNOWN_FILL : doseFill(mix)
  const ink = mix != null && mix >= 70 ? "var(--card)" : mix == null ? "var(--muted-foreground)" : "var(--foreground)"
  const px = ((right - left) / 100) * plotWidth - 2
  const text = s.med.dosage?.replace(/\s*\(.*\)\s*/, "").trim() || "dose ?"
  const icon = s.change === "up" || s.change === "down" || s.change === "restart"
  const fits = px >= text.length * 6.4 + (icon ? 14 : 0) + 12

  return (
    <button
      {...common}
      className={cn(
        "group absolute top-1/2 flex -translate-y-1/2 items-center overflow-hidden px-1.5 text-[11px] font-medium leading-none",
        "transition-[filter] hover:brightness-[1.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 dark:hover:brightness-110",
        s.ongoing ? "rounded-l-[4px] rounded-r-[1px]" : "rounded-[4px]"
      )}
      style={{
        // A 1px inset each side leaves the 2px surface gap between back-to-back doses.
        left: `calc(${left}% + 1px)`,
        width: `max(3px, calc(${right - left}% - 2px))`,
        height: BAR_HEIGHT,
        background: fill,
        color: ink,
      }}
    >
      {fits && (
        <span className="flex min-w-0 items-center gap-0.5 whitespace-nowrap">
          <ChangeIcon change={s.change} className="h-3 w-3 shrink-0" />
          <span className="tabular-nums">{text}</span>
        </span>
      )}
    </button>
  )
}

function DayCard({
  x, width, title, rows, week, ratings,
}: {
  x: number
  width: number
  title: string
  rows: { lane: string; seg: TimelineSegment }[]
  week: WeekCount | undefined
  /// Every day's rating, for each dose's summary under the week's.
  ratings: DayRatings
}) {
  const during = (s: TimelineSegment) => ratingsInWeeks(ratings, s.start, s.end)
  // Sits beside the crosshair, on whichever side has room, so it never covers
  // the bars right under the pointer.
  const flip = x > width / 2
  return (
    <div
      role="status"
      className="chart-fade pointer-events-none absolute top-7 z-20 w-64 rounded-lg border bg-popover px-3 py-2 text-popover-foreground shadow-md"
      style={{ left: flip ? x - 12 : x + 12, transform: flip ? "translateX(-100%)" : undefined }}
    >
      <div className="text-xs font-medium">{title}</div>
      {rows.length === 0 ? (
        <div className="mt-1 text-xs text-muted-foreground">No medications on this day.</div>
      ) : (
        <dl className="mt-1.5 space-y-1.5">
          {rows.map(({ lane, seg }) => (
            <div key={seg.med.id} className="text-xs">
              <div className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="h-0.5 w-3 shrink-0 rounded-full"
                  style={{ background: seg.intensity == null ? "var(--muted-foreground)" : doseFill(mixFor(seg.intensity)) }}
                />
                <dt className="min-w-0 flex-1 truncate text-muted-foreground">{lane}</dt>
                <dd className="flex shrink-0 items-center gap-0.5 font-medium tabular-nums">
                  <ChangeIcon change={seg.change} className="h-3 w-3" />
                  {seg.med.dosage ?? "dose ?"}
                </dd>
              </div>
              <div className="pl-5 text-[11px] text-muted-foreground">
                {changeWord(seg)} · {formatSpan(daysBetween(seg.start, seg.end))}{seg.ongoing ? " so far" : ""}
              </div>
            </div>
          ))}
        </dl>
      )}
      {week && (
        <div className="mt-1.5 space-y-1 border-t pt-1.5 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">That week</span>
            <span className="shrink-0 tabular-nums">
              <span className="font-medium">avg day {week.avg}</span>
              <span className="text-muted-foreground"> · {week.count} logged{week.severe ? ` · ${week.severe} severe` : ""}</span>
            </span>
          </div>
          {rows.length > 0 && (
            <div>
              <div className="text-muted-foreground">During each dose (whole weeks)</div>
              {rows.map(({ lane, seg }) => {
                const d = during(seg)
                return (
                  <div key={seg.med.id} className="flex items-center justify-between gap-2 pl-2">
                    <span className="min-w-0 truncate">{lane} {seg.med.dosage ?? ""}</span>
                    <span className="shrink-0 tabular-nums">
                      <span className="font-medium">avg {d.avg}</span>
                      <span className="text-muted-foreground"> · {d.severe} severe in {d.weeks} wk</span>
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Legend() {
  const steps = [0, 0.25, 0.5, 0.75, 1]
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-muted-foreground" aria-hidden="true">
      <span className="flex items-center gap-1.5">
        Lower
        <span className="flex gap-px">
          {steps.map((i) => (
            <span key={i} className="h-2.5 w-3.5 first:rounded-l-[3px] last:rounded-r-[3px]" style={{ background: doseFill(mixFor(i)) }} />
          ))}
        </span>
        Higher dose
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-4 rounded-[3px]" style={{ background: UNKNOWN_FILL }} />
        Not recorded
      </span>
      <span className="flex items-center gap-1.5">
        <span className="block h-2 w-2 rotate-45 rounded-[1px] bg-[var(--cost-bar)]" />
        One day
      </span>
      <span className="flex items-center gap-1">
        <ArrowUp className="h-3 w-3" strokeWidth={2.25} />
        <ArrowDown className="h-3 w-3" strokeWidth={2.25} />
        Dose change
      </span>
      <span className="flex items-center gap-1">
        <RotateCcw className="h-3 w-3" strokeWidth={2.25} />
        Restarted
      </span>
    </div>
  )
}
