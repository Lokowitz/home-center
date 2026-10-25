import { notFound } from "next/navigation"
import { cache } from "react"
import { prisma } from "@/lib/prisma"
import { DEFAULT_FEATURES, HEALTH_NOTIFICATION_TYPES, type Features } from "@/lib/features"
import type { Prisma } from "@/app/generated/prisma/client"
import { HEALTH_INSURANCE_KINDS } from "@/lib/insurance"

export const FEATURE_SETTINGS_ID = "singleton"

/** The saved switches, or the defaults (everything on) when nobody has saved them. Once per request. */
const featureRow = cache(() => prisma.featureSettings.findUnique({ where: { id: FEATURE_SETTINGS_ID } }))

/** Whether the top-bar property filter is on (default off). Shares the row with loadFeatures. */
export const loadPropertyFilterEnabled = cache(async (): Promise<boolean> => {
  return (await featureRow())?.propertyFilterEnabled ?? false
})

export const loadFeatures = cache(async (): Promise<Features> => {
  const row = await featureRow()
  return {
    health: row?.healthEnabled ?? DEFAULT_FEATURES.health,
    rooms: row?.roomsEnabled ?? DEFAULT_FEATURES.rooms,
    equipmentTab: row?.equipmentTabEnabled ?? DEFAULT_FEATURES.equipmentTab,
  }
})

/**
 * Where-clause for a user's notifications. With Health off: none of the health
 * types, and none about a person's reminders or warranties.
 */
export async function visibleNotificationsWhere(features: Features): Promise<Prisma.NotificationWhereInput> {
  if (features.health) return {}
  const [schedules, warranties, policies] = await Promise.all([
    prisma.maintenanceSchedule.findMany({ where: { assetType: "PERSON" }, select: { id: true } }),
    prisma.warranty.findMany({ where: { assetType: "PERSON" }, select: { id: true } }),
    // A renewal raised before the policy's kind changed to a health kind.
    prisma.insurancePolicy.findMany({ where: { kind: { in: [...HEALTH_INSURANCE_KINDS] } }, select: { id: true } }),
  ])
  const personOwned = [...schedules, ...warranties, ...policies].map((r) => r.id)
  return {
    type: { notIn: [...HEALTH_NOTIFICATION_TYPES] },
    // notIn alone would also drop notifications with no related entity (SQL NULL).
    ...(personOwned.length ? { OR: [{ relatedEntityId: null }, { relatedEntityId: { notIn: personOwned } }] } : {}),
  }
}

/** For Health's own pages: a 404 while Health is off. */
export async function requireHealth(): Promise<void> {
  if (!(await loadFeatures()).health) notFound()
}

/** For Rooms' own pages and actions: a 404 while Rooms is off. */
export async function requireRooms(): Promise<void> {
  if (!(await loadFeatures()).rooms) notFound()
}
