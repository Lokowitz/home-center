import { SectionTitle } from "./report-parts"
import type { Formatter } from "@/lib/regional"
import {
  axisTicks, buildTimeline, daysBetween, formatSpan, weeklyObservationCounts,
  type TimelineLane, type TimelineMedication,
} from "@/lib/medication-timeline"
import { medicationEffects, medicationEvents, STEADY_DELTA, type MedicationEffect, type MedicationEvent } from "@/lib/medication-effects"
import type { RatedObservation } from "@/lib/day-ratings"
import { medicationInsights, type MedicationInsights } from "@/lib/medication-insights"
import { calendarLevel, observationCalendar, utcDay } from "@/lib/observation-calendar"
import { niceMax } from "@/components/charts/primitives/scale"

// The medical summary's medication and behaviour review, drawn for paper. It
// opens on a page of its own with the numbers and plain findings a clinician
// reads first, then the three charts the app shows interactively — redrawn
// without hover or zoom, in report ink, and with every fill marked to survive
// "print backgrounds off". Direction is always carried by words and arrows,
// so a monochrome printer loses only the tint. Same logic as the app's views,
// so paper and screen agree.

const DAY = 86_400_000
// Roughly the timeline plot's printed width in CSS px (8.5in sheet, margins,
// label column), used only to decide whether a dose label fits inside a bar.
const PLOT_PX = 520
const LANE = 19

const doseFill = (intensity: number | null) =>
  intensity == null ? "#e4e6ea" : `color-mix(in oklch, var(--accent) ${Math.round(35 + 65 * intensity)}%, white)`
// Quiet, then mild (1) to severe (5): one hue, light to dark.
const HEAT = ["#eef0f4", ...[28, 46, 64, 82].map((m) => `color-mix(in oklch, var(--accent) ${m}%, white)`), "var(--accent)"]

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
const monthYear = (t: number) => `${MONTH_NAMES[new Date(t).getUTCMonth()]} ${new Date(t).getUTCFullYear()}`

const faint = { color: "var(--ink-faint)" } as const
const soft = { color: "var(--ink-soft)" } as const

export function MedicationReview({
  medications, observations, now, fmt,
}: {
  medications: TimelineMedication[]
  observations: { date: Date; type: string; severity?: number | null }[]
  now: Date
  fmt: Formatter
}) {
  const lanes = buildTimeline(medications, now)
  if (lanes.length === 0) return null
  const events = medicationEvents(lanes)
  const effects = observations.length ? medicationEffects(events, observations, now) : []
  const insights = medicationInsights(lanes, events, effects, observations, now)
  const day = (t: number) => fmt.date(new Date(t), { utc: true })

  return (
    <div className="report-page-break">
      <section className="report-section report-break-avoid mt-7">
        <SectionTitle>Medication &amp; behavior review</SectionTitle>
        <p className="mt-1 text-[9pt]" style={soft}>
          Medications from the record, with how the days went around each change. Each day is rated by the most severe
          observation the family logged that day (meltdowns, symptoms, moods), 0 for nothing logged to 5 for severe;
          an entry without a severity counts as mild. These are records, not assessments: they show when things
          changed, for the reader and their clinician to interpret.
        </p>
        <Glance insights={insights} fmt={fmt} />
        <Findings insights={insights} now={now} day={day} />
      </section>

      <HistoryChart lanes={lanes} observations={observations} now={now} />

      {observations.length > 0 && <EffectsChart effects={effects} day={day} />}

    </div>
  )
}

// --- At a glance ---------------------------------------------------------------

function Glance({ insights, fmt }: { insights: MedicationInsights; fmt: Formatter }) {
  const o = insights.observations
  const trend = o.last90 > o.prior90 ? "more than" : o.last90 < o.prior90 ? "fewer than" : "same as"
  const tiles: { label: string; value: string; detail: React.ReactNode }[] = [
    {
      label: "Taking now",
      value: String(insights.current.length),
      detail: insights.current.length
        ? insights.current.map((c) => `${c.name}${c.dosage ? ` ${c.dosage}` : ""} since ${fmt.dayMonth(new Date(c.since), { utc: true })}`).join("; ")
        : "No current medications",
    },
    {
      label: "Medications tried",
      value: String(insights.tried),
      detail: `${insights.changesLastYear} change${insights.changesLastYear === 1 ? "" : "s"} in the past 12 months`,
    },
    {
      label: "Observations, last 90 days",
      value: String(o.last90),
      detail: `${o.perWeek90} a week · ${trend} the 90 days before (${o.prior90}) · average day ${o.avgDay90}, ${o.severeDays90} severe day${o.severeDays90 === 1 ? "" : "s"}`,
    },
    {
      label: "Busiest month",
      value: o.busiestMonth ? String(o.busiestMonth.count) : "—",
      detail: o.busiestMonth ? `${o.busiestMonth.label} · ${o.total} logged in all` : "Nothing logged",
    },
  ]
  return (
    <div className="mt-3 grid grid-cols-4 gap-2.5">
      {tiles.map((t) => (
        <div key={t.label} className="rounded-md border px-3 py-2" style={{ borderColor: "var(--rule-strong)" }} data-print-color="">
          <div className="text-[7.5pt] font-semibold uppercase tracking-wide" style={faint}>{t.label}</div>
          <div className="text-[18pt] font-semibold leading-tight">{t.value}</div>
          <div className="text-[8pt] leading-snug" style={soft}>{t.detail}</div>
        </div>
      ))}
    </div>
  )
}

// --- What the record shows -----------------------------------------------------

function effectLine(e: MedicationEffect, day: (t: number) => string) {
  const others = [...new Set(e.nearby.map((n) => n.name))]
  return (
    <>
      <strong>{e.name} {e.label}</strong> on {day(e.at)}: average day {e.before.avg} in the 4 weeks before, {e.after.avg} in
      the 4 weeks after; severe days {e.before.severe} → {e.after.severe}{others.length ? <> (also changed those weeks: {others.join(", ")})</> : null}.
    </>
  )
}

function Findings({ insights, now, day }: { insights: MedicationInsights; now: Date; day: (t: number) => string }) {
  const o = insights.observations
  const items: React.ReactNode[] = []
  if (insights.current.length && insights.lastChangeAt != null) {
    const latest = insights.current[0]
    items.push(
      <>Most recent change: <strong>{latest.name}{latest.dosage ? ` ${latest.dosage}` : ""}</strong> from {day(latest.since)},{" "}
        {formatSpan(daysBetween(latest.since, now.getTime()))} ago.</>
    )
  }
  if (o.last90 + o.prior90 > 0) {
    const word = o.last90 > o.prior90 * 1.1 ? "up from" : o.last90 < o.prior90 * 0.9 ? "down from" : "about the same as"
    items.push(<>{o.last90} observations in the last 90 days, {word} {o.prior90} in the 90 days before.</>)
  }
  if (insights.biggestRise) items.push(<>Largest rise after a change — {effectLine(insights.biggestRise, day)}</>)
  if (insights.biggestDrop) items.push(<>Largest fall after a change — {effectLine(insights.biggestDrop, day)}</>)
  if (o.topTypes90.length) {
    items.push(<>Most frequent entries in the last 90 days: {o.topTypes90.map((t) => `${t.type} (${t.count})`).join(", ")}.</>)
  }
  if (o.regularFrom != null) {
    items.push(
      <>Observations have been logged regularly since {monthYear(o.regularFrom)};
        before/after comparisons earlier than that rest on few entries.</>
    )
  }
  if (!items.length) return null
  return (
    <div className="mt-3">
      <div className="text-[8pt] font-semibold uppercase tracking-wide" style={faint}>What the record shows</div>
      <ul className="mt-1 list-disc space-y-1 pl-4 text-[9.5pt] leading-snug">
        {items.map((it, i) => <li key={i}>{it}</li>)}
      </ul>
    </div>
  )
}

// --- Medication history timeline ------------------------------------------------

function HistoryChart({ lanes, observations, now }: { lanes: TimelineLane[]; observations: RatedObservation[]; now: Date }) {
  const nowMs = now.getTime()
  const from = Math.min(...lanes.map((l) => l.first))
  const to = Math.max(nowMs, ...lanes.map((l) => l.last)) + 14 * DAY
  const pos = (t: number) => ((t - from) / (to - from)) * 100
  const ticks = axisTicks(from, to)
  const weeks = weeklyObservationCounts(observations, from, to)
  const weekMax = Math.max(1, ...weeks.map((w) => w.avg))

  return (
    <section className="report-section report-break-avoid mt-7">
      <SectionTitle>Medication history</SectionTitle>
      <p className="mt-1 text-[8.5pt]" style={faint}>
        Each bar is one dose period; darker is a higher dose of that medication. ↑ ↓ dose change · ↻ restart ·
        ◆ single day. The bottom row is each week&apos;s average day (each day rated by its worst observation).
      </p>
      <div className="mt-2 flex text-[8pt]">
        <div className="w-[1.3in] shrink-0 pr-2">
          <div style={{ height: 14 }} />
          {lanes.map((l) => (
            <div key={l.key} className="flex items-center truncate font-medium" style={{ height: LANE }}>{l.name}</div>
          ))}
          {observations.length > 0 && <div className="flex items-center" style={{ height: 22, ...faint }}>Observations</div>}
        </div>

        <div className="relative min-w-0 flex-1">
          {ticks.map((t) => (
            <div key={t.at}>
              <div className="absolute bottom-0 w-px" data-print-color="" style={{ left: `${pos(t.at)}%`, top: 14, background: t.major ? "var(--rule-strong)" : "var(--rule)" }} />
              <div className="absolute top-0 -translate-x-1/2 text-[7.5pt]" style={{ left: `${pos(t.at)}%`, color: t.major ? "var(--ink)" : "var(--ink-faint)" }}>{t.label}</div>
            </div>
          ))}
          <div className="absolute bottom-0 w-px" data-print-color="" style={{ left: `${pos(nowMs)}%`, top: 10, background: "var(--ink-soft)" }} />

          <div style={{ height: 14 }} />
          {lanes.map((l) => (
            <div key={l.key} className="relative border-b" style={{ height: LANE, borderColor: "var(--rule)" }} data-print-color="">
              {l.segments.map((s) => {
                if (s.point) {
                  return (
                    <span key={s.med.id} className="absolute top-1/2 block h-[7px] w-[7px] -translate-x-1/2 -translate-y-1/2 rotate-45" data-print-color=""
                      style={{ left: `${pos(s.start)}%`, background: s.intensity == null ? "var(--ink-faint)" : doseFill(s.intensity) }} />
                  )
                }
                const width = pos(s.end) - pos(s.start)
                const text = s.med.dosage?.replace(/\s*\(.*\)\s*/, "").trim() ?? ""
                const mark = s.change === "up" ? "↑ " : s.change === "down" ? "↓ " : s.change === "restart" ? "↻ " : ""
                const fits = text && (width / 100) * PLOT_PX >= (mark.length + text.length) * 5 + 8
                return (
                  <span key={s.med.id}
                    className="absolute top-1/2 flex -translate-y-1/2 items-center overflow-hidden whitespace-nowrap rounded-[3px] px-1 text-[7pt] leading-none"
                    data-print-color=""
                    style={{
                      left: `calc(${pos(s.start)}% + 0.5px)`, width: `max(2px, calc(${width}% - 1px))`, height: 12,
                      background: doseFill(s.intensity), color: s.intensity != null && s.intensity >= 0.55 ? "white" : "var(--ink)",
                    }}>
                    {fits ? `${mark}${text}` : ""}
                  </span>
                )
              })}
            </div>
          ))}
          {observations.length > 0 && (
            <div className="relative" style={{ height: 22 }}>
              {weeks.map((w) => w.avg > 0 ? (
                <span key={w.start} className="absolute bottom-[3px]" data-print-color=""
                  style={{ left: `${pos(w.start)}%`, width: `max(1px, calc(${pos(w.start + 7 * DAY) - pos(w.start)}% - 0.5px))`, height: Math.max(2, (w.avg / weekMax) * 16), background: "var(--ink-faint)" }} />
              ) : null)}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

// --- Before and after (dumbbell) ------------------------------------------------

function EffectsChart({ effects, day }: { effects: MedicationEffect[]; day: (t: number) => string }) {
  const rows = effects
    .filter((e) => e.status === "ok")
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || b.at - a.at)
    .slice(0, 10)
  const max = niceMax(Math.max(1, ...rows.flatMap((e) => [e.before.avg, e.after.avg])))
  const ticks = [0, max / 2, max]
  const cols = "grid-cols-[1.9in_1fr_1.15in]"

  return (
    <section className="report-section report-break-avoid mt-7">
      <SectionTitle>Before and after each medication change</SectionTitle>
      <p className="mt-1 text-[8.5pt]" style={faint}>
        The average day (0 quiet to 5 severe, each day rated by its worst observation), 4 weeks before each change (○)
        and 4 weeks after (●); largest differences first. Other changes in the same weeks share any credit.
      </p>
      {rows.length === 0 ? (
        <p className="mt-3 text-[9.5pt] italic" style={faint}>No change has four weeks of observations on both sides yet.</p>
      ) : (
        <div className="mt-2 text-[8.5pt]">
          <div className={`grid ${cols} gap-3 border-b pb-1 text-[7.5pt] font-semibold uppercase tracking-wide`} style={{ borderColor: "var(--rule-strong)", ...faint }} data-print-color="">
            <div>Change</div>
            <div className="relative">
              {ticks.map((t) => (
                <span key={t} className="absolute -translate-x-1/2 tabular-nums" style={{ left: `${(t / max) * 100}%` }}>{Number.isInteger(t) ? t : t.toFixed(1)}</span>
              ))}
              &nbsp;
            </div>
            <div className="text-right">Average day</div>
          </div>
          {rows.map((e) => {
            const a = (e.before.avg / max) * 100
            const b = (e.after.avg / max) * 100
            const more = e.delta >= STEADY_DELTA
            const fewer = e.delta <= -STEADY_DELTA
            const others = [...new Set(e.nearby.map((n) => n.name))]
            return (
              <div key={`${e.medId}-${e.kind}-${e.at}`} className={`grid ${cols} items-center gap-3 border-b py-1.5`} style={{ borderColor: "var(--rule)" }} data-print-color="">
                <div className="min-w-0 leading-tight">
                  <div className="truncate"><strong>{e.name}</strong> {e.label}</div>
                  <div className="truncate text-[7.5pt]" style={faint}>{day(e.at)}{others.length ? ` · also: ${others.join(", ")}` : ""}</div>
                </div>
                <div className="relative h-4" aria-hidden="true">
                  {ticks.map((t) => (
                    <div key={t} className="absolute inset-y-0 w-px" data-print-color="" style={{ left: `${(t / max) * 100}%`, background: "var(--rule)" }} />
                  ))}
                  <div className="absolute top-1/2 h-[2px] -translate-y-1/2" data-print-color="" style={{ left: `${Math.min(a, b)}%`, width: `${Math.abs(b - a)}%`, background: "var(--ink-soft)" }} />
                  <span className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 bg-white" data-print-color="" style={{ left: `${a}%`, borderColor: "var(--ink-soft)" }} />
                  <span className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full" data-print-color="" style={{ left: `${b}%`, background: "var(--ink)" }} />
                </div>
                <div className="text-right leading-tight tabular-nums">
                  <div>{e.before.avg} → <strong>{e.after.avg}</strong></div>
                  <div className="text-[7.5pt]" style={faint}>
                    {more ? <strong style={{ color: "var(--ink)" }}>↑ {e.delta} higher</strong> : fewer ? <strong style={{ color: "var(--ink)" }}>↓ {Math.abs(e.delta)} lower</strong> : "about the same"}
                    {" · "}severe {e.before.severe} → {e.after.severe}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

// --- Twelve months of observations (calendar heatmap) ----------------------------

/// The calendar on its own, for the summary to place above the observation
/// list (and leave out with it): it marks the person's medication changes.
export function ObservationCalendarSection({ observations, medications, now, fmt }: {
  observations: { date: Date; type: string; severity?: number | null }[]
  medications: TimelineMedication[]
  now: Date
  fmt: Formatter
}) {
  if (!observations.length) return null
  return <ObservationYear observations={observations} events={medicationEvents(buildTimeline(medications, now))} now={now} fmt={fmt} />
}

function ObservationYear({ observations, events, now, fmt }: {
  observations: { date: Date; type: string; severity?: number | null }[]
  events: MedicationEvent[]
  now: Date
  fmt: Formatter
}) {
  const to = utcDay(now)
  const start = new Date(to)
  start.setUTCFullYear(start.getUTCFullYear() - 1)
  const from = start.getTime() + DAY
  const cal = observationCalendar(observations, from, to)
  const marks = new Set<number>()
  for (const e of events) {
    const w = cal.weeks.findIndex((wk) => e.at >= wk.start && e.at < wk.start + 7 * DAY)
    if (w >= 0) marks.add(w)
  }
  const columns = `0.35in repeat(${cal.weeks.length}, minmax(0, 1fr))`
  const months = cal.months.filter((m, i, all) => !(all[i + 1] && all[i + 1].week - m.week < 3))

  return (
    <section className="report-section report-break-avoid mt-7">
      <SectionTitle>Observations, last 12 months</SectionTitle>
      <p className="mt-1 text-[8.5pt]" style={faint}>
        One square per day, shaded by its most severe entry ({cal.total} entries in this period). ◆ marks a week with a medication change.
      </p>
      <div className="mt-2 text-[7pt]" style={faint}>
        <div className="grid gap-[2px]" style={{ gridTemplateColumns: columns }}>
          <div />
          {cal.weeks.map((_, w) => (
            <div key={w} className="flex h-3 items-center justify-center">
              {marks.has(w) && <span className="block h-[6px] w-[6px] rotate-45" data-print-color="" style={{ background: "var(--ink)" }} />}
            </div>
          ))}
        </div>
        <div className="grid h-3 gap-[2px]" style={{ gridTemplateColumns: columns }}>
          <div />
          {cal.weeks.map((_, w) => {
            const m = months.find((x) => x.week === w)
            return <div key={w} className="relative">{m && <span className="absolute left-0 whitespace-nowrap">{m.label}</span>}</div>
          })}
        </div>
        <div className="mt-0.5 grid gap-[2px]" style={{ gridTemplateColumns: columns }}>
          <div className="grid grid-rows-7 gap-[2px]">
            {["Mon", "", "Wed", "", "Fri", "", ""].map((d, i) => <div key={i} className="flex items-center leading-none">{d}</div>)}
          </div>
          {cal.weeks.map((wk) => (
            <div key={wk.start} className="grid grid-rows-7 gap-[2px]">
              {wk.days.map((d, i) => d ? (
                <div key={i} className="aspect-square rounded-[1.5px]" data-print-color="" style={{ background: HEAT[calendarLevel(d.rating)] }} />
              ) : <div key={i} className="aspect-square" />)}
            </div>
          ))}
        </div>
        <div className="mt-1.5 flex items-center justify-end gap-1">
          Quiet {HEAT.map((h, i) => <span key={i} className="h-2 w-2 rounded-[1.5px]" data-print-color="" style={{ background: h }} />)} Severe
          <span className="ml-3">Generated {fmt.date(now, { utc: true })}</span>
        </div>
      </div>
    </section>
  )
}
