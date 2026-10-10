import { prisma } from "@/lib/prisma"
import type { AssetType } from "@/app/generated/prisma/client"
import type { TemplateAsset } from "@/lib/maintenance-templates"

export type TemplateTarget = {
  asset: TemplateAsset
  name: string
  /** Odometer or hour meter; vehicles only. */
  currentReading: number | null
  /** Schedule titles the asset already has, lowercased, so the picker can leave them unchecked. */
  existingTitles: string[]
}

/** The asset the default reminders are for, or null when it doesn't exist or takes none (people). */
export async function loadTemplateTarget(assetType: AssetType, assetId: string): Promise<TemplateTarget | null> {
  const base = await (async () => {
    switch (assetType) {
      case "PROPERTY": {
        const p = await prisma.property.findUnique({ where: { id: assetId }, select: { name: true, type: true } })
        return p && { asset: { type: "PROPERTY" as const, propertyType: p.type }, name: p.name, currentReading: null }
      }
      case "VEHICLE": {
        const v = await prisma.vehicle.findUnique({ where: { id: assetId }, select: { name: true, meterUnit: true, currentMileage: true } })
        return v && { asset: { type: "VEHICLE" as const, meterUnit: v.meterUnit }, name: v.name, currentReading: v.currentMileage }
      }
      case "EQUIPMENT": {
        const e = await prisma.equipment.findUnique({ where: { id: assetId }, select: { name: true, category: true } })
        return e && { asset: { type: "EQUIPMENT" as const, category: e.category }, name: e.name, currentReading: null }
      }
      case "PERSON":
        return null
    }
  })()
  if (!base) return null
  const existing = await prisma.maintenanceSchedule.findMany({ where: { assetType, assetId }, select: { title: true } })
  return { ...base, existingTitles: existing.map((s) => s.title.trim().toLowerCase()) }
}
