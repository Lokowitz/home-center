// The facts the printed medical summary leads its medication review with.
// Pure and client-safe. Every line is a count or a date read straight off the
// record — nothing here judges a medication — so the report can state them
// plainly and leave interpretation to the reader and their clinician.

import type { TimelineLane } from "./medication-timeline"
import { dailyRatings, ratingSummary, type RatedObservation } from "./day-ratings"
import { STEADY_DELTA, type MedicationEffect, type MedicationEvent } from "./medication-effects"

const DAY = 86_400_000
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/// A month counts as regularly logged from four entries up. "Regular since"
/// is the start of the unbroken run of such months leading up to the last
/// full month — one busy month years ago (a week of illness notes) is not a
/// habit, and comparisons before the run rest on very little.
const REGULAR_MONTH = 4

export type MedicationInsights = {
  current: { name: string; dosage: string | null; since: number }[]
  /// Distinct drugs ever taken for more than a day.
  tried: number
  /// Starts, dose changes, restarts and stops in the last 365 days.
  changesLastYear: number
  /// The most recent change among what is taken now, if anything is.
  lastChangeAt: number | null
  observations: {
    total: number
    last90: number
    prior90: number
    perWeek90: number
    /// The last 90 days by day rating (see day-ratings): average day and severe days.
    avgDay90: number
    severeDays90: number
    busiestMonth: { label: string; count: number } | null
    /// Types logged at least twice in the last 90 days, most first.
    topTypes90: { type: string; count: number }[]
    /// Start of the current run of regularly logged months (UTC ms of its 1st), if any.
    regularFrom: number | null
  }
  biggestRise: MedicationEffect | null
  biggestDrop: MedicationEffect | null
}

export function medicationInsights(
  lanes: TimelineLane[],
  events: MedicationEvent[],
  effects: MedicationEffect[],
  observations: (RatedObservation & { type: string })[],
  now: Date
): MedicationInsights {
  const nowMs = now.getTime()
  const current = lanes
    .filter((l) => l.active && l.current)
    .map((l) => ({ name: l.name, dosage: l.current!.med.dosage, since: l.current!.start }))
    .sort((a, b) => b.since - a.since)

  const times = observations.map((o) => ({ t: new Date(o.date).getTime(), type: o.type.trim() }))
  const inRange = (from: number, to: number) => times.filter((o) => o.t >= from && o.t < to)
  const last90 = inRange(nowMs - 90 * DAY, nowMs + DAY)
  const prior90 = inRange(nowMs - 180 * DAY, nowMs - 90 * DAY)

  // The 90 whole days ending today.
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const days90 = ratingSummary(dailyRatings(observations), today - 89 * DAY, today + DAY)

  const byMonth = new Map<string, number>()
  for (const o of times) {
    const d = new Date(o.t)
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth()).padStart(2, "0")}`
    byMonth.set(key, (byMonth.get(key) ?? 0) + 1)
  }
  const months = [...byMonth].sort(([a], [b]) => a.localeCompare(b))
  const busiest = months.reduce<[string, number] | null>((best, m) => (!best || m[1] > best[1] ? m : best), null)
  const monthLabel = (key: string) => {
    const [y, m] = key.split("-").map(Number)
    return `${MONTHS[m]} ${y}`
  }
  // Walk back from the last full month while each month is regularly logged.
  let y = now.getUTCFullYear()
  let m = now.getUTCMonth() - 1
  let regularFrom: number | null = null
  for (;;) {
    if (m < 0) { m = 11; y-- }
    if ((byMonth.get(`${y}-${String(m).padStart(2, "0")}`) ?? 0) < REGULAR_MONTH) break
    regularFrom = Date.UTC(y, m, 1)
    m--
  }

  const typeCounts = new Map<string, number>()
  for (const o of last90) if (o.type) typeCounts.set(o.type, (typeCounts.get(o.type) ?? 0) + 1)
  const topTypes90 = [...typeCounts]
    .filter(([, n]) => n >= 2)
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type))
    .slice(0, 5)

  const readable = effects.filter((e) => e.status === "ok")
  const rise = readable.filter((e) => e.delta >= STEADY_DELTA).sort((a, b) => b.delta - a.delta)[0] ?? null
  const drop = readable.filter((e) => e.delta <= -STEADY_DELTA).sort((a, b) => a.delta - b.delta)[0] ?? null

  return {
    current,
    tried: lanes.filter((l) => l.segments.some((s) => !s.point)).length,
    changesLastYear: events.filter((e) => e.at > nowMs - 365 * DAY && e.at <= nowMs).length,
    lastChangeAt: current.length ? current[0].since : null,
    observations: {
      total: times.length,
      last90: last90.length,
      prior90: prior90.length,
      perWeek90: Math.round((last90.length / 90) * 70) / 10,
      avgDay90: days90.avg,
      severeDays90: days90.severe,
      busiestMonth: busiest ? { label: monthLabel(busiest[0]), count: busiest[1] } : null,
      topTypes90,
      regularFrom,
    },
    biggestRise: rise,
    biggestDrop: drop,
  }
}
