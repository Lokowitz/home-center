"use client"

import { useMemo, useState } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { useFormat } from "@/components/regional-provider"
import { TooltipCard, useChartTooltip, type TooltipRow } from "@/components/charts/primitives/tooltip"
import type { MedicationEvent } from "@/lib/medication-effects"
import { calendarLevel, calendarRanges, observationCalendar } from "@/lib/observation-calendar"
import { RATING_WORDS } from "@/lib/day-ratings"
import { cn } from "@/lib/utils"

const DAY = 86_400_000
const WEEKDAYS = ["Mon", "", "Wed", "", "Fri", "", ""]

// Empty days are a faint wash of the ink, not the surface, so "nothing logged"
// still reads as a day in the grid; logged days step up one hue by their
// rating — the worst entry that day — from mild to severe.
const LEVEL_FILL = [
  "color-mix(in oklch, var(--muted-foreground) 13%, var(--card))",
  "color-mix(in oklch, var(--cost-bar) 30%, var(--card))",
  "color-mix(in oklch, var(--cost-bar) 47%, var(--card))",
  "color-mix(in oklch, var(--cost-bar) 64%, var(--card))",
  "color-mix(in oklch, var(--cost-bar) 82%, var(--card))",
  "var(--cost-bar)",
]

const KIND_WORD: Record<MedicationEvent["kind"], string> = {
  start: "Started", up: "Increased", down: "Decreased", restart: "Restarted", stop: "Stopped",
}

interface Props {
  observations: { date: Date; type: string; severity?: number | null }[]
  events: MedicationEvent[]
  pickedDay: number | null
  onPickDay: (day: number | null) => void
}

export function ObservationCalendar({ observations, events, pickedDay, onPickDay }: Props) {
  const fmt = useFormat()
  const { containerRef, cardRef, tip, offset, anchorProps } = useChartTooltip()
  // Ranges work in whole UTC days, so the server render and hydration agree.
  const [now] = useState(() => new Date())
  const ranges = useMemo(() => calendarRanges(observations.map((o) => o.date), now), [observations, now])
  const [rangeValue, setRangeValue] = useState("12m")
  const index = Math.max(0, ranges.findIndex((r) => r.value === rangeValue))
  const range = ranges[index]
  const cal = useMemo(() => observationCalendar(observations, range.from, range.to), [observations, range.from, range.to])

  const eventsByWeek = new Map<number, MedicationEvent[]>()
  for (const e of events) {
    if (e.at < range.from || e.at > range.to + DAY) continue
    const w = cal.weeks.findIndex((wk) => e.at >= wk.start && e.at < wk.start + 7 * DAY)
    if (w >= 0) eventsByWeek.set(w, [...(eventsByWeek.get(w) ?? []), e])
  }
  const columns = `2rem repeat(${cal.weeks.length}, minmax(0, 1fr))`
  // Drop a month label that would crowd the one before it (a range starting
  // late in a month labels that month and then the next a column or two later).
  // The first label kept always carries its year.
  const months = cal.months
    .filter((m, i, all) => !(all[i + 1] && all[i + 1].week - m.week < 3))
    .map((m, i) => {
      if (i > 0 || /\d{4}/.test(m.label)) return m
      const last = cal.weeks[m.week].days.filter(Boolean).at(-1)!
      return { ...m, label: `${m.label} ${new Date(last.day).getUTCFullYear()}` }
    })
  const day = (t: number) => fmt.date(new Date(t), { utc: true })

  return (
    <figure className="rounded-lg border bg-card">
      <figcaption className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b px-4 py-3">
        <div>
          <div className="text-sm font-medium">Year at a glance</div>
          <div className="text-xs text-muted-foreground">
            {cal.total} logged · each day shaded by its worst entry, darker is more severe. Click a day to list it below.
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Newer"
            disabled={index === 0}
            onClick={() => setRangeValue(ranges[index - 1].value)}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div className="inline-flex rounded-md border p-0.5" role="group" aria-label="Calendar range">
            {ranges.map((r) => (
              <button
                key={r.value}
                type="button"
                aria-pressed={r.value === range.value}
                onClick={() => setRangeValue(r.value)}
                className={cn(
                  "rounded px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors",
                  r.value === range.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {r.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            aria-label="Older"
            disabled={index === ranges.length - 1}
            onClick={() => setRangeValue(ranges[index + 1].value)}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </figcaption>

      {/* The tooltip is positioned against this outer wrapper, outside the
          scroll box, so a card over the top rows isn't clipped by it. */}
      <div ref={containerRef} className="relative">
      <div className="overflow-x-auto">
        <div className="min-w-[600px] px-4 pb-3 pt-3">
          <div>
            <div className="min-w-0">
              {/* Medication changes, one marker per week that had any */}
              <div className="grid h-4 gap-[3px]" style={{ gridTemplateColumns: columns }}>
                <div />
                {cal.weeks.map((_, w) => {
                  const list = eventsByWeek.get(w)
                  if (!list) return <div key={w} />
                  return (
                    <button
                      key={w}
                      type="button"
                      className="flex items-center justify-center rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                      aria-label={list.map((e) => `${day(e.at)}: ${e.name} ${e.label}`).join("; ")}
                      {...anchorProps({
                        title: list.length === 1 ? "Medication change" : `${list.length} medication changes`,
                        rows: list.flatMap((e) => [
                          { label: `${KIND_WORD[e.kind]} ${e.name}`, value: fmt.dayMonth(new Date(e.at), { utc: true }) },
                          { label: e.label, value: "", muted: true },
                        ]),
                      })}
                    >
                      <span className="block h-2 w-2 rotate-45 rounded-[1px] bg-foreground/70" />
                    </button>
                  )
                })}
              </div>

              {/* Months */}
              <div className="mb-1 grid h-4 gap-[3px] text-[10px] text-muted-foreground" style={{ gridTemplateColumns: columns }} aria-hidden="true">
                <div />
                {cal.weeks.map((_, w) => {
                  const m = months.find((x) => x.week === w)
                  return <div key={w} className="relative">{m && <span className="absolute left-0 whitespace-nowrap">{m.label}</span>}</div>
                })}
              </div>

              {/* Days, with the weekday labels as the first column so their rows line up */}
              <div className="grid gap-[3px]" style={{ gridTemplateColumns: columns }}>
                <div className="grid grid-rows-7 gap-[3px] text-[10px] text-muted-foreground" aria-hidden="true">
                  {WEEKDAYS.map((w, i) => (
                    <div key={i} className="flex items-center leading-none">{w}</div>
                  ))}
                </div>
                {cal.weeks.map((wk) => (
                  <div key={wk.start} className="grid grid-rows-7 gap-[3px]">
                    {wk.days.map((d, i) =>
                      d ? (
                        <button
                          key={i}
                          type="button"
                          tabIndex={-1}
                          onClick={() => onPickDay(pickedDay === d.day ? null : d.day)}
                          className={cn(
                            "aspect-square rounded-[2px] transition-transform hover:scale-125 hover:ring-1 hover:ring-foreground/40",
                            pickedDay === d.day && "ring-2 ring-foreground"
                          )}
                          style={{ background: LEVEL_FILL[calendarLevel(d.rating)] }}
                          {...anchorProps({
                            title: day(d.day),
                            rows: d.count === 0
                              ? [{ label: "Nothing logged", value: "", muted: true }]
                              : [{ label: `${RATING_WORDS[calendarLevel(d.rating)]} day`, value: `${d.rating} / 5` } as TooltipRow].concat(
                                  d.titles.slice(0, 6).map((t): TooltipRow => ({ label: t, value: "", muted: true })),
                                  d.titles.length > 6 ? [{ label: `and ${d.titles.length - 6} more`, value: "", muted: true }] : []
                                ),
                          })}
                        />
                      ) : (
                        <div key={i} className="aspect-square" />
                      )
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-end gap-x-4 gap-y-1 text-[11px] text-muted-foreground" aria-hidden="true">
            <span className="flex items-center gap-1.5">
              <span className="block h-2 w-2 rotate-45 rounded-[1px] bg-foreground/70" />
              Medication change
            </span>
            <span className="flex items-center gap-1">
              Quiet
              {LEVEL_FILL.map((f, i) => (
                <span key={i} className="h-2.5 w-2.5 rounded-[2px]" style={{ background: f }} />
              ))}
              Severe
            </span>
          </div>
        </div>
      </div>
      <TooltipCard tip={tip} cardRef={cardRef} offset={offset} />
      </div>

      <table className="sr-only">
        <caption>Days with observations, {range.label}</caption>
        <thead><tr><th>Day</th><th>Rating (worst entry, 1 to 5)</th><th>Count</th><th>What</th></tr></thead>
        <tbody>
          {cal.weeks.flatMap((wk) => wk.days).filter((d) => d && d.count > 0).map((d) => (
            <tr key={d!.day}><td>{day(d!.day)}</td><td>{d!.rating}</td><td>{d!.count}</td><td>{d!.titles.join(", ")}</td></tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}
