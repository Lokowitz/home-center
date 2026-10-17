// The year-at-a-glance grid on the Observations tab: one cell per day, weeks
// as columns starting Monday, like a contribution calendar. Pure and
// client-safe; dates are UTC midnight like every other health date.

import { dailyRatings, type RatedObservation } from "./day-ratings"

const DAY = 86_400_000

/// `rating` is the day's worst entry, 0 (nothing logged) to 5 (see day-ratings).
export type CalendarDay = { day: number; count: number; rating: number; titles: string[] }
export type CalendarWeek = { start: number; days: (CalendarDay | null)[] }
export type CalendarMonth = { label: string; week: number }

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

export const utcDay = (d: Date | number) => {
  const t = new Date(d)
  return Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate())
}

/// Weeks covering [from, to] (both UTC days, inclusive). Days outside the
/// range are null so the first and last columns can be partial.
export function observationCalendar(
  observations: (RatedObservation & { type: string })[],
  from: number,
  to: number
): { weeks: CalendarWeek[]; months: CalendarMonth[]; max: number; total: number } {
  const byDay = new Map<number, string[]>()
  for (const o of observations) {
    const d = utcDay(o.date)
    if (d < from || d > to) continue
    byDay.set(d, [...(byDay.get(d) ?? []), o.type])
  }

  const ratings = dailyRatings(observations)

  const first = from - ((new Date(from).getUTCDay() + 6) % 7) * DAY
  const weeks: CalendarWeek[] = []
  const months: CalendarMonth[] = []
  let max = 0
  let total = 0
  for (let start = first; start <= to; start += 7 * DAY) {
    const days: (CalendarDay | null)[] = []
    for (let i = 0; i < 7; i++) {
      const day = start + i * DAY
      if (day < from || day > to) { days.push(null); continue }
      const titles = byDay.get(day) ?? []
      max = Math.max(max, titles.length)
      total += titles.length
      days.push({ day, count: titles.length, rating: ratings.get(day) ?? 0, titles })
      // A month is labelled on the column holding its 1st, and the range's
      // first month on the first column; January and the first label carry the year.
      if (new Date(day).getUTCDate() === 1 || day === from) {
        const m = new Date(day).getUTCMonth()
        const label = m === 0 || months.length === 0 ? `${MONTHS[m]} ${new Date(day).getUTCFullYear()}` : MONTHS[m]
        if (!months.some((x) => x.week === weeks.length)) months.push({ label, week: weeks.length })
      }
    }
    weeks.push({ start, days })
  }
  return { weeks, months, max, total }
}

/// The ranges the calendar offers: the last 12 months, then each calendar year
/// that has an observation in it, newest first.
export function calendarRanges(dates: Date[], now: Date): { value: string; label: string; from: number; to: number }[] {
  const today = utcDay(now)
  const lastYear = new Date(today)
  lastYear.setUTCFullYear(lastYear.getUTCFullYear() - 1)
  const years = [...new Set(dates.map((d) => new Date(d).getUTCFullYear()))].sort((a, b) => b - a)
  return [
    { value: "12m", label: "Last 12 months", from: lastYear.getTime() + DAY, to: today },
    ...years.map((y) => ({ value: String(y), label: String(y), from: Date.UTC(y, 0, 1), to: Math.min(Date.UTC(y, 11, 31), today) })),
  ]
}

/// The six shades a day can take: quiet, then its rating from mild (1) to severe (5).
export const calendarLevel = (rating: number) => Math.min(5, Math.max(0, Math.round(rating)))
