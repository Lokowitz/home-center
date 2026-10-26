import { prisma } from "@/lib/prisma"
import { revalidatePath } from "next/cache"
import { ASSET_TYPES, assetHref } from "@/lib/assets"
import { SERVICE_CATEGORY_VALUES } from "@/lib/costs"
import type { MaintenanceSchedule } from "@/app/generated/prisma/client"
import { scheduleCompletionWrites } from "@/lib/maintenance-complete-server"
import { checkRoom } from "@/lib/rooms-server"
import { z } from "zod"
import { RANGE_DATE_MESSAGE, dateInRange, meterReading, moneyAmount, nameText, optionalNameText, parseDateOnly, requiredDateText } from "@/lib/input-limits"
import { completeSchedule } from "@/lib/maintenance-complete"

// Shared by the service record actions and the capture inbox, which files a
// receipt as a new record in the same transaction that moves its files. Not a
// server action module, so the schema and helpers can be exported.

export const serviceRecordSchema = z.object({
  assetId: z.string().min(1),
  assetType: z.enum(ASSET_TYPES),
  date: requiredDateText("Date is required"),
  title: nameText("Title is required"),
  description: z.string().optional(),
  vendor: optionalNameText,
  // "" is tried first: coerce would turn a blank field into 0. Negative is how a refund is entered.
  cost: z.literal("").or(moneyAmount({ negative: true })).optional(),
  category: z.enum(SERVICE_CATEGORY_VALUES).optional().or(z.literal("")),
  mileageAtService: z.literal("").or(meterReading()).optional(),
  providerId: z.string().optional(),
  conditionId: z.string().optional(),
  /// Must be a room on the target's property; checked with `checkRoom` before saving.
  roomId: z.string().optional(),
  /// New records only: the maintenance reminder this service completes.
  scheduleId: z.string().optional(),
})

export type ServiceRecordInput = z.infer<typeof serviceRecordSchema>
export type ServiceRecordFieldErrors = Partial<Record<keyof ServiceRecordInput, string[]>>

export function cleanServiceRecord(v: ServiceRecordInput, userId: string) {
  return {
    assetId: v.assetId,
    assetType: v.assetType,
    date: parseDateOnly(v.date) as Date,
    title: v.title,
    description: v.description || null,
    vendor: v.vendor || null,
    cost: v.cost === "" || v.cost === undefined ? null : Number(v.cost),
    category: v.category === "" || v.category === undefined ? null : v.category,
    mileageAtService: v.mileageAtService === "" || v.mileageAtService === undefined ? null : Number(v.mileageAtService),
    providerId: v.providerId || null,
    conditionId: v.conditionId || null,
    roomId: v.roomId || null,
    createdById: userId,
  }
}

export type ServiceRecordRow = ReturnType<typeof cleanServiceRecord>

// A visit linked to a provider but with no facility typed still has a payee,
// so the cost reports' vendor ranking works for medical spend too.
export async function withProviderVendor<T extends { providerId: string | null; vendor: string | null }>(data: T): Promise<T> {
  if (!data.providerId || data.vendor) return data
  const provider = await prisma.provider.findUnique({ where: { id: data.providerId }, select: { name: true } })
  return { ...data, vendor: provider?.name ?? null }
}

export type PreparedServiceRecord = { row: ServiceRecordRow; schedule: MaintenanceSchedule | null }

/** Validates a new record and finds the reminder it completes, if any. */
export async function prepareNewServiceRecord(
  data: ServiceRecordInput,
  userId: string
): Promise<{ error: ServiceRecordFieldErrors } | { ok: PreparedServiceRecord }> {
  const parsed = serviceRecordSchema.safeParse(data)
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors }

  const room = await checkRoom(parsed.data.roomId, parsed.data.assetType, parsed.data.assetId)
  if ("error" in room) return { error: { roomId: [room.error] } }
  const row = await withProviderVendor({ ...cleanServiceRecord(parsed.data, userId), roomId: room.roomId })

  // "Completes reminder": the reminder must belong to the same asset, so a
  // stale form can't advance some other asset's schedule.
  const scheduleId = parsed.data.scheduleId
  const schedule = scheduleId
    ? await prisma.maintenanceSchedule.findFirst({ where: { id: scheduleId, assetType: row.assetType, assetId: row.assetId } })
    : null
  if (scheduleId && !schedule) return { error: { scheduleId: ["That reminder isn't on this asset."] } }
  // A repeat interval saved before the limits can push the next due date out of range.
  if (schedule && !dateInRange(completeSchedule(schedule, row.date, row.mileageAtService).nextDueDate)) return { error: { scheduleId: [RANGE_DATE_MESSAGE] } }
  return { ok: { row, schedule } }
}

/** The writes for the caller's $transaction: the record (with `id` if given) and the reminder's completion. */
export function newServiceRecordWrites({ row, schedule }: PreparedServiceRecord, id?: string) {
  return [
    prisma.serviceRecord.create({ data: { ...row, ...(id ? { id } : {}) }, select: { id: true } }),
    ...(schedule ? scheduleCompletionWrites(schedule, row.date, row.mileageAtService) : []),
  ] as const
}

export function revalidateNewServiceRecord({ row, schedule }: PreparedServiceRecord) {
  revalidatePath(assetHref(row.assetType, row.assetId))
  revalidatePath("/records")
  if (schedule) {
    revalidatePath("/maintenance")
    revalidatePath("/")
  }
}
