import { prisma } from "@/lib/prisma"
import { assetHref } from "@/lib/assets"
import { INTAKE_NUDGE_ENTITY } from "@/lib/notifications/intake-nudge"
import { BACKUP_ENTITY } from "@/lib/backup/alerts-server"
import type { Notification } from "@/app/generated/prisma/client"

const ASSET_TAB: Record<string, string> = { MaintenanceSchedule: "maintenance", Warranty: "warranties" }
const PERSON_TAB: Record<string, string> = { Medication: "medications", Immunization: "immunizations" }

// Maps a notification to where clicking it should go: the asset (or person)
// detail page, on the tab that holds the record, with `open` set so that
// page can pop the edit dialog for it. One batched lookup per entity type
// instead of a query per notification.
export async function resolveNotificationHrefs(notifications: Notification[]): Promise<Map<string, string>> {
  const idsOf = (type: string) =>
    [...new Set(notifications.filter((n) => n.relatedEntityType === type).map((n) => n.relatedEntityId!))]

  const maintIds = idsOf("MaintenanceSchedule")
  const warrantyIds = idsOf("Warranty")
  const medIds = idsOf("Medication")
  const immIds = idsOf("Immunization")

  const [schedules, warranties, medications, immunizations] = await Promise.all([
    maintIds.length ? prisma.maintenanceSchedule.findMany({ where: { id: { in: maintIds } }, select: { id: true, assetType: true, assetId: true } }) : [],
    warrantyIds.length ? prisma.warranty.findMany({ where: { id: { in: warrantyIds } }, select: { id: true, assetType: true, assetId: true } }) : [],
    medIds.length ? prisma.medication.findMany({ where: { id: { in: medIds } }, select: { id: true, personId: true } }) : [],
    immIds.length ? prisma.immunization.findMany({ where: { id: { in: immIds } }, select: { id: true, personId: true } }) : [],
  ])

  const assetById = new Map([...schedules, ...warranties].map((r) => [r.id, r]))
  const personById = new Map([...medications, ...immunizations].map((r) => [r.id, r.personId]))

  const links = new Map<string, string>()
  for (const n of notifications) {
    const type = n.relatedEntityType
    const id = n.relatedEntityId
    // The Intake nudge is about the whole Intake, not one record.
    if (type === INTAKE_NUDGE_ENTITY) {
      links.set(n.id, "/intake")
      continue
    }
    if (type === BACKUP_ENTITY) {
      links.set(n.id, "/settings?tab=data")
      continue
    }
    if (!type || !id) continue

    if (type in ASSET_TAB) {
      const asset = assetById.get(id)
      if (asset) links.set(n.id, `${assetHref(asset.assetType, asset.assetId)}?tab=${ASSET_TAB[type]}&open=${id}`)
    } else if (type in PERSON_TAB) {
      const personId = personById.get(id)
      if (personId) links.set(n.id, `/assets/people/${personId}?tab=${PERSON_TAB[type]}&open=${id}`)
    } else if (type === "InsurancePolicy") {
      links.set(n.id, `/insurance?open=${id}`)
    }
  }
  return links
}
