import { notFound } from "next/navigation"
import { cache } from "react"
import { prisma } from "@/lib/prisma"
import { DEFAULT_FEATURES, HEALTH_NOTIFICATION_TYPES, type Features } from "@/lib/features"
import type { Prisma } from "@/app/generated/prisma/client"

export const FEATURE_SETTINGS_ID = "singleton"

/** The saved switches, or the defaults (everything on) when nobody has saved them. Once per request. */
export const loadFeatures = cache(async (): Promise<Features> => {
  const row = await prisma.featureSettings.findUnique({ where: { id: FEATURE_SETTINGS_ID } })
  return {
    health: row?.healthEnabled ?? DEFAULT_FEATURES.health,
    rooms: row?.roomsEnabled ?? DEFAULT_FEATURES.rooms,
  }
})

/**
 * Where-clause for a user's notifications. With Health off: none of the health
 * types, and none about a person's reminders or warranties.
 */
export async function visibleNotificationsWhere(features: Features): Promise<Prisma.NotificationWhereInput> {
  if (features.health) return {}
  const [schedules, warranties] = await Promise.all([
    prisma.maintenanceSchedule.findMany({ where: { assetType: "PERSON" }, select: { id: true } }),
    prisma.warranty.findMany({ where: { assetType: "PERSON" }, select: { id: true } }),
  ])
  const personOwned = [...schedules, ...warranties].map((r) => r.id)
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
