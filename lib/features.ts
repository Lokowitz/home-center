import type { NotificationType } from "@/app/generated/prisma/enums"

// Optional parts of the site (Settings → Features). Pure helpers here; the
// loader is in features-server.ts.

export type Features = { health: boolean; rooms: boolean; equipmentTab: boolean }

export const DEFAULT_FEATURES: Features = { health: true, rooms: true, equipmentTab: true }

/**
 * Where-clause for service records, warranties and maintenance schedules: with
 * Health off, nothing owned by a person.
 */
export function ownedWhere(features: Features): { assetType?: { not: "PERSON" } } {
  return features.health ? {} : { assetType: { not: "PERSON" } }
}

/** Notification types that only exist for health data. */
export const HEALTH_NOTIFICATION_TYPES: readonly NotificationType[] = [
  "MEDICATION_REFILL",
  "IMMUNIZATION_DUE",
  "INSURANCE_EXPIRING",
]

/** Pages that belong to Health. */
export const HEALTH_PATHS = ["/assets/people", "/providers"] as const

export function isHealthPath(href: string): boolean {
  return HEALTH_PATHS.some((p) => href === p || href.startsWith(`${p}/`) || href.startsWith(`${p}?`))
}
