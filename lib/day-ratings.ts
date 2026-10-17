// Each day reduced to one rating: the worst thing logged that day. Pure and
// client-safe. Five mild entries make a mild day and one severe entry makes a
// severe day, so how often someone wrote things down matters less than how
// the day went. A day with nothing logged is a quiet day (0); an entry with
// no severity counts as mild (1) — something happened — and never outranks a
// rated one.

const DAY = 86_400_000

export type RatedObservation = { date: Date; severity?: number | null }

/// UTC day (ms) → its rating, 1 (mild) to 5 (severe). Quiet days are absent.
export type DayRatings = Map<number, number>

/// Days rated 4 or 5.
export const SEVERE_DAY = 4

export const RATING_WORDS = ["Quiet", "Mild", "Mild–moderate", "Moderate", "Moderate–severe", "Severe"] as const

const utcDay = (d: Date | number) => {
  const t = new Date(d)
  return Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate())
}

export const observationRating = (severity: number | null | undefined) =>
  severity == null || !Number.isFinite(severity) ? 1 : Math.min(5, Math.max(1, Math.round(severity)))

export function dailyRatings(observations: RatedObservation[]): DayRatings {
  const ratings: DayRatings = new Map()
  for (const o of observations) {
    const day = utcDay(o.date)
    ratings.set(day, Math.max(ratings.get(day) ?? 0, observationRating(o.severity)))
  }
  return ratings
}

export type RatingSummary = {
  /// Days in the window.
  days: number
  /// Mean day rating across every day in the window, quiet days as 0; one decimal.
  avg: number
  /// The day ratings added up, for averages that should not round twice.
  sum: number
  /// Days with anything logged.
  rough: number
  /// Days rated SEVERE_DAY or worse.
  severe: number
}

/// The days in [from, to) (UTC ms, whole days, end exclusive).
export function ratingSummary(ratings: DayRatings, from: number, to: number): RatingSummary {
  const start = utcDay(from)
  const days = Math.max(0, Math.round((to - start) / DAY))
  let sum = 0
  let rough = 0
  let severe = 0
  for (const [day, r] of ratings) {
    if (day < start || day >= to) continue
    sum += r
    rough++
    if (r >= SEVERE_DAY) severe++
  }
  return { days, avg: days > 0 ? Math.round((sum / days) * 10) / 10 : 0, sum, rough, severe }
}
