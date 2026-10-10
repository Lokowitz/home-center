import { prisma } from "@/lib/prisma"
import { isSnoozed } from "@/lib/maintenance-due"
import { maintenanceCycleKey } from "@/lib/notifications/repeat"
import type { MaintenanceSchedule, MeterUnit, Notification } from "@/app/generated/prisma/client"

/** What a "due" notification needs to offer Complete and Snooze in place. */
export type NotificationReminder = {
  schedule: MaintenanceSchedule
  /** The vehicle's odometer, to prefill the completion. Null for anything else. */
  currentMileage: number | null
  meterUnit: MeterUnit
}

/**
 * The reminders behind open maintenance notifications, keyed by notification
 * id. A notification gets one only while it still describes the reminder's
 * current due date and the reminder is live: completing from an older one would
 * advance a cycle it isn't about, and a paused or snoozed reminder has already
 * been dealt with. One query for the reminders, one for their vehicles.
 */
export async function loadNotificationReminders(notifications: Notification[], now: Date = new Date()): Promise<Map<string, NotificationReminder>> {
  const open = notifications.filter((n) => n.type === "MAINTENANCE_DUE" && n.relatedEntityType === "MaintenanceSchedule" && n.relatedEntityId && !n.dismissedAt)
  if (open.length === 0) return new Map()

  const schedules = await prisma.maintenanceSchedule.findMany({ where: { id: { in: [...new Set(open.map((n) => n.relatedEntityId!))] } } })
  const vehicleIds = [...new Set(schedules.filter((s) => s.assetType === "VEHICLE").map((s) => s.assetId))]
  const vehicles = vehicleIds.length
    ? await prisma.vehicle.findMany({ where: { id: { in: vehicleIds } }, select: { id: true, currentMileage: true, meterUnit: true } })
    : []

  const scheduleById = new Map(schedules.map((s) => [s.id, s]))
  const vehicleById = new Map(vehicles.map((v) => [v.id, v]))

  const out = new Map<string, NotificationReminder>()
  for (const n of open) {
    const s = scheduleById.get(n.relatedEntityId!)
    if (!s || !s.isActive || isSnoozed(s, now) || !aboutCurrentCycle(n, s)) continue
    const v = s.assetType === "VEHICLE" ? vehicleById.get(s.assetId) : undefined
    out.set(n.id, { schedule: s, currentMileage: v?.currentMileage ?? null, meterUnit: v?.meterUnit ?? "MILES" })
  }
  return out
}

/**
 * Whether a notification is about the reminder's current due date. Rows written
 * before cycles were tracked have no key; they count unless the reminder has
 * been completed since they were raised.
 */
function aboutCurrentCycle(n: Notification, s: MaintenanceSchedule): boolean {
  if (n.cycleKey !== null) return n.cycleKey === maintenanceCycleKey(s)
  return !s.lastCompletedDate || n.createdAt >= s.lastCompletedDate
}
