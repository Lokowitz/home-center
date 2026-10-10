import type { AssetType } from "@/app/generated/prisma/client"

// What completing a maintenance reminder does to the reminder itself. Shared by
// "Complete" on the reminder and "Completes reminder" on a new service record,
// so both roads advance the schedule the same way.

export type CompletableSchedule = {
  intervalDays: number | null
  intervalMiles: number | null
  nextDueDate: Date | null
  nextDueMileage: number | null
  lastCompletedDate?: Date | null
  lastCompletedMileage?: number | null
}

export type ScheduleCompletion = {
  lastCompletedDate: Date
  lastCompletedMileage: number | null
  nextDueDate: Date | null
  nextDueMileage: number | null
}

/// The next due date/mileage counts from the completion, not from the old due
/// date, but never moves earlier: filing an old receipt against a reminder
/// already due later keeps the later due value. A side with no interval keeps
/// whatever due value it had. Likewise an older completion never replaces a
/// later recorded one as "last completed".
export function completeSchedule(schedule: CompletableSchedule, completedDate: Date, completedMileage: number | null): ScheduleCompletion {
  const computedDate = schedule.intervalDays
    ? new Date(new Date(completedDate).setDate(completedDate.getDate() + schedule.intervalDays))
    : null
  const nextDueDate = computedDate
    ? schedule.nextDueDate && schedule.nextDueDate.getTime() >= computedDate.getTime() ? schedule.nextDueDate : computedDate
    : schedule.nextDueDate
  const computedMileage = schedule.intervalMiles && completedMileage != null ? completedMileage + schedule.intervalMiles : null
  const nextDueMileage = computedMileage != null
    ? Math.max(schedule.nextDueMileage ?? computedMileage, computedMileage)
    : schedule.nextDueMileage
  const olderThanLast = schedule.lastCompletedDate != null && completedDate.getTime() < schedule.lastCompletedDate.getTime()
  return {
    lastCompletedDate: olderThanLast ? schedule.lastCompletedDate! : completedDate,
    lastCompletedMileage: olderThanLast ? schedule.lastCompletedMileage ?? null : completedMileage,
    nextDueDate,
    nextDueMileage,
  }
}

/// The service record category a completed reminder is logged under. People's
/// records only take the medical categories, so theirs stay uncategorized.
export function completionCategory(assetType: AssetType): "ROUTINE" | null {
  return assetType === "PERSON" ? null : "ROUTINE"
}
