import { prisma } from "@/lib/prisma"
import { removeUploadDir } from "@/lib/upload-fs"

type OwnedAssetType = "PROPERTY" | "VEHICLE" | "EQUIPMENT"

const UPLOAD_DIR: Record<OwnedAssetType, string> = {
  PROPERTY: "properties",
  VEHICLE: "vehicles",
  EQUIPMENT: "equipment",
}

/// Deletes a property, vehicle or equipment item with its service records,
/// warranties, maintenance schedules and documents. Those are keyed polymorphically with
/// no foreign key, so the asset's own delete can't cascade to them — they go in
/// the same transaction, and the records' attachments follow by cascade. A property's
/// equipment is its own asset and is kept, unlinked (onDelete: SetNull).
/// Throws if the asset doesn't exist, leaving everything untouched.
export async function deleteAssetWithRecords(assetType: OwnedAssetType, id: string): Promise<void> {
  const where = { assetType, assetId: id }
  // Rooms cascade in the DB, so their ids have to be read first to clear their upload dirs.
  const rooms = assetType === "PROPERTY" ? await prisma.room.findMany({ where: { propertyId: id }, select: { id: true } }) : []
  const [services, warranties, schedules] = await Promise.all([
    prisma.serviceRecord.findMany({ where, select: { id: true } }),
    prisma.warranty.findMany({ where, select: { id: true } }),
    prisma.maintenanceSchedule.findMany({ where, select: { id: true } }),
  ])

  const deleteAsset =
    assetType === "PROPERTY" ? prisma.property.delete({ where: { id } })
    : assetType === "VEHICLE" ? prisma.vehicle.delete({ where: { id } })
    : prisma.equipment.delete({ where: { id } })

  await prisma.$transaction([
    prisma.serviceRecord.deleteMany({ where }),
    prisma.warranty.deleteMany({ where }),
    prisma.maintenanceSchedule.deleteMany({ where }),
    prisma.attachment.deleteMany({ where: { ...where, recordType: "DOCUMENT" } }),
    deleteAsset,
  ])

  const dirs: [string, string][] = [
    [UPLOAD_DIR[assetType], id],
    ["document", id],
    ...rooms.map((r): [string, string] => ["room", r.id]),
    ...services.map((s): [string, string] => ["service", s.id]),
    ...warranties.map((w): [string, string] => ["warranty", w.id]),
    ...schedules.map((m): [string, string] => ["maintenance", m.id]),
  ]
  for (const dir of dirs) await removeUploadDir(...dir)
}
