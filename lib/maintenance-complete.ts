import type { AssetType } from "@/app/generated/prisma/client"

// What completing a maintenance reminder does to the reminder itself. Shared by
// "Complete" on the reminder and "Completes reminder" on a new service record,
// so both roads advance the schedule the same way.

export type CompletableSchedule = {
  intervalDays: number | null
  intervalMiles: number | null
  nextDueDate: Date | null
  nextDueMileage: number | null
}

export type ScheduleCompletion = {
  lastCompletedDate: Date
  lastCompletedMileage: number | null
  nextDueDate: Date | null
  nextDueMileage: number | null
}

/// The next due date/mileage counts from the completion, not from the old due
/// date. A side with no interval keeps whatever due value it had.
export function completeSchedule(schedule: CompletableSchedule, completedDate: Date, completedMileage: number | null): ScheduleCompletion {
  const nextDueDate = schedule.intervalDays
    ? new Date(new Date(completedDate).setDate(completedDate.getDate() + schedule.intervalDays))
    : schedule.nextDueDate
  const nextDueMileage = schedule.intervalMiles && completedMileage != null
    ? completedMileage + schedule.intervalMiles
    : schedule.nextDueMileage
  return { lastCompletedDate: completedDate, lastCompletedMileage: completedMileage, nextDueDate, nextDueMileage }
}

/// The service record category a completed reminder is logged under. People's
/// records only take the medical categories, so theirs stay uncategorized.
export function completionCategory(assetType: AssetType): "ROUTINE" | null {
  return assetType === "PERSON" ? null : "ROUTINE"
}
