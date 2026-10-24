import type { FieldOption } from "@/lib/form-types"

// Pure, client-safe health helpers. Dates are stored as UTC midnight (that is
// what `new Date("YYYY-MM-DD")` produces), so calendar maths here reads UTC
// fields to stay on the day the user typed.

const DAY = 86_400_000

export const HEALTH_WINDOWS = { refillDays: 7, immunizationDays: 30, insuranceDays: 60 } as const

export const RELATIONSHIPS: FieldOption[] = [
  { value: "SELF", label: "Self" },
  { value: "SPOUSE", label: "Spouse" },
  { value: "CHILD", label: "Child" },
  { value: "PARENT", label: "Parent" },
  { value: "PET", label: "Pet" },
  { value: "OTHER", label: "Other" },
]

export const CONDITION_STATUSES: FieldOption[] = [
  { value: "ACTIVE", label: "Active" },
  { value: "MANAGED", label: "Managed" },
  { value: "RESOLVED", label: "Resolved" },
]

export const ALLERGY_SEVERITIES: FieldOption[] = [
  { value: "MILD", label: "Mild" },
  { value: "MODERATE", label: "Moderate" },
  { value: "SEVERE", label: "Severe" },
]

export { INSURANCE_KINDS } from "@/lib/insurance"

export function labelFor(options: FieldOption[], value: string): string {
  return options.find((o) => o.value === value)?.label ?? value
}

export function toDateInput(d: Date | null | undefined): string {
  return d ? new Date(d).toISOString().split("T")[0] : ""
}

export function ageFrom(dob: Date, now: Date): number {
  let age = now.getUTCFullYear() - dob.getUTCFullYear()
  const m = now.getUTCMonth() - dob.getUTCMonth()
  if (m < 0 || (m === 0 && now.getUTCDate() < dob.getUTCDate())) age--
  return age
}

/// Whole days from now until `date`, rounded up. `|| 0` folds Math.ceil's -0
/// (something due a few hours ago) into 0 so it reads "today", not "overdue".
export function daysUntil(date: Date, now: Date): number {
  return Math.ceil((new Date(date).getTime() - now.getTime()) / DAY) || 0
}

/// A medication is taken through the whole of its end date.
export function isMedicationActive(m: { endDate: Date | null }, now: Date): boolean {
  return !m.endDate || new Date(m.endDate).getTime() + DAY > now.getTime()
}

export function refillDue(
  m: { endDate: Date | null; nextRefillDate: Date | null },
  now: Date,
  windowDays: number = HEALTH_WINDOWS.refillDays
): boolean {
  return isMedicationActive(m, now) && !!m.nextRefillDate && daysUntil(m.nextRefillDate, now) <= windowDays
}

export function immunizationDue(
  i: { nextDueDate: Date | null },
  now: Date,
  windowDays: number = HEALTH_WINDOWS.immunizationDays
): boolean {
  return !!i.nextDueDate && daysUntil(i.nextDueDate, now) <= windowDays
}

/// A dose is superseded once the same person has a later dose of the same
/// vaccine (matched case-insensitively, trimmed): the older row is history, not
/// something to nag about.
export function isSupersededImmunization<T extends { personId: string; vaccine: string; dateGiven: Date }>(
  i: T,
  all: T[]
): boolean {
  const vaccine = i.vaccine.trim().toLowerCase()
  const given = new Date(i.dateGiven).getTime()
  return all.some(
    (o) =>
      o.personId === i.personId &&
      o.vaccine.trim().toLowerCase() === vaccine &&
      new Date(o.dateGiven).getTime() > given
  )
}

export function insuranceExpiring(
  p: { endDate: Date | null },
  now: Date,
  windowDays: number = HEALTH_WINDOWS.insuranceDays
): boolean {
  if (!p.endDate) return false
  const d = daysUntil(p.endDate, now)
  return d >= 0 && d <= windowDays
}

export function nextRefillFrom(from: Date, intervalDays: number): Date {
  return new Date(from.getTime() + intervalDays * DAY)
}
