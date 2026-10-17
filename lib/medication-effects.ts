// How the days went before and after each medication change. Pure and
// client-safe. Each day is rated by its worst observation (see day-ratings),
// so the comparison is the average day, not how much was written down. It is
// still not a judgement of the medication: logging habits change too, and
// other changes nearby muddy any single comparison, so both are reported
// alongside the numbers.

import type { TimelineLane } from "./medication-timeline"
import { dailyRatings, ratingSummary } from "./day-ratings"

const DAY = 86_400_000

export type MedicationEventKind = "start" | "up" | "down" | "restart" | "stop"

export type MedicationEvent = {
  /// Lane key (lower-cased drug name) and display name.
  key: string
  name: string
  kind: MedicationEventKind
  /// UTC ms of the day the change took effect.
  at: number
  /// "40 mg → 60 mg", "Started 5 mg", "Stopped".
  label: string
  medId: string
  /// The dose period this change began (or, for a stop, the one it ended):
  /// UTC ms, end exclusive; ongoing when it runs to today.
  period: { start: number; end: number; ongoing: boolean }
  frequency: string | null
  notes: string | null
}

/// Every start, dose change, restart and stop across the lanes, oldest first.
/// A row that continues the previous dose unchanged is not an event, and nor
/// is a one-day item (a single antibiotic dose, a wart treatment): it has no
/// "on it" period to compare against.
export function medicationEvents(lanes: TimelineLane[]): MedicationEvent[] {
  const events: MedicationEvent[] = []
  for (const lane of lanes) {
    lane.segments.forEach((s, i) => {
      if (s.point) return
      const dose = s.med.dosage?.trim() || "dose not recorded"
      const base = {
        key: lane.key, name: lane.name, medId: s.med.id,
        period: { start: s.start, end: s.end, ongoing: s.ongoing },
        frequency: s.med.frequency, notes: s.med.notes,
      }
      if (s.change === "up" || s.change === "down") {
        events.push({ ...base, kind: s.change, at: s.start, label: `${s.previousDosage ?? "?"} → ${dose}` })
      } else if (s.change === "start" || s.change === "restart") {
        events.push({ ...base, kind: s.change, at: s.start, label: `${s.change === "start" ? "Started" : "Restarted"} ${dose}` })
      }
      // A stop is the end of a period nothing picks up within three days.
      const next = lane.segments[i + 1]
      if (!s.ongoing && !s.point && (!next || next.start - s.end > 3 * DAY)) {
        events.push({ ...base, kind: "stop", at: s.end, label: `Stopped ${dose}` })
      }
    })
  }
  return events.sort((a, b) => a.at - b.at || a.name.localeCompare(b.name))
}

export type EffectStatus = "ok" | "no-baseline" | "too-recent"

/// One side of the comparison: the window's dates (UTC ms, end exclusive),
/// how its days rated, what was logged in it, and its most-logged types.
export type EffectWindow = {
  /// Mean day rating, 0 (all quiet) to 5 (all severe), one decimal.
  avg: number
  /// The day ratings added up.
  ratingSum: number
  /// Days with anything logged, and days rated 4 or 5.
  rough: number
  severe: number
  count: number
  perWeek: number
  days: number
  from: number
  to: number
  topTypes: { type: string; count: number }[]
}

export type MedicationEffect = MedicationEvent & {
  before: EffectWindow
  after: EffectWindow
  /// after.avg − before.avg, worked from the unrounded averages; positive
  /// means the days were worse afterwards.
  delta: number
  status: EffectStatus
  /// Other medications that changed inside the same window, which may share
  /// the credit or blame.
  nearby: MedicationEvent[]
}

/// Under this change in the average day either way reads as "about the same":
/// a mild day and a half a week, or one moderate day every two weeks.
export const STEADY_DELTA = 0.2

const rate = (count: number, days: number) => (days > 0 ? Math.round((count / days) * 7 * 10) / 10 : 0)

/// An observation as the comparison reads it: its day, and its type when known
/// (a bare Date is accepted too, for callers that only have dates).
export type EffectObservation = Date | { date: Date; type?: string | null; severity?: number | null }

const TOP_TYPES = 3

/// The average day in the `windowDays` before each event and the
/// `windowDays` after it (fewer if the event is recent). An event whose
/// "before" window starts before logging began has no baseline; one with
/// under two weeks of "after" is too recent to read.
export function medicationEffects(
  events: MedicationEvent[],
  observations: EffectObservation[],
  now: Date,
  windowDays = 28
): MedicationEffect[] {
  const logged = observations
    .map((o) => (o instanceof Date ? { t: o.getTime(), type: null } : { t: new Date(o.date).getTime(), type: o.type?.trim() || null }))
    .sort((a, b) => a.t - b.t)
  const ratings = dailyRatings(observations.map((o) => (o instanceof Date ? { date: o } : o)))
  const trackingStart = logged.length ? logged[0].t : Number.POSITIVE_INFINITY
  const nowMs = now.getTime()
  const span = windowDays * DAY

  const windowOf = (from: number, to: number, days: number): EffectWindow => {
    const inside = logged.filter((o) => o.t >= from && o.t < to)
    const byType = new Map<string, number>()
    for (const o of inside) if (o.type) byType.set(o.type, (byType.get(o.type) ?? 0) + 1)
    const topTypes = [...byType].map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type))
      .slice(0, TOP_TYPES)
    const r = ratingSummary(ratings, from, to)
    return { avg: r.avg, ratingSum: r.sum, rough: r.rough, severe: r.severe, count: inside.length, perWeek: rate(inside.length, days), days, from, to, topTypes }
  }

  return events.map((e) => {
    const afterEnd = Math.min(e.at + span, nowMs)
    const afterDays = Math.max(0, Math.round((afterEnd - e.at) / DAY))
    const before = windowOf(e.at - span, e.at, windowDays)
    const after = windowOf(e.at, afterEnd, afterDays)
    const avgOf = (w: EffectWindow) => (w.days > 0 ? w.ratingSum / w.days : 0)
    const status: EffectStatus =
      e.at - span < trackingStart ? "no-baseline" : afterDays < 14 ? "too-recent" : "ok"
    const nearby = events.filter((o) => o !== e && o.key !== e.key && Math.abs(o.at - e.at) < span)
    return { ...e, before, after, delta: Math.round((avgOf(after) - avgOf(before)) * 10) / 10, status, nearby }
  })
}
