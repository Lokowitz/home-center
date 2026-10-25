import { prisma } from "@/lib/prisma"
import { loadFeatures } from "@/lib/features-server"
import { planRoomLinks } from "@/lib/rooms"
import type { AssetType } from "@/app/generated/prisma/client"
import { propertyScopeWhere, type PropertyScope } from "@/lib/property-filter"

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

/**
 * Links a property's equipment whose free-text location names one of its rooms (before there were rooms, or
 * before this room existed). The text becomes the link: location is cleared, as for any room-linked item.
 * Returns how many items were linked.
 */
export async function linkEquipmentToRooms(propertyId: string): Promise<number> {
  const [rooms, equipment] = await Promise.all([
    prisma.room.findMany({ where: { propertyId }, select: { id: true, name: true } }),
    prisma.equipment.findMany({ where: { propertyId, roomId: null, location: { not: null } }, select: { id: true, roomId: true, location: true } }),
  ])
  const plan = planRoomLinks(rooms, equipment)
  if (plan.length) {
    await prisma.$transaction(plan.map((p) => prisma.equipment.update({ where: { id: p.equipmentId }, data: { roomId: p.roomId, location: null } })))
  }
  return plan.length
}

export type PropertyWithRooms = { id: string; name: string; rooms: RoomOption[] }

/** Every in-scope property with its rooms, for the equipment dialog's property select and location suggestions. Rooms empty when Rooms is off. */
export async function propertiesWithRooms(scope: PropertyScope | null = null): Promise<PropertyWithRooms[]> {
  const [{ rooms: on }, properties] = await Promise.all([
    loadFeatures(),
    prisma.property.findMany({
      where: propertyScopeWhere(scope),
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
