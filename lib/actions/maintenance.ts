"use server"

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { revalidatePath } from "next/cache"
import { ASSET_TYPES, assetHref } from "@/lib/assets"
import type { AssetType } from "@/app/generated/prisma/client"
import { redirect } from "next/navigation"
import { z } from "zod"
import { canSkip, completionRecordData, skipSchedule } from "@/lib/maintenance-complete"
import { dismissScheduleNotifications, scheduleCompletionWrites } from "@/lib/maintenance-complete-server"
import { snoozeEnd, type SnoozeFor } from "@/lib/maintenance-due"
import { firstDue, templatesFor } from "@/lib/maintenance-templates"
import { loadTemplateTarget } from "@/lib/maintenance-templates-server"
import { checkRoom } from "@/lib/rooms-server"

const schema = z.object({
  assetId: z.string().min(1),
  assetType: z.enum(ASSET_TYPES),
  title: z.string().min(1, "Title is required"),
  description: z.string().optional(),
  // "" is tried first: coerce would turn a blank field into 0.
  intervalDays: z.literal("").or(z.coerce.number().int().min(1)).optional(),
  intervalMiles: z.literal("").or(z.coerce.number().int().min(1)).optional(),
  nextDueDate: z.string().optional(),
  nextDueMileage: z.literal("").or(z.coerce.number().int().min(0)).optional(),
  reminderDaysBefore: z.coerce.number().int().min(1).default(14),
  reminderMilesBefore: z.coerce.number().int().min(1).default(500),
  /// Must be a room on the target's property; left out, an update keeps the schedule's room.
  roomId: z.string().optional(),
})

/** Checks a sent roomId; `undefined` (none sent) means leave the room alone. */
async function roomFor(v: z.infer<typeof schema>) {
  if (v.roomId === undefined) return { roomId: undefined }
  const room = await checkRoom(v.roomId, v.assetType, v.assetId)
  return "error" in room ? { error: { roomId: [room.error] } } : room
}

function clean(v: z.infer<typeof schema>) {
  return {
    assetId: v.assetId,
    assetType: v.assetType,
    title: v.title,
    description: v.description || null,
    intervalDays: v.intervalDays === "" || !v.intervalDays ? null : Number(v.intervalDays),
    intervalMiles: v.intervalMiles === "" || !v.intervalMiles ? null : Number(v.intervalMiles),
    nextDueDate: v.nextDueDate ? new Date(v.nextDueDate) : null,
    nextDueMileage: v.nextDueMileage === "" || !v.nextDueMileage ? null : Number(v.nextDueMileage),
    reminderDaysBefore: Number(v.reminderDaysBefore) || 14,
    reminderMilesBefore: Number(v.reminderMilesBefore) || 500,
  }
}

export async function createMaintenanceSchedule(data: z.infer<typeof schema>) {
  const session = await auth()
  if (!session) redirect("/login")
  const parsed = schema.safeParse(data)
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors }
  const room = await roomFor(parsed.data)
  if ("error" in room) return { error: room.error }
  const row = await prisma.maintenanceSchedule.create({ data: { ...clean(parsed.data), roomId: room.roomId } })
  revalidatePath(assetHref(parsed.data.assetType, parsed.data.assetId))
  revalidatePath("/maintenance")
  revalidatePath("/")
  return { success: true, id: row.id }
}

export async function updateMaintenanceSchedule(id: string, data: z.infer<typeof schema>) {
  const session = await auth()
  if (!session) redirect("/login")
  const parsed = schema.safeParse(data)
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors }
  const room = await roomFor(parsed.data)
  if ("error" in room) return { error: room.error }
  await prisma.maintenanceSchedule.update({ where: { id }, data: { ...clean(parsed.data), roomId: room.roomId } })
  revalidatePath(assetHref(parsed.data.assetType, parsed.data.assetId))
  revalidatePath("/maintenance")
  revalidatePath("/")
  return { success: true }
}

export async function deleteMaintenanceSchedule(id: string, assetType: AssetType, assetId: string) {
  const session = await auth()
  if (!session) redirect("/login")
  await prisma.maintenanceSchedule.delete({ where: { id } })
  revalidatePath(assetHref(assetType, assetId))
  revalidatePath("/maintenance")
  revalidatePath("/")
  return { success: true }
}

const completeSchema = z.object({
  completedDate: z.string().min(1),
  completedMileage: z.literal("").or(z.coerce.number().int().min(0)).optional(),
  /// Log the work as a service record too. On unless the caller turns it off.
  logService: z.boolean().default(true),
  vendor: z.string().optional(),
  cost: z.literal("").or(z.coerce.number().min(0)).optional(),
  notes: z.string().optional(),
})

export async function completeMaintenanceSchedule(id: string, data: z.input<typeof completeSchema>) {
  const session = await auth()
  if (!session) redirect("/login")

  const parsed = completeSchema.safeParse(data)
  if (!parsed.success) return { error: "Invalid input" }
  const v = parsed.data

  const schedule = await prisma.maintenanceSchedule.findUnique({ where: { id } })
  if (!schedule) return { error: "Not found" }

  const completedDate = new Date(v.completedDate)
  const completedMileage = v.completedMileage === "" || v.completedMileage === undefined ? null : Number(v.completedMileage)

  const record = v.logService
    ? prisma.serviceRecord.create({
        data: completionRecordData(
          schedule,
          {
            date: completedDate,
            mileage: completedMileage,
            vendor: v.vendor ?? "",
            cost: v.cost === "" || v.cost === undefined ? null : Number(v.cost),
            notes: v.notes ?? "",
          },
          session.user.id
        ),
        select: { id: true },
      })
    : null

  // The reminder and its service record land together or not at all, so the
  // history never misses a completion the reminder already counted.
  const [created] = await prisma.$transaction([
    ...(record ? [record] : []),
    ...scheduleCompletionWrites(schedule, completedDate, completedMileage),
  ])
  const serviceRecordId = record ? (created as { id: string }).id : null

  revalidatePath(assetHref(schedule.assetType, schedule.assetId))
  revalidatePath("/maintenance")
  revalidatePath("/")
  revalidatePath("/records")
  return { success: true, serviceRecordId }
}

const snoozeSchema = z.enum(["1d", "1w", "1m"] as const satisfies readonly SnoozeFor[]).nullable()

/** Hide a reminder from the dashboard and notifications for a while; null wakes it now. */
export async function snoozeMaintenanceSchedule(id: string, snoozeFor: z.input<typeof snoozeSchema>) {
  const session = await auth()
  if (!session) redirect("/login")
  const parsed = snoozeSchema.safeParse(snoozeFor)
  if (!parsed.success) return { error: "Invalid input" }

  const schedule = await prisma.maintenanceSchedule.findUnique({ where: { id }, select: { assetType: true, assetId: true } })
  if (!schedule) return { error: "Not found" }

  const snoozedUntil = parsed.data ? snoozeEnd(parsed.data) : null
  await prisma.$transaction([
    prisma.maintenanceSchedule.update({ where: { id }, data: { snoozedUntil } }),
    ...(snoozedUntil ? [dismissScheduleNotifications(id)] : []),
  ])
  revalidateSchedule(schedule)
  return { success: true, snoozedUntil }
}

/**
 * "Skip this time": move the reminder on to its next due date and mileage
 * without logging it as done. Ends any snooze and clears its due notifications.
 */
export async function skipMaintenanceSchedule(id: string) {
  const session = await auth()
  if (!session) redirect("/login")

  const schedule = await prisma.maintenanceSchedule.findUnique({ where: { id } })
  if (!schedule) return { error: "Not found" }
  if (!canSkip(schedule)) return { error: "This reminder doesn't repeat, so there's nothing to skip to." }

  const vehicle = schedule.assetType === "VEHICLE"
    ? await prisma.vehicle.findUnique({ where: { id: schedule.assetId }, select: { currentMileage: true } })
    : null
  const next = skipSchedule(schedule, new Date(), vehicle?.currentMileage ?? null)
  await prisma.$transaction([
    prisma.maintenanceSchedule.update({ where: { id }, data: { ...next, snoozedUntil: null } }),
    dismissScheduleNotifications(id),
  ])
  revalidateSchedule(schedule)
  return { success: true, nextDueDate: next.nextDueDate, nextDueMileage: next.nextDueMileage }
}

/** Pause keeps the reminder on its asset page but stops it counting as due. */
export async function setMaintenanceScheduleActive(id: string, isActive: boolean) {
  const session = await auth()
  if (!session) redirect("/login")
  if (typeof isActive !== "boolean") return { error: "Invalid input" }

  const schedule = await prisma.maintenanceSchedule.findUnique({ where: { id }, select: { assetType: true, assetId: true } })
  if (!schedule) return { error: "Not found" }

  await prisma.$transaction([
    // A resumed reminder starts unsnoozed, so it reads the way it looks.
    prisma.maintenanceSchedule.update({ where: { id }, data: isActive ? { isActive, snoozedUntil: null } : { isActive } }),
    ...(isActive ? [] : [dismissScheduleNotifications(id)]),
  ])
  revalidateSchedule(schedule)
  return { success: true }
}

const templatePicksSchema = z
  .array(
    z.object({
      key: z.string().min(1),
      intervalDays: z.literal("").or(z.coerce.number().int().min(1)).optional(),
      intervalMiles: z.literal("").or(z.coerce.number().int().min(1)).optional(),
    })
  )
  .min(1)
  .max(50)

/**
 * Creates the default reminders picked for a new asset. Keys are checked
 * against the asset's own template list; titles always come from it, and only
 * the intervals can be changed.
 */
export async function addTemplateSchedules(assetType: AssetType, assetId: string, picks: z.input<typeof templatePicksSchema>) {
  const session = await auth()
  if (!session) redirect("/login")
  const parsed = templatePicksSchema.safeParse(picks)
  if (!parsed.success) return { error: "Invalid input" }

  const target = await loadTemplateTarget(assetType, assetId)
  if (!target) return { error: "Not found" }
  const byKey = new Map(templatesFor(target.asset).map((t) => [t.key, t]))

  const today = new Date()
  const rows = []
  for (const pick of parsed.data) {
    const t = byKey.get(pick.key)
    if (!t) return { error: "Invalid input" }
    const intervalDays = pick.intervalDays === undefined ? t.intervalDays ?? null : pick.intervalDays === "" ? null : pick.intervalDays
    const intervalMiles = pick.intervalMiles === undefined ? t.intervalMiles ?? null : pick.intervalMiles === "" ? null : pick.intervalMiles
    if (!intervalDays && !intervalMiles) return { error: `"${t.title}" needs an interval.` }
    rows.push({
      assetType,
      assetId,
      title: t.title,
      description: t.description ?? null,
      intervalDays,
      intervalMiles,
      ...firstDue({ intervalDays, intervalMiles }, today, target.currentReading),
      ...(t.reminderMilesBefore ? { reminderMilesBefore: t.reminderMilesBefore } : {}),
    })
  }

  await prisma.maintenanceSchedule.createMany({ data: rows })
  revalidateSchedule({ assetType, assetId })
  return { success: true, count: rows.length }
}

function revalidateSchedule(s: { assetType: AssetType; assetId: string }) {
  revalidatePath(assetHref(s.assetType, s.assetId))
  revalidatePath("/maintenance")
  revalidatePath("/")
}
