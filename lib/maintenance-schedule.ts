// What kind of reminder a maintenance schedule is, and the calendar rules for
// the ones that repeat on set months. Pure: no database, no formatting locale.

export type StuckCheck = {
  intervalDays: number | null
  intervalMiles: number | null
  lastCompletedDate: Date | null
  nextDueDate: Date | null
  lastCompletedMileage: number | null
  nextDueMileage: number | null
}

/// A one-time reminder (no interval) that was completed before the due value
/// was cleared on completion, so it still shows as overdue. Mirrors the data
/// step in the maintenance_cost_and_calendar migration.
export function isStuckOneTime(s: StuckCheck): { clearDate: boolean; clearMileage: boolean } {
  if (s.intervalDays || s.intervalMiles) return { clearDate: false, clearMileage: false }
  return {
    clearDate: s.lastCompletedDate != null && s.nextDueDate != null && s.lastCompletedDate.getTime() >= s.nextDueDate.getTime(),
    clearMileage: s.lastCompletedMileage != null && s.nextDueMileage != null && s.lastCompletedMileage >= s.nextDueMileage,
  }
}

export type ScheduleKind = "interval" | "calendar" | "once"

export type RepeatFields = {
  intervalDays: number | null
  intervalMiles: number | null
  dueMonths?: string | null
  dueDay?: number | null
}

/// Calendar wins when months are set; otherwise an interval makes it repeat;
/// with neither it happens once.
export function scheduleKind(s: RepeatFields): ScheduleKind {
  if (parseDueMonths(s.dueMonths).length > 0) return "calendar"
  return s.intervalDays || s.intervalMiles ? "interval" : "once"
}

/// Sorted, unique months 1–12 from a stored "4,10" string; bad tokens are dropped.
export function parseDueMonths(raw: string | null | undefined): number[] {
  if (!raw) return []
  const months = raw.split(",").map((t) => Number(t.trim())).filter((n) => Number.isInteger(n) && n >= 1 && n <= 12)
  return [...new Set(months)].sort((a, b) => a - b)
}

export function formatDueMonths(months: number[]): string | null {
  const clean = parseDueMonths(months.join(","))
  return clean.length ? clean.join(",") : null
}

const noon = (year: number, month: number, day: number) => new Date(Date.UTC(year, month - 1, day, 12))
const dayKey = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())

function calendarDue(months: number[], day: number, from: Date, strictlyAfter: boolean): Date {
  const start = dayKey(from)
  const startYear = from.getUTCFullYear()
  for (let year = startYear; year <= startYear + 1; year++) {
    for (const month of months) {
      const candidate = noon(year, month, day)
      if (strictlyAfter ? dayKey(candidate) > start : dayKey(candidate) >= start) return candidate
    }
  }
  return noon(startYear + 1, months[0] ?? 1, day)
}

/// The first listed month/day, at 12:00 UTC, on a later UTC calendar day than `after`.
export function nextCalendarDue(months: number[], day: number, after: Date): Date {
  return calendarDue(months, day, after, true)
}

/// The first listed month/day, at 12:00 UTC, on or after `today`'s UTC calendar day.
export function firstCalendarDue(months: number[], day: number, today: Date): Date {
  return calendarDue(months, day, today, false)
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/// "Every 90 days", "Every 5,000 mi", "Apr, Oct" or "Once".
export function repeatsLabel(s: RepeatFields, meterShort: string): string {
  const kind = scheduleKind(s)
  if (kind === "calendar") {
    const day = s.dueDay && s.dueDay > 1 ? ` ${s.dueDay}` : ""
    return parseDueMonths(s.dueMonths).map((m) => `${MONTH_NAMES[m - 1]}${day}`).join(", ")
  }
  if (kind === "once") return "Once"
  const parts = []
  if (s.intervalDays) parts.push(`${s.intervalDays} days`)
  if (s.intervalMiles) parts.push(`${s.intervalMiles.toLocaleString("en-US")} ${meterShort}`)
  return `Every ${parts.join(" or ")}`
}

type Repeats = { intervalDays: number | null; intervalMiles: number | null; dueMonths: string | null; dueDay: number | null }

/// What gets saved for a reminder's repeat settings. Months and an interval
/// can't both be set, and the day only means something with months.
export function normalizeRepeats(v: {
  intervalDays: number | null
  intervalMiles: number | null
  dueMonths: number[]
  dueDay: number | null
}): { ok: true; value: Repeats } | { ok: false; error: string } {
  const dueMonths = formatDueMonths(v.dueMonths)
  if (dueMonths && (v.intervalDays || v.intervalMiles)) {
    return { ok: false, error: "A reminder on set months can't also repeat every so many days or miles." }
  }
  return {
    ok: true,
    value: { intervalDays: v.intervalDays, intervalMiles: v.intervalMiles, dueMonths, dueDay: dueMonths ? v.dueDay ?? 1 : null },
  }
}

/// A one-time reminder that has been completed: nothing is due any more.
export function isDoneOnce(s: RepeatFields & { nextDueDate: Date | null; nextDueMileage: number | null; lastCompletedDate: Date | null }): boolean {
  return scheduleKind(s) === "once" && !s.nextDueDate && s.nextDueMileage == null && s.lastCompletedDate != null
}

/// "On set months" chosen with no month picked: it would save as a one-time reminder.
export function monthsMissing(repeat: string, dueMonths: string | null | undefined): boolean {
  return repeat === "months" && parseDueMonths(dueMonths).length === 0
}

/// A typed due date stays when it falls in a listed month. Otherwise (a reminder
/// just switched to set months, still carrying its old date) it moves to the next
/// listed month.
export function alignCalendarDue(months: number[], day: number, typed: Date): Date {
  return months.includes(typed.getUTCMonth() + 1) ? typed : firstCalendarDue(months, day, typed)
}
