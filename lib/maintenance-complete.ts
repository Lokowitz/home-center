import type { AssetType } from "@/app/generated/prisma/client"
import { nextCalendarDue, parseDueMonths, scheduleKind } from "@/lib/maintenance-schedule"

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
  dueMonths?: string | null
  dueDay?: number | null
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
/// whatever due value it had. A calendar reminder moves to its next listed
/// month after the later of the completion and the current due date, and a
/// one-time reminder has nothing left to be due. Likewise an older completion never replaces a
/// later recorded one as "last completed".
export function completeSchedule(schedule: CompletableSchedule, completedDate: Date, completedMileage: number | null): ScheduleCompletion {
  const kind = scheduleKind(schedule)
  const computedDate = kind === "calendar"
    ? nextCalendarDue(parseDueMonths(schedule.dueMonths), schedule.dueDay ?? 1, later(completedDate, schedule.nextDueDate))
    : schedule.intervalDays
    ? new Date(new Date(completedDate).setUTCDate(completedDate.getUTCDate() + schedule.intervalDays))
    : null
  const nextDueDate = kind === "once"
    ? null
    : computedDate
      ? schedule.nextDueDate && schedule.nextDueDate.getTime() >= computedDate.getTime() ? schedule.nextDueDate : computedDate
      : schedule.nextDueDate
  const computedMileage = schedule.intervalMiles && completedMileage != null ? completedMileage + schedule.intervalMiles : null
  const nextDueMileage = kind === "once"
    ? null
    : computedMileage != null
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

function later(a: Date, b: Date | null | undefined): Date {
  return b && b.getTime() > a.getTime() ? b : a
}

/// "Skip this time": the next due date and mileage move on by whole intervals
/// from where they were due until they're ahead again — past `now`, and past
/// the current reading when there is one. Nothing is recorded as done.
export function skipSchedule(schedule: CompletableSchedule, now: Date, currentReading: number | null): Pick<ScheduleCompletion, "nextDueDate" | "nextDueMileage"> {
  let nextDueDate = schedule.nextDueDate
  if (scheduleKind(schedule) === "calendar" && nextDueDate) {
    nextDueDate = nextCalendarDue(parseDueMonths(schedule.dueMonths), schedule.dueDay ?? 1, later(now, nextDueDate))
  } else if (schedule.intervalDays && nextDueDate) {
    const d = new Date(nextDueDate)
    do d.setUTCDate(d.getUTCDate() + schedule.intervalDays)
    while (d.getTime() <= now.getTime())
    nextDueDate = d
  }
  let nextDueMileage = schedule.nextDueMileage
  if (schedule.intervalMiles && nextDueMileage != null) {
    const behind = currentReading != null ? Math.max(0, currentReading - nextDueMileage) : 0
    nextDueMileage += (Math.floor(behind / schedule.intervalMiles) + 1) * schedule.intervalMiles
  }
  return { nextDueDate, nextDueMileage }
}

/// Skipping needs something to step: an interval with a due value on the same side.
export function canSkip(s: Pick<CompletableSchedule, "intervalDays" | "intervalMiles" | "nextDueDate" | "nextDueMileage" | "dueMonths">): boolean {
  return Boolean((scheduleKind(s) === "calendar" && s.nextDueDate) || (s.intervalDays && s.nextDueDate) || (s.intervalMiles && s.nextDueMileage != null))
}

export type CompletionInput = { date: Date; mileage: number | null; vendor: string; cost: number | null; notes: string }

/// The service record "Complete" logs: the reminder's title, with blanks kept
/// empty rather than 0, and a reading only where an odometer means something.
/// The record lands in the reminder's room, if it has one.
export function completionRecordData(
  schedule: { assetType: AssetType; assetId: string; title: string; roomId?: string | null },
  input: CompletionInput,
  createdById: string
) {
  return {
    assetType: schedule.assetType,
    assetId: schedule.assetId,
    date: input.date,
    title: schedule.title,
    description: input.notes || null,
    vendor: input.vendor || null,
    cost: input.cost,
    category: completionCategory(schedule.assetType),
    mileageAtService: schedule.assetType === "VEHICLE" ? input.mileage : null,
    roomId: schedule.roomId ?? null,
    createdById,
  }
}

/// The service record category a completed reminder is logged under. People's
/// records only take the medical categories, so theirs stay uncategorized.
export function completionCategory(assetType: AssetType): "ROUTINE" | null {
  return assetType === "PERSON" ? null : "ROUTINE"
}
