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
import { alignCalendarDue, firstCalendarDue, formatDueMonths, normalizeRepeats, parseDueMonths } from "@/lib/maintenance-schedule"
import { loadTemplateTarget } from "@/lib/maintenance-templates-server"
import { checkRoom } from "@/lib/rooms-server"
import { cleanReference, referenceAllowed, trustedTarget } from "@/lib/manual-reference"
import { checkReference } from "@/lib/manual-reference-server"
import { findManualPage } from "@/lib/manual-page"
import { loadFeatures } from "@/lib/features-server"

const schema = z.object({
  assetId: z.string().min(1),
  assetType: z.enum(ASSET_TYPES),
  title: z.string().min(1, "Title is required"),
  description: z.string().optional(),
  // "" is tried first: coerce would turn a blank field into 0.
  intervalDays: z.literal("").or(z.coerce.number().int().min(1)).optional(),
  intervalMiles: z.literal("").or(z.coerce.number().int().min(1)).optional(),
  /// "4,10": months of the year for a calendar schedule. Blank for the other kinds.
  dueMonths: z.string().optional(),
  dueDay: z.literal("").or(z.coerce.number().int().min(1).max(28)).optional(),
  estimatedCost: z.literal("").or(z.coerce.number().min(0)).optional(),
  nextDueDate: z.string().optional(),
  nextDueMileage: z.literal("").or(z.coerce.number().int().min(0)).optional(),
  reminderDaysBefore: z.coerce.number().int().min(1).default(14),
  reminderMilesBefore: z.coerce.number().int().min(1).default(500),
  /// Must be a room on the target's property; left out, an update keeps the schedule's room.
  roomId: z.string().optional(),
  /// A file on the same asset or on this reminder, and a page of it. Left out, an update keeps the stored link.
  referenceAttachmentId: z.string().optional(),
  referencePage: z.string().or(z.number()).optional(),
})

/** Checks a sent roomId; `undefined` (none sent) means leave the room alone. */
async function roomFor(v: z.infer<typeof schema>) {
  if (v.roomId === undefined) return { roomId: undefined }
  const room = await checkRoom(v.roomId, v.assetType, v.assetId)
  return "error" in room ? { error: { roomId: [room.error] } } : room
}

/** Cleans and checks the sent manual reference; `value` undefined means leave it alone. */
async function referenceFor(v: z.infer<typeof schema>, scheduleId: string | null) {
  const cleaned = cleanReference({ attachmentId: v.referenceAttachmentId, page: v.referencePage })
  if (!cleaned.ok) return { error: { referencePage: [cleaned.error] } }
  const checked = await checkReference(cleaned.value, { assetType: v.assetType, assetId: v.assetId }, scheduleId)
  return "error" in checked ? { error: { referenceAttachmentId: [checked.error] } } : { value: checked.value }
}

function clean(v: z.infer<typeof schema>) {
  const repeats = normalizeRepeats({
    intervalDays: v.intervalDays === "" || !v.intervalDays ? null : Number(v.intervalDays),
    intervalMiles: v.intervalMiles === "" || !v.intervalMiles ? null : Number(v.intervalMiles),
    dueMonths: parseDueMonths(v.dueMonths),
    dueDay: v.dueDay === "" || !v.dueDay ? null : Number(v.dueDay),
  })
  if (!repeats.ok) return { error: { dueMonths: [repeats.error] } }
  const { dueMonths, dueDay } = repeats.value
  return {
    assetId: v.assetId,
    assetType: v.assetType,
    title: v.title,
    description: v.description || null,
    intervalDays: repeats.value.intervalDays,
    intervalMiles: repeats.value.intervalMiles,
    dueMonths,
    dueDay,
    estimatedCost: v.estimatedCost === "" || v.estimatedCost === undefined ? null : Number(v.estimatedCost),
    // A calendar reminder with no typed date starts on its next listed month.
    // A typed date outside the chosen months (an interval reminder just switched over) moves to the next listed month.
    nextDueDate: v.nextDueDate
      ? dueMonths
        ? alignCalendarDue(parseDueMonths(dueMonths), dueDay ?? 1, new Date(v.nextDueDate))
        : new Date(v.nextDueDate)
      : dueMonths
        ? firstCalendarDue(parseDueMonths(dueMonths), dueDay ?? 1, new Date())
        : null,
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
  const reference = await referenceFor(parsed.data, null)
  if ("error" in reference) return { error: reference.error }
  const fields = clean(parsed.data)
  if ("error" in fields) return { error: fields.error }
  const row = await prisma.maintenanceSchedule.create({ data: { ...fields, roomId: room.roomId, ...(reference.value ?? {}) } })
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
  const reference = await referenceFor(parsed.data, id)
  if ("error" in reference) return { error: reference.error }
  const fields = clean(parsed.data)
  if ("error" in fields) return { error: fields.error }
  await prisma.maintenanceSchedule.update({ where: { id }, data: { ...fields, roomId: room.roomId, ...(reference.value ?? {}) } })
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
    // A set-month template ignores interval picks: the picker only shows its months.
    const dueMonths = t.dueMonths ?? []
    if (!dueMonths.length && !intervalDays && !intervalMiles) return { error: `"${t.title}" needs an interval.` }
    rows.push({
      assetType,
      assetId,
      title: t.title,
      description: t.description ?? null,
      intervalDays: dueMonths.length ? null : intervalDays,
      intervalMiles: dueMonths.length ? null : intervalMiles,
      dueMonths: formatDueMonths(dueMonths),
      dueDay: dueMonths.length ? t.dueDay ?? 1 : null,
      ...firstDue(
        dueMonths.length ? { dueMonths, dueDay: t.dueDay ?? 1 } : { intervalDays, intervalMiles },
        today,
        target.currentReading
      ),
      ...(t.reminderMilesBefore ? { reminderMilesBefore: t.reminderMilesBefore } : {}),
    })
  }

  await prisma.maintenanceSchedule.createMany({ data: rows })
  revalidateSchedule({ assetType, assetId })
  return { success: true, count: rows.length }
}

/**
 * "Find page": the page of a linkable file that best matches a reminder title.
 * Returns a page number only, and only for files the reminder could link.
 */
export async function suggestManualPage(input: {
  attachmentId: string
  assetType: AssetType
  assetId: string
  scheduleId: string | null
  title: string
}): Promise<{ page: number | null } | { error: string }> {
  const session = await auth()
  if (!session) redirect("/login")
  const [file, saved, features] = await Promise.all([
    prisma.attachment.findUnique({
      where: { id: input.attachmentId },
      select: {
        recordType: true,
        assetType: true,
        assetId: true,
        maintenanceScheduleId: true,
        text: { select: { status: true, text: true } },
      },
    }),
    input.scheduleId
      ? prisma.maintenanceSchedule.findUnique({ where: { id: input.scheduleId }, select: { assetType: true, assetId: true } })
      : null,
    loadFeatures(),
  ])
  // A saved reminder's own asset decides, so a client can't dodge the Health check by naming another one.
  const target = trustedTarget({ assetType: input.assetType, assetId: input.assetId }, saved)
  if (!file || (input.scheduleId && !saved) || !referenceAllowed(file, target, input.scheduleId, features.health)) {
    return { error: "Not found" }
  }
  if (!file.text || file.text.status !== "DONE" || !file.text.text) return { page: null }
  return { page: findManualPage(file.text.text, input.title) }
}

function revalidateSchedule(s: { assetType: AssetType; assetId: string }) {
  revalidatePath(assetHref(s.assetType, s.assetId))
  revalidatePath("/maintenance")
  revalidatePath("/")
}
