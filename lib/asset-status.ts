// What an asset's side panel says about the future rather than the past: when the
// next reminder falls due, how much warranty is left, what ownership costs a year.
// Pure, so the thresholds and wording can be tested without a database.

const DAY_MS = 86_400_000

export type Tone = "ok" | "soon" | "late"

export type StatusMeter = {
  label: string
  valueLabel: string
  note?: string
  tone: Tone
  /// How full the bar is, 0..1. Null when there is nothing to measure against, so
  /// the panel shows the figure alone instead of a bar with an invented scale.
  fraction: number | null
}

const clamp01 = (n: number) => Math.min(Math.max(n, 0), 1)
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`

/** Whole days from `from` to `to`, rounded up, so a due date later today is 0 and tomorrow is 1. */
function daysUntil(to: Date, from: Date) {
  return Math.ceil((to.getTime() - from.getTime()) / DAY_MS)
}

export type ScheduleInput = {
  title: string
  nextDueDate: Date | null
  lastCompletedDate: Date | null
  createdAt: Date
  reminderDaysBefore: number
}

/**
 * The reminder that falls due first. The bar is the time elapsed since it was
 * last done (or set up) out of the whole gap, so a full bar means it is due.
 * Reminders that only go by mileage have no date to measure and are skipped.
 */
export function nextDueMeter(schedules: ScheduleInput[], now: Date): StatusMeter | null {
  const dated = schedules.filter((s): s is ScheduleInput & { nextDueDate: Date } => s.nextDueDate !== null)
  if (dated.length === 0) return null
  const next = dated.reduce((a, b) => (b.nextDueDate < a.nextDueDate ? b : a))

  const days = daysUntil(next.nextDueDate, now)
  const start = next.lastCompletedDate ?? next.createdAt
  const total = Math.max(next.nextDueDate.getTime() - start.getTime(), DAY_MS)
  const elapsed = now.getTime() - start.getTime()

  return {
    label: `Next: ${next.title}`,
    valueLabel: days < 0 ? `${plural(-days, "day")} overdue` : days === 0 ? "Due today" : `in ${plural(days, "day")}`,
    tone: days < 0 ? "late" : days <= next.reminderDaysBefore ? "soon" : "ok",
    fraction: clamp01(elapsed / total),
  }
}

export type WarrantyInput = {
  productName: string
  purchaseDate: Date | null
  expirationDate: Date | null
}

/** Days of warranty left at which the bar turns amber, and red. */
const WARRANTY_SOON_DAYS = 90
const WARRANTY_LATE_DAYS = 30

/**
 * The warranty that runs out first. The bar is the share of the term still left,
 * so it shrinks; without a start date there is no term to measure, so it is just
 * the figure.
 */
export function warrantyMeter(warranties: WarrantyInput[], now: Date): StatusMeter | null {
  const active = warranties.filter((w): w is WarrantyInput & { expirationDate: Date } => w.expirationDate !== null && w.expirationDate > now)
  if (active.length === 0) return null
  const w = active.reduce((a, b) => (b.expirationDate < a.expirationDate ? b : a))

  const left = daysUntil(w.expirationDate, now)
  const term = w.purchaseDate ? w.expirationDate.getTime() - w.purchaseDate.getTime() : 0

  return {
    label: `Warranty: ${w.productName}`,
    valueLabel: `${plural(left, "day")} left`,
    tone: left <= WARRANTY_LATE_DAYS ? "late" : left <= WARRANTY_SOON_DAYS ? "soon" : "ok",
    fraction: term > 0 ? clamp01((w.expirationDate.getTime() - now.getTime()) / term) : null,
  }
}

/// Under this long, dividing by the time owned turns a single bill into a huge yearly figure.
const MIN_YEARS_OWNED = 0.25

/** Everything spent on it (purchase included) per year since it was bought; null until it has been owned long enough to mean anything. */
export function costPerYearOwned(totalCost: number, ownedSince: Date | null, now: Date): number | null {
  if (!ownedSince) return null
  const years = (now.getTime() - ownedSince.getTime()) / (365.25 * DAY_MS)
  return years >= MIN_YEARS_OWNED ? totalCost / years : null
}
