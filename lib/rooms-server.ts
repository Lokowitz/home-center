import { prisma } from "@/lib/prisma"
import { loadFeatures } from "@/lib/features-server"
import type { AssetType } from "@/app/generated/prisma/client"

export type RoomOption = { id: string; name: string }

/** The property a room link on this asset points into: the property itself, or the one an equipment item is on. */
async function targetPropertyId(assetType: AssetType, assetId: string): Promise<string | null> {
  if (assetType === "PROPERTY") return assetId
  if (assetType === "EQUIPMENT") {
    const e = await prisma.equipment.findUnique({ where: { id: assetId }, select: { propertyId: true } })
    return e?.propertyId ?? null
  }
  return null
}

/** Rooms an asset's room select may offer, by name. Empty when Rooms is off or the asset has no property. */
export async function roomOptionsFor(assetType: AssetType, assetId: string): Promise<RoomOption[]> {
  if (!(await loadFeatures()).rooms) return []
  const propertyId = await targetPropertyId(assetType, assetId)
  if (!propertyId) return []
  return prisma.room.findMany({ where: { propertyId }, select: { id: true, name: true }, orderBy: { name: "asc" } })
}

export type PropertyWithRooms = { id: string; name: string; rooms: RoomOption[] }

/** Every property with its rooms, for the equipment dialog's property select and location suggestions. Rooms empty when Rooms is off. */
export async function propertiesWithRooms(): Promise<PropertyWithRooms[]> {
  const [{ rooms: on }, properties] = await Promise.all([
    loadFeatures(),
    prisma.property.findMany({
      select: { id: true, name: true, rooms: { select: { id: true, name: true }, orderBy: { name: "asc" } } },
      orderBy: { name: "asc" },
    }),
  ])
  return on ? properties : properties.map((p) => ({ ...p, rooms: [] }))
}

/** Validates a client-sent roomId against the target's property. Blank means no room. */
export async function checkRoom(
  roomId: string | null | undefined,
  assetType: AssetType,
  assetId: string,
): Promise<{ roomId: string | null } | { error: string }> {
  if (!roomId?.trim()) return { roomId: null }
  const error = "That room isn't on this property."
  const propertyId = await targetPropertyId(assetType, assetId)
  if (!propertyId) return { error }
  const room = await prisma.room.findUnique({ where: { id: roomId }, select: { propertyId: true } })
  if (!room || room.propertyId !== propertyId) return { error }
  return { roomId }
}
