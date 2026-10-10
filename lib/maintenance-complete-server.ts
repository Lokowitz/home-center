import { prisma } from "@/lib/prisma"
import type { MaintenanceSchedule } from "@/app/generated/prisma/client"
import { completeSchedule } from "@/lib/maintenance-complete"

/// The writes that mark a reminder done, for the caller's transaction: advance
/// the schedule, end any snooze, clear its due notifications, and raise a
/// vehicle's odometer if the completion read higher.
export function scheduleCompletionWrites(schedule: MaintenanceSchedule, completedDate: Date, completedMileage: number | null) {
  const writes = [
    prisma.maintenanceSchedule.update({
      where: { id: schedule.id },
      data: { ...completeSchedule(schedule, completedDate, completedMileage), snoozedUntil: null },
    }),
    dismissScheduleNotifications(schedule.id),
  ]
  if (schedule.assetType === "VEHICLE" && completedMileage != null) {
    return [
      ...writes,
      prisma.vehicle.updateMany({
        where: { id: schedule.assetId, currentMileage: { lt: completedMileage } },
        data: { currentMileage: completedMileage },
      }),
    ]
  }
  return writes
}

/// Done, snoozed or paused: the reminder's open "due" notifications have been
/// dealt with, so they leave the bell and the pending digest.
export function dismissScheduleNotifications(scheduleId: string, now: Date = new Date()) {
  return prisma.notification.updateMany({
    where: { relatedEntityType: "MaintenanceSchedule", relatedEntityId: scheduleId, dismissedAt: null },
    data: { isRead: true, dismissedAt: now },
  })
}
