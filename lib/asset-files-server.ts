import type { AssetType } from "@/app/generated/prisma/client"
import { prisma } from "@/lib/prisma"

/// One file for an asset's "Download all files" zip: where it goes inside the
/// zip, and the upload path segments it is read from.
export type AssetFile = { zipPath: string; segments: string[] }

// Folder names inside the zip. originalName is client-supplied, so slashes are
// flattened too — a name like "../../x" must not climb out when unzipped.
const safe = (s: string) => s.replace(/[^a-z0-9]/gi, "_")
const leaf = (s: string) => s.replace(/[\\/]/g, "_")
const day = (d: Date | null | undefined) => (d ? new Date(d).toISOString().split("T")[0] : "unknown")

/// Documents filed on some assets of one type, and the files on their service
/// records, warranties and maintenance schedules. prefix places each asset's files inside the zip.
async function recordFiles(assetType: AssetType, assetIds: string[], prefix: (assetId: string) => string): Promise<AssetFile[]> {
  if (assetIds.length === 0) return []
  const owner = { assetId: { in: assetIds }, assetType }

  const [documentAttachments, serviceAttachments, warrantyAttachments, maintenanceAttachments] = await Promise.all([
    prisma.attachment.findMany({ where: { recordType: "DOCUMENT", ...owner } }),
    prisma.attachment.findMany({
      where: { serviceRecordId: { not: null }, serviceRecord: owner },
      include: { serviceRecord: { select: { title: true, date: true, assetId: true } } },
    }),
    prisma.attachment.findMany({
      where: { warrantyId: { not: null }, warranty: owner },
      include: { warranty: { select: { productName: true, assetId: true } } },
    }),
    prisma.attachment.findMany({
      where: { maintenanceScheduleId: { not: null }, maintenanceSchedule: owner },
      include: { maintenanceSchedule: { select: { title: true, assetId: true } } },
    }),
  ])

  const files: AssetFile[] = []
  for (const a of documentAttachments) {
    files.push({
      zipPath: `${prefix(a.assetId!)}documents/${leaf(a.originalName)}`,
      segments: ["document", a.assetId!, a.filename],
    })
  }
  for (const a of serviceAttachments) {
    files.push({
      zipPath: `${prefix(a.serviceRecord!.assetId)}service/${day(a.serviceRecord?.date)}_${safe(a.serviceRecord?.title ?? "service")}/${leaf(a.originalName)}`,
      segments: ["service", a.serviceRecordId!, a.filename],
    })
  }
  for (const a of warrantyAttachments) {
    files.push({
      zipPath: `${prefix(a.warranty!.assetId)}warranties/${safe(a.warranty?.productName ?? "warranty")}/${leaf(a.originalName)}`,
      segments: ["warranty", a.warrantyId!, a.filename],
    })
  }
  for (const a of maintenanceAttachments) {
    files.push({
      zipPath: `${prefix(a.maintenanceSchedule!.assetId)}maintenance/${safe(a.maintenanceSchedule?.title ?? "reminder")}/${leaf(a.originalName)}`,
      segments: ["maintenance", a.maintenanceScheduleId!, a.filename],
    })
  }
  return files
}

/// Every attachment belonging to an asset. A property's zip also holds the
/// files of the equipment in it, under equipment/<name>/, matching its tabs.
/// Paths may collide; the caller decides how to number duplicates.
export async function collectAssetFiles(assetType: AssetType, id: string): Promise<AssetFile[]> {
  const isPerson = assetType === "PERSON"

  const equipment = assetType === "PROPERTY"
    ? await prisma.equipment.findMany({ where: { propertyId: id }, select: { id: true, name: true } })
    : []
  const equipmentName = new Map(equipment.map((e) => [e.id, e.name]))

  const [ownFiles, equipmentFiles, conditionAttachments, insuranceAttachments, observationAttachments, medicationAttachments, allergyAttachments, immunizationAttachments] = await Promise.all([
    recordFiles(assetType, [id], () => ""),
    recordFiles("EQUIPMENT", equipment.map((e) => e.id), (eid) => `equipment/${safe(equipmentName.get(eid) ?? "equipment")}/`),
    isPerson
      ? prisma.attachment.findMany({
          where: { healthCondition: { personId: id } },
          include: { healthCondition: { select: { name: true } } },
        })
      : Promise.resolve([]),
    isPerson
      ? prisma.attachment.findMany({
          where: { insurancePolicy: { members: { some: { id } } } },
          include: { insurancePolicy: { select: { carrier: true } } },
        })
      : Promise.resolve([]),
    isPerson
      ? prisma.attachment.findMany({
          where: { observation: { personId: id } },
          include: { observation: { select: { type: true, date: true } } },
        })
      : Promise.resolve([]),
    isPerson
      ? prisma.attachment.findMany({
          where: { medication: { personId: id } },
          include: { medication: { select: { name: true } } },
        })
      : Promise.resolve([]),
    isPerson
      ? prisma.attachment.findMany({
          where: { allergy: { personId: id } },
          include: { allergy: { select: { substance: true } } },
        })
      : Promise.resolve([]),
    isPerson
      ? prisma.attachment.findMany({
          where: { immunization: { personId: id } },
          include: { immunization: { select: { vaccine: true } } },
        })
      : Promise.resolve([]),
  ])

  const files: AssetFile[] = [...ownFiles, ...equipmentFiles]
  const add = (zipPath: string, ...segments: string[]) => files.push({ zipPath, segments })

  for (const a of conditionAttachments) {
    add(`conditions/${safe(a.healthCondition?.name ?? "condition")}/${leaf(a.originalName)}`, "condition", a.healthConditionId!, a.filename)
  }
  for (const a of insuranceAttachments) {
    add(`insurance/${safe(a.insurancePolicy?.carrier ?? "policy")}/${leaf(a.originalName)}`, "insurance", a.insurancePolicyId!, a.filename)
  }
  for (const a of observationAttachments) {
    add(`observations/${day(a.observation?.date)}_${safe(a.observation?.type ?? "observation")}/${leaf(a.originalName)}`, "observation", a.observationId!, a.filename)
  }
  for (const a of medicationAttachments) {
    add(`medications/${safe(a.medication?.name ?? "medication")}/${leaf(a.originalName)}`, "medication", a.medicationId!, a.filename)
  }
  for (const a of allergyAttachments) {
    add(`allergies/${safe(a.allergy?.substance ?? "allergy")}/${leaf(a.originalName)}`, "allergy", a.allergyId!, a.filename)
  }
  for (const a of immunizationAttachments) {
    add(`immunizations/${safe(a.immunization?.vaccine ?? "immunization")}/${leaf(a.originalName)}`, "immunization", a.immunizationId!, a.filename)
  }

  return files
}
