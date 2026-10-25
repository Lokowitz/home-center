import { prisma } from "@/lib/prisma"
import { listInboxItems } from "@/lib/inbox-server"
import { loadFeatures } from "@/lib/features-server"
import { ownedWhere } from "@/lib/features"
import { equipmentScopeWhere, ownedScopeWhere, personScopeWhere, propertyScopeWhere, vehicleScopeWhere } from "@/lib/property-filter"
import { loadPropertyScope } from "@/lib/property-filter-server"
import { InboxDropZone } from "@/components/inbox/inbox-drop-zone"
import { InboxList } from "@/components/inbox/inbox-list"
import type { InboxAssetOption, InboxReminderOption } from "@/components/inbox/asset-select"

// Shown as "Intake" (route /intake; /inbox redirects here). The database, files and code keep the internal name "inbox".
export default async function IntakePage() {
  const features = await loadFeatures()
  const scope = await loadPropertyScope()
  const byName = { select: { id: true, name: true }, orderBy: { name: "asc" } } as const
  // "Completes reminder" offers active (not paused) reminders only; each receipt's text is matched against them.
  const schedules = await prisma.maintenanceSchedule.findMany({
    where: { isActive: true, ...ownedWhere(features), ...ownedScopeWhere(scope) },
    select: { id: true, title: true, assetType: true, assetId: true },
    orderBy: { title: "asc" },
  })
  // Items all stay; only the pickers and suggestions follow the property filter.
  const [{ items, householdNames }, properties, vehicles, equipment, people] = await Promise.all([
    listInboxItems(new Date(), { reminders: schedules, scope }),
    prisma.property.findMany({ ...byName, where: propertyScopeWhere(scope) }),
    prisma.vehicle.findMany({ where: vehicleScopeWhere(scope), select: { id: true, name: true, meterUnit: true }, orderBy: { name: "asc" } }),
    prisma.equipment.findMany({ ...byName, where: equipmentScopeWhere(scope) }),
    // People go with the rest of Health.
    features.health ? prisma.person.findMany({ ...byName, where: personScopeWhere(scope) }) : Promise.resolve([]),
  ])

  const assets: InboxAssetOption[] = [
    ...properties.map((p) => ({ type: "PROPERTY" as const, id: p.id, name: p.name })),
    ...vehicles.map((v) => ({ type: "VEHICLE" as const, id: v.id, name: v.name, meterUnit: v.meterUnit })),
    ...equipment.map((e) => ({ type: "EQUIPMENT" as const, id: e.id, name: e.name })),
    ...people.map((p) => ({ type: "PERSON" as const, id: p.id, name: p.name })),
  ]
  const reminders: InboxReminderOption[] = schedules

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Intake</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Drop receipts, invoices and manuals here. HomeCenter reads them and suggests where they go. You can also drop files on any page.
        </p>
      </div>
      <InboxDropZone />
      <InboxList items={items} householdNames={householdNames} assets={assets} reminders={reminders} />
    </div>
  )
}
