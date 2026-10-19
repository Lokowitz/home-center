import { Fragment } from "react"
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
import { dailyRatings } from "@/lib/day-ratings"
import { rangeLabel, type HistoryRange, type MedNotes, type ObsView } from "@/lib/report-options"

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
// Weeks per heatmap row: a year, so a year-long range fills it exactly.
const ROW_WEEKS = 53

const doseFill = (intensity: number | null) =>
  intensity == null ? "#e4e6ea" : `color-mix(in oklch, var(--accent) ${Math.round(35 + 65 * intensity)}%, white)`
// Quiet, then mild (1) to severe (5): one hue, light to dark.
const HEAT = ["#eef0f4", ...[28, 46, 64, 82].map((m) => `color-mix(in oklch, var(--accent) ${m}%, white)`), "var(--accent)"]

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
const monthYear = (t: number) => `${MONTH_NAMES[new Date(t).getUTCMonth()]} ${new Date(t).getUTCFullYear()}`

const faint = { color: "var(--ink-faint)" } as const
const soft = { color: "var(--ink-soft)" } as const

export function MedicationReview({
  medications, observations, now, fmt, show, historyRange,
}: {
  historyRange: HistoryRange
  show: { review: boolean; history: boolean; list: boolean; listNotes: MedNotes; changes: boolean }
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

  if (!show.review && !show.history && !show.list && !show.changes) return null

  return (
    <>
      {show.review && (
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
        </div>
      )}

      {show.history && <HistoryChart lanes={lanes} observations={observations} now={now} range={historyRange} />}

      {show.list && <HistoryList lanes={historyWindow(lanes, historyRange, now).lanes} range={historyRange} notes={show.listNotes} fmt={fmt} />}

      {show.changes && observations.length > 0 && <EffectsChart effects={effects} day={day} />}
    </>
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

/// The medication periods that touch the history range, shared by the chart
/// and the list so one setting governs both. `from` is the window's start.
function historyWindow(allLanes: TimelineLane[], range: HistoryRange, now: Date) {
  const to = Math.max(now.getTime(), ...allLanes.map((l) => l.last)) + 14 * DAY
  const from = range === "all" ? Math.min(...allLanes.map((l) => l.first)) : utcDay(now) - (Number(range) - 1) * DAY
  const lanes = allLanes
    .map((l) => ({ ...l, segments: l.segments.filter((s) => s.end > from && s.start <= to) }))
    .filter((l) => l.segments.length > 0)
  return { lanes, from, to }
}

function HistoryChart({ lanes: allLanes, observations, now, range }: { lanes: TimelineLane[]; observations: RatedObservation[]; now: Date; range: HistoryRange }) {
  const nowMs = now.getTime()
  const win = historyWindow(allLanes, range, now)
  const { from, to } = win
  // A bar that began before the window is clipped to its edge.
  const lanes = win.lanes.map((l) => ({ ...l, segments: l.segments.map((s) => ({ ...s, start: Math.max(s.start, from) })) }))
  const pos = (t: number) => ((t - from) / (to - from)) * 100
  const ticks = axisTicks(from, to)
  const weeks = weeklyObservationCounts(observations, from, to)
  const weekMax = Math.max(1, ...weeks.map((w) => w.avg))

  return (
    <section className="report-section report-break-avoid mt-7">
      <SectionTitle>Medication history{range === "all" ? "" : `, ${rangeLabel(Number(range))}`}</SectionTitle>
      <p className="mt-1 text-[8.5pt]" style={faint}>
        Each bar is one dose period; darker is a higher dose of that medication. ↑ ↓ dose change · ↻ restart ·
        ◆ single day. The bottom row is each week&apos;s average day (each day rated by its worst observation).
      </p>
      {lanes.length === 0 && <p className="mt-3 text-[9.5pt] italic" style={faint}>No medication was taken in this period.</p>}
      {lanes.length > 0 && <div className="mt-2 flex text-[8pt]">
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
                  style={{ left: `${Math.max(0, pos(w.start))}%`, width: `max(1px, calc(${pos(w.start + 7 * DAY) - Math.max(0, pos(w.start))}% - 0.5px))`, height: Math.max(2, (w.avg / weekMax) * 16), background: "var(--ink-faint)" }} />
              ) : null)}
            </div>
          )}
        </div>
      </div>}
    </section>
  )
}

// --- Medication history list ------------------------------------------------------

/// The medication record as a tight table in small type: one block per
/// medication, its dose periods oldest first, with numeric start and end dates.
/// The name is printed once, in the first row, and a heavier rule separates
/// medications. A period still running ends in "now". Notes, when asked for,
/// run on a line under their period.
function HistoryList({ lanes, range, notes, fmt }: { lanes: TimelineLane[]; range: HistoryRange; notes: MedNotes; fmt: Formatter }) {
  const d = (t: number) => fmt.dateNumeric(new Date(t), { utc: true })
  const th = "pb-1 pr-3 text-left text-[7pt] font-semibold uppercase tracking-wide"
  const cell = "py-[1.5px] pr-3 align-top"
  // "last" keeps only the medication's final entry, and only if it has a note.
  const noted = (l: TimelineLane) =>
    notes === "all" ? new Set(l.segments.filter((x) => x.med.notes).map((x) => x.med.id))
    : notes === "last" && l.segments[l.segments.length - 1].med.notes ? new Set([l.segments[l.segments.length - 1].med.id])
    : new Set<string>()

  return (
    <section className="report-section mt-7">
      <SectionTitle>Medication history{range === "all" ? "" : `, ${rangeLabel(Number(range))}`}</SectionTitle>
      {lanes.length === 0 ? (
        <p className="mt-3 text-[9.5pt] italic" style={faint}>No medication was taken in this period.</p>
      ) : (
        <table className="mt-2 w-full border-collapse text-[8pt] leading-tight">
          <thead>
            <tr style={faint}>
              <th className={`${th} w-[1.8in]`}>Medication</th>
              <th className={th}>Dose</th>
              <th className={`${th} w-[0.8in]`}>Started</th>
              <th className={`${th} w-[0.8in] !pr-0`}>Ended</th>
            </tr>
          </thead>
          {lanes.map((l) => {
            const withNote = noted(l)
            return (
            <tbody key={l.key} className="report-break-avoid">
              {l.segments.map((s, i) => (
                <Fragment key={s.med.id}>
                  <tr>
                    {i === 0 && (
                      <td
                        rowSpan={l.segments.length + withNote.size}
                        className={`${cell} border-t font-semibold`}
                        style={{ borderColor: "var(--rule-strong)" }}
                        data-print-color=""
                      >
                        {l.name}
                      </td>
                    )}
                    <td className={`${cell} ${i === 0 ? "border-t" : ""}`} style={{ borderColor: "var(--rule-strong)" }} data-print-color="">
                      {[s.med.dosage, s.med.frequency].filter(Boolean).join(" · ") || "—"}
                    </td>
                    <td className={`${cell} whitespace-nowrap tabular-nums ${i === 0 ? "border-t" : ""}`} style={{ borderColor: "var(--rule-strong)", ...soft }} data-print-color="">{d(s.start)}</td>
                    <td className={`${cell} whitespace-nowrap pr-0 tabular-nums ${i === 0 ? "border-t" : ""}`} style={{ borderColor: "var(--rule-strong)", ...soft }} data-print-color="">
                      {s.ongoing ? "now" : d(s.point ? s.start : s.end - DAY)}
                    </td>
                  </tr>
                  {withNote.has(s.med.id) ? (
                    <tr>
                      <td colSpan={3} className="whitespace-pre-wrap pb-[2px] pr-0 text-[7.5pt]" style={faint}>{s.med.notes}</td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
            </tbody>
            )
          })}
        </table>
      )}
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

/// The chart above the observation list (and left out with it): the heatmap
/// marks the person's medication changes.
export function ObservationChartSection({ observations, medications, days, view, now, fmt }: {
  observations: { date: Date; type: string; severity?: number | null }[]
  medications: TimelineMedication[]
  days: number | "all"
  view: Exclude<ObsView, "none">
  now: Date
  fmt: Formatter
}) {
  if (!observations.length) return null
  const to = utcDay(now)
  const from = days === "all" ? Math.min(...observations.map((o) => utcDay(o.date))) : to - (days - 1) * DAY
  return view === "histogram"
    ? <SeverityHistogram observations={observations} days={days} from={from} to={to} fmt={fmt} />
    : <ObservationYear observations={observations} events={medicationEvents(buildTimeline(medications, now))} days={days} from={from} to={to} now={now} fmt={fmt} />
}

function ObservationYear({ observations, events, days, from, to, now, fmt }: {
  days: number | "all"
  from: number
  to: number
  observations: { date: Date; type: string; severity?: number | null }[]
  events: MedicationEvent[]
  now: Date
  fmt: Formatter
}) {
  const cal = observationCalendar(observations, from, to)
  // Squares are one size whatever the range: a row holds a year of weeks, a
  // shorter range fills part of it, and a longer one wraps onto further rows.
  const rows: (typeof cal.weeks)[] = []
  for (let i = 0; i < cal.weeks.length; i += ROW_WEEKS) rows.push(cal.weeks.slice(i, i + ROW_WEEKS))
  const changeWeeks = new Set<number>()
  for (const e of events) {
    const w = cal.weeks.findIndex((wk) => e.at >= wk.start && e.at < wk.start + 7 * DAY)
    if (w >= 0) changeWeeks.add(w)
  }
  const columns = `0.35in repeat(${ROW_WEEKS}, minmax(0, 1fr))`
  const months = cal.months.filter((m, i, all) => !(all[i + 1] && all[i + 1].week - m.week < 3))

  return (
    <section className="report-section report-break-avoid mt-7">
      <SectionTitle>Observations, {rangeLabel(days)}</SectionTitle>
      <p className="mt-1 text-[8.5pt]" style={faint}>
        One square per day, shaded by its most severe entry ({cal.total} entries in this period). ◆ marks a week with a medication change.
      </p>
      <div className="mt-2 text-[7pt]" style={faint}>
        {rows.map((weeks, r) => {
          const offset = r * ROW_WEEKS
          return (
            <div key={r} className={r > 0 ? "mt-3" : undefined}>
              <div className="grid gap-[2px]" style={{ gridTemplateColumns: columns }}>
                <div />
                {weeks.map((_, w) => (
                  <div key={w} className="flex h-3 items-center justify-center">
                    {changeWeeks.has(offset + w) && <span className="block h-[6px] w-[6px] rotate-45" data-print-color="" style={{ background: "var(--ink)" }} />}
                  </div>
                ))}
              </div>
              <div className="grid h-3 gap-[2px]" style={{ gridTemplateColumns: columns }}>
                <div />
                {weeks.map((_, w) => {
                  const m = months.find((x) => x.week === offset + w)
                  return <div key={w} className="relative">{m && <span className="absolute left-0 whitespace-nowrap">{m.label}</span>}</div>
                })}
              </div>
              <div className="mt-0.5 grid gap-[2px]" style={{ gridTemplateColumns: columns }}>
                <div className="grid grid-rows-7 gap-[2px]">
                  {["Mon", "", "Wed", "", "Fri", "", ""].map((d, i) => <div key={i} className="flex items-center leading-none">{d}</div>)}
                </div>
                {weeks.map((wk) => (
                  <div key={wk.start} className="grid grid-rows-7 gap-[2px]">
                    {wk.days.map((d, i) => d ? (
                      <div key={i} className="aspect-square rounded-[1.5px]" data-print-color="" style={{ background: HEAT[calendarLevel(d.rating)] }} />
                    ) : <div key={i} className="aspect-square" />)}
                  </div>
                ))}
              </div>
            </div>
          )
        })}
        <div className="mt-1.5 flex items-center justify-end gap-1">
          Quiet {HEAT.map((h, i) => <span key={i} className="h-2 w-2 rounded-[1.5px]" data-print-color="" style={{ background: h }} />)} Severe
          <span className="ml-3">Generated {fmt.date(now, { utc: true })}</span>
        </div>
      </div>
    </section>
  )
}

// --- Daily severity histogram ---------------------------------------------------

/// One bar per day, as tall as the day's rating (0 quiet to 5 severe). Height
/// and the printed axis carry the value; the shade only repeats it.
function SeverityHistogram({ observations, days, from, to, fmt }: {
  fmt: Formatter
  observations: { date: Date; severity?: number | null }[]
  days: number | "all"
  from: number
  to: number
}) {
  const ratings = dailyRatings(observations)
  const length = Math.round((to - from) / DAY) + 1
  const bars = Array.from({ length }, (_, i) => ratings.get(from + i * DAY) ?? 0)
  const logged = bars.filter((r) => r > 0).length
  const H = 56
  return (
    <section className="report-section report-break-avoid mt-7">
      <SectionTitle>Daily severity, {rangeLabel(days)}</SectionTitle>
      <p className="mt-1 text-[8.5pt]" style={faint}>
        One bar per day, as tall as its most severe entry (0 quiet to 5 severe); {logged} of {length} days have an entry.
      </p>
      <div className="mt-2 flex text-[7pt]" style={faint}>
        <div className="relative w-5 shrink-0" style={{ height: H }}>
          {[0, 1, 2, 3, 4, 5].map((v) => (
            <span key={v} className="absolute right-1 -translate-y-1/2 leading-none" style={{ top: H - (v / 5) * H }}>{v}</span>
          ))}
        </div>
        <div className="relative flex min-w-0 flex-1 items-end gap-px border-b border-l" style={{ height: H, borderColor: "var(--rule-strong)" }} data-print-color="">
          {[1, 2, 3, 4, 5].map((v) => (
            <div key={v} className="absolute inset-x-0 border-t" style={{ bottom: (v / 5) * H, borderColor: "var(--rule)" }} data-print-color="" />
          ))}
          {bars.map((r, i) => (
            <div key={i} className="relative min-w-0 flex-1" style={{ height: Math.max(1, (r / 5) * H), background: r > 0 ? "var(--accent)" : "var(--rule-strong)" }} data-print-color="" />
          ))}
        </div>
      </div>
      <div className="mt-0.5 flex justify-between pl-5 text-[7pt]" style={faint}>
        <span>{fmt.date(new Date(from), { utc: true })}</span>
        <span>{fmt.date(new Date(to), { utc: true })}</span>
      </div>
    </section>
  )
}
