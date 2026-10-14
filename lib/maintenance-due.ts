import type { AssetType, MeterUnit } from "@/app/generated/prisma/client"
import type { Formatter } from "@/lib/regional"

// A schedule can come due two ways: by date, or — for vehicles — by odometer.
// The rule used to live only in the asset-detail list, with the mileage warning
// window hardcoded at 500, so the dashboard, the maintenance page and the
// notification checker all reported a truck 300 miles past its oil change as
// "not due". It lives here now, reads reminderMilesBefore, and is the single
// definition all four share.

export type DueInput = {
  assetType: AssetType
  assetId: string
  nextDueDate: Date | null
  nextDueMileage: number | null
  reminderDaysBefore: number
  reminderMilesBefore: number
}

export type Due = {
  overdue: boolean
  dueSoon: boolean
  /** Days until due; negative when past due. Null when the schedule has no date. */
  daysLeft: number | null
  /** Miles (or hours — see meterUnit) until due; negative when past due. Null when it isn't meter-tracked. */
  milesLeft: number | null
  /** Which side of the schedule is driving the status, for wording messages. */
  reason: "date" | "mileage" | null
  /** Set alongside milesLeft — which unit that number is actually counting. */
  meterUnit: MeterUnit | null
}

/**
 * Odometer/hour-meter readings by vehicle id. Only vehicles have one. Built on
 * the server by loadVehicleMileage in lib/maintenance-due-server.ts — this
 * module stays free of Prisma so the asset-detail list can import it from the
 * client.
 */
export type MileageIndex = Map<string, { value: number; unit: MeterUnit }>

export function scheduleDue(s: DueInput, mileage: MileageIndex, now: Date = new Date()): Due {
  const daysLeft = s.nextDueDate
    ? Math.ceil((new Date(s.nextDueDate).getTime() - now.getTime()) / 86400000)
    : null

  // Mileage only means anything for a vehicle whose odometer we actually know.
  const reading = s.assetType === "VEHICLE" ? mileage.get(s.assetId) : undefined
  const current = reading?.value
  const milesLeft = s.nextDueMileage != null && current != null ? s.nextDueMileage - current : null

  const overdueByDate = daysLeft != null && daysLeft < 0
  const overdueByMiles = milesLeft != null && milesLeft < 0
  const soonByDate = daysLeft != null && daysLeft >= 0 && daysLeft <= s.reminderDaysBefore
  const soonByMiles = milesLeft != null && milesLeft >= 0 && milesLeft <= s.reminderMilesBefore

  const overdue = overdueByDate || overdueByMiles
  const dueSoon = !overdue && (soonByDate || soonByMiles)

  // Prefer whichever side actually triggered; when both did, mileage is the
  // more specific fact to tell someone about.
  let reason: Due["reason"] = null
  if (overdue) reason = overdueByMiles ? "mileage" : "date"
  else if (dueSoon) reason = soonByMiles ? "mileage" : "date"

  return { overdue, dueSoon, daysLeft, milesLeft, reason, meterUnit: milesLeft != null ? (reading?.unit ?? "MILES") : null }
}

/** Badge wording shared by the maintenance page and the asset-detail list. */
export function dueBadge(due: Due, hasSchedule: boolean, fmt: Pick<Formatter, "meterShort">) {
  if (due.overdue) return { label: "Overdue", variant: "destructive" as const }
  if (due.dueSoon) {
    if (due.reason === "mileage" && due.milesLeft != null) {
      return { label: `${due.milesLeft.toLocaleString()} ${fmt.meterShort(due.meterUnit ?? "MILES")}`, variant: "secondary" as const }
    }
    return { label: due.daysLeft != null ? `${due.daysLeft}d` : "Due soon", variant: "secondary" as const }
  }
  return hasSchedule ? { label: "OK", variant: "outline" as const } : null
}

/**
 * The rows worth evaluating: anything with a date inside the window, plus every
 * mileage-tracked row (an odometer has no equivalent of "within 30 days", so
 * they have to be checked in JS).
 */
export function dueCandidateFilter(withinDays: number, now: Date = new Date()) {
  return {
    ...awakeFilter(now),
    AND: [{
      OR: [
        { nextDueDate: { lte: new Date(now.getTime() + withinDays * 86400000) } },
        { nextDueMileage: { not: null } },
      ],
    }],
  }
}

/** Active and not snoozed: the reminders that should be raised right now. */
export function awakeFilter(now: Date = new Date()) {
  return {
    isActive: true,
    OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }],
  }
}

export function isSnoozed(s: { snoozedUntil: Date | null }, now: Date = new Date()) {
  return s.snoozedUntil != null && new Date(s.snoozedUntil) > now
}

export const SNOOZE_OPTIONS = [
  { value: "1d", label: "1 day" },
  { value: "1w", label: "1 week" },
  { value: "1m", label: "1 month" },
] as const

export type SnoozeFor = (typeof SNOOZE_OPTIONS)[number]["value"]

/** When a snooze chosen at `now` ends. A month is a calendar month, clamped to its last day. */
export function snoozeEnd(choice: SnoozeFor, now: Date = new Date()): Date {
  const end = new Date(now)
  if (choice === "1d") end.setDate(end.getDate() + 1)
  else if (choice === "1w") end.setDate(end.getDate() + 7)
  else {
    const day = end.getDate()
    end.setDate(1)
    end.setMonth(end.getMonth() + 1)
    end.setDate(Math.min(day, new Date(end.getFullYear(), end.getMonth() + 1, 0).getDate()))
  }
  return end
}
