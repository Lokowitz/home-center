"use server"

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { orGone } from "@/lib/gone"
import { removeUploadDir } from "@/lib/upload-fs"
import { requireRooms } from "@/lib/features-server"
import { roomSchema, roomData, paintRows, type RoomInput } from "@/lib/rooms"
import { linkEquipmentToRooms } from "@/lib/rooms-server"

export async function createRoom(data: RoomInput) {
  const session = await auth()
  if (!session) redirect("/login")
  await requireRooms()

  const parsed = roomSchema.safeParse(data)
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors }

  const property = await prisma.property.findUnique({ where: { id: parsed.data.propertyId }, select: { id: true } })
  if (!property) return { error: "Property not found" }

  const room = await prisma.room.create({
    data: { ...roomData(parsed.data), paints: { create: paintRows(parsed.data.paints) } },
  })
  // Equipment already located "Kitchen" joins the new Kitchen.
  await linkEquipmentToRooms(room.propertyId)
  revalidatePath(`/assets/properties/${room.propertyId}`)
  revalidatePath("/assets/equipment")
  return { success: true, id: room.id }
}

export async function updateRoom(id: string, data: RoomInput) {
  const session = await auth()
  if (!session) redirect("/login")
  await requireRooms()

  const parsed = roomSchema.safeParse(data)
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors }

  const existing = await prisma.room.findUnique({ where: { id }, select: { id: true, propertyId: true } })
  if (!existing) return { error: "Not found" }
  if (parsed.data.propertyId !== existing.propertyId) return { error: "A room can't move to another property" }

  const saved = await orGone(() => prisma.$transaction([
    prisma.roomPaint.deleteMany({ where: { roomId: id } }),
    prisma.room.update({ where: { id }, data: roomData(parsed.data) }),
    prisma.roomPaint.createMany({ data: paintRows(parsed.data.paints).map((p) => ({ ...p, roomId: id })) }),
  ]))
  if (saved) return { error: saved.error }
  // A rename can make a room match locations typed before.
  await linkEquipmentToRooms(existing.propertyId)
  revalidatePath(`/assets/properties/${existing.propertyId}`)
  revalidatePath("/assets/equipment")
  return { success: true }
}

export async function deleteRoom(id: string) {
  const session = await auth()
  if (!session) redirect("/login")
  await requireRooms()

  const room = await prisma.room.findUnique({ where: { id }, select: { id: true, name: true, propertyId: true } })
  if (!room) return { error: "Not found" }

  // Equipment keeps where it was: deleting the room clears the link, so its name becomes the free-text location.
  await prisma.$transaction([
    prisma.equipment.updateMany({ where: { roomId: room.id, location: null }, data: { location: room.name } }),
    prisma.room.delete({ where: { id: room.id } }),
  ])
  await removeUploadDir("room", room.id)

  revalidatePath(`/assets/properties/${room.propertyId}`)
  revalidatePath("/assets/equipment")
  return { success: true }
}
