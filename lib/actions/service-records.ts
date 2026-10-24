"use server"

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { revalidatePath } from "next/cache"
import { assetHref } from "@/lib/assets"
import type { AssetType, MeterUnit, Prisma } from "@/app/generated/prisma/client"
import { redirect } from "next/navigation"
import { loadFeatures } from "@/lib/features-server"
import { removeUploadDir } from "@/lib/upload-fs"
import {
  cleanServiceRecord, newServiceRecordWrites, prepareNewServiceRecord, revalidateNewServiceRecord, serviceRecordSchema,
  withProviderVendor, type ServiceRecordInput,
} from "@/lib/service-record-server"
import { checkRoom, roomOptionsFor, type RoomOption } from "@/lib/rooms-server"

export type RecordFormContext = {
  meterUnit?: MeterUnit
  propertyName?: string
  equipmentOptions?: { id: string; name: string; roomId: string | null }[]
  /** Rooms of the asset's property; empty or missing hides the room select. */
  roomOptions?: RoomOption[]
  /** A new record's room: the equipment's own. */
  defaultRoomId?: string | null
  providerOptions?: { id: string; name: string }[]
  conditionOptions?: { id: string; name: string }[]
  reminderOptions: { id: string; title: string; assetType: AssetType; assetId: string }[]
}

/** What the record form needs about one asset, so the Records page can open it without leaving. */
export async function loadRecordFormContext(assetType: AssetType, assetId: string): Promise<RecordFormContext | { error: string }> {
  const session = await auth()
  if (!session) redirect("/login")

  const reminderSelect = { id: true, title: true, assetType: true, assetId: true } as const
  const reminders = (where: Prisma.MaintenanceScheduleWhereInput) =>
    prisma.maintenanceSchedule.findMany({ where, select: reminderSelect, orderBy: { nextDueDate: "asc" } })

  if (assetType === "VEHICLE") {
    const vehicle = await prisma.vehicle.findUnique({ where: { id: assetId }, select: { meterUnit: true } })
    if (!vehicle) return { error: "Not found" }
    return { meterUnit: vehicle.meterUnit, reminderOptions: await reminders({ assetType, assetId }) }
  }
  if (assetType === "PROPERTY") {
    const property = await prisma.property.findUnique({ where: { id: assetId }, select: { name: true } })
    if (!property) return { error: "Not found" }
    const equipment = await prisma.equipment.findMany({ where: { propertyId: assetId }, select: { id: true, name: true, roomId: true } })
    const [reminderOptions, roomOptions] = await Promise.all([
      reminders({
        OR: [{ assetType, assetId }, ...(equipment.length ? [{ assetType: "EQUIPMENT" as const, assetId: { in: equipment.map((e) => e.id) } }] : [])],
      }),
      roomOptionsFor(assetType, assetId),
    ])
    return { propertyName: property.name, equipmentOptions: equipment, roomOptions, reminderOptions }
  }
  if (assetType === "PERSON") {
    if (!(await loadFeatures()).health) return { error: "Not found" }
    const person = await prisma.person.findUnique({ where: { id: assetId }, select: { conditions: { select: { id: true, name: true } } } })
    if (!person) return { error: "Not found" }
    const [providerOptions, reminderOptions] = await Promise.all([
      prisma.provider.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
      reminders({ assetType, assetId }),
    ])
    return { providerOptions, conditionOptions: person.conditions, reminderOptions }
  }
  if (assetType === "EQUIPMENT") {
    const equipment = await prisma.equipment.findUnique({ where: { id: assetId }, select: { roomId: true } })
    if (!equipment) return { error: "Not found" }
    const [reminderOptions, roomOptions] = await Promise.all([reminders({ assetType, assetId }), roomOptionsFor(assetType, assetId)])
    return { roomOptions, defaultRoomId: equipment.roomId, reminderOptions }
  }
  return { reminderOptions: await reminders({ assetType, assetId }) }
}

/** One record with its files plus the form context, for editing it from the Records page. */
export async function loadRecordForEdit(id: string) {
  const session = await auth()
  if (!session) redirect("/login")

  const record = await prisma.serviceRecord.findUnique({ where: { id }, include: { attachments: true } })
  if (!record) return { error: "Not found" }
  const ctx = await loadRecordFormContext(record.assetType, record.assetId)
  if ("error" in ctx) return ctx
  return { record, ctx }
}

export async function createServiceRecord(data: ServiceRecordInput) {
  const session = await auth()
  if (!session) redirect("/login")

  const prepared = await prepareNewServiceRecord(data, session.user.id)
  if ("error" in prepared) return { error: prepared.error }

  const [record] = await prisma.$transaction([...newServiceRecordWrites(prepared.ok)])
  revalidateNewServiceRecord(prepared.ok)
  return { success: true, id: record.id }
}

export async function updateServiceRecord(id: string, data: ServiceRecordInput) {
  const session = await auth()
  if (!session) redirect("/login")

  const parsed = serviceRecordSchema.safeParse(data)
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors }

  // No roomId sent (no room select shown, e.g. Rooms off) leaves the record's room as it was.
  const room = parsed.data.roomId === undefined ? undefined : await checkRoom(parsed.data.roomId, parsed.data.assetType, parsed.data.assetId)
  if (room && "error" in room) return { error: { roomId: [room.error] } }

  const row = await withProviderVendor(cleanServiceRecord(parsed.data, session.user.id))
  await prisma.serviceRecord.update({ where: { id }, data: { ...row, roomId: room?.roomId } })
  revalidatePath(assetHref(parsed.data.assetType, parsed.data.assetId))
  revalidatePath("/records")
  return { success: true }
}

export async function deleteServiceRecord(id: string, assetType: AssetType, assetId: string) {
  const session = await auth()
  if (!session) redirect("/login")

  // Look the record up first: the id arrives from the client and must be proven
  // real before it is used to build a directory path.
  const record = await prisma.serviceRecord.findUnique({ where: { id }, select: { id: true } })
  if (!record) return { error: "Not found" }

  await prisma.serviceRecord.delete({ where: { id: record.id } })
  await removeUploadDir("service", record.id)

  revalidatePath(assetHref(assetType, assetId))
  revalidatePath("/records")
  return { success: true }
}
