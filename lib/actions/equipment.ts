"use server"

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { deleteAssetWithRecords } from "@/lib/asset-delete-server"
import { ignoreGone, orGone } from "@/lib/gone"
import { equipmentSchema as schema, equipmentData as clean, type EquipmentInput } from "@/lib/asset-input"

/**
 * The row to save, with the room link checked: a room on the equipment's property links it and
 * clears the free-text location; a room that isn't on it (say the property just changed) is
 * dropped and the typed location text stays.
 */
async function withRoom(data: ReturnType<typeof clean>) {
  if (!data.roomId) return data
  const room = await prisma.room.findUnique({ where: { id: data.roomId }, select: { propertyId: true } })
  if (!room || !data.propertyId || room.propertyId !== data.propertyId) return { ...data, roomId: null }
  return { ...data, location: null }
}

export async function createEquipment(data: EquipmentInput) {
  const session = await auth()
  if (!session) redirect("/login")

  const parsed = schema.safeParse(data)
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors }

  const row = await prisma.equipment.create({ data: await withRoom(clean(parsed.data)) })
  revalidatePath("/assets/equipment")
  return { success: true, id: row.id }
}

export async function updateEquipment(id: string, data: EquipmentInput) {
  const session = await auth()
  if (!session) redirect("/login")

  const parsed = schema.safeParse(data)
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors }

  const saved = await orGone(async () => prisma.equipment.update({ where: { id }, data: await withRoom(clean(parsed.data)) }))
  if (saved) return { error: saved.error }
  revalidatePath("/assets/equipment")
  revalidatePath(`/assets/equipment/${id}`)
  return { success: true }
}

export async function deleteEquipment(id: string) {
  const session = await auth()
  if (!session) redirect("/login")

  await ignoreGone(() => deleteAssetWithRecords("EQUIPMENT", id))

  revalidatePath("/assets/equipment")
  revalidatePath("/records")
  revalidatePath("/warranties")
  revalidatePath("/maintenance")
  return { success: true }
}
