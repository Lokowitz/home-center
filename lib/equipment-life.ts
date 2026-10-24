// How old equipment is against how long it should last, and the reminder the
// "Plan replacement" button starts. Pure; every date is a UTC calendar day.

export type LifeFields = { installDate: Date | null; purchaseDate: Date | null; expectedLifeYears: number | null }

const dayKey = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())

/// Age counts from the install date, else the purchase date.
export function lifeStart(e: Pick<LifeFields, "installDate" | "purchaseDate">): Date | null {
  return e.installDate ?? e.purchaseDate
}

/// The same month and day `years` later, at 12:00 UTC. Feb 29 becomes Feb 28 in a year without one.
export function addYearsUTC(d: Date, years: number): Date {
  const year = d.getUTCFullYear() + years
  const month = d.getUTCMonth()
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  return new Date(Date.UTC(year, month, Math.min(d.getUTCDate(), lastDay), 12))
}

export function equipmentAge(e: LifeFields, today: Date): { years: number; lifeYears: number; pastLife: boolean } | null {
  const start = lifeStart(e)
  if (!start || !e.expectedLifeYears) return null
  let years = today.getUTCFullYear() - start.getUTCFullYear()
  if (dayKey(addYearsUTC(start, years)) > dayKey(today)) years--
  years = Math.max(0, years)
  return { years, lifeYears: e.expectedLifeYears, pastLife: years >= e.expectedLifeYears }
}

export function ageLabel(a: { years: number; lifeYears: number }): string {
  return `${a.years} of ${a.lifeYears} ${a.lifeYears === 1 ? "year" : "years"}`
}

/// Due when the life ends; a year from today when that has passed or can't be worked out.
export function replacementPlan(
  e: LifeFields & { name: string; replacementCost: number | null },
  today: Date
): { title: string; dueDate: Date; estimatedCost: number | null } {
  const start = lifeStart(e)
  const ends = start && e.expectedLifeYears ? addYearsUTC(start, e.expectedLifeYears) : null
  return {
    title: `Replace ${e.name}`,
    dueDate: ends && dayKey(ends) >= dayKey(today) ? ends : addYearsUTC(today, 1),
    estimatedCost: e.replacementCost,
  }
}

/// The viewer's own calendar day as 12:00 UTC, so "today" matches the clock on their wall, not the UTC day.
export function localDay(now: Date): Date {
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), 12))
}
