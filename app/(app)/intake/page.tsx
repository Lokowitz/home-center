import { prisma } from "@/lib/prisma"
import { listInboxItems } from "@/lib/inbox-server"
import { loadFeatures } from "@/lib/features-server"
import { ownedWhere } from "@/lib/features"
import { InboxDropZone } from "@/components/inbox/inbox-drop-zone"
import { InboxList } from "@/components/inbox/inbox-list"
import type { InboxAssetOption, InboxReminderOption } from "@/components/inbox/asset-select"

// Shown as "Intake" (route /intake; /inbox redirects here). The database, files and code keep the internal name "inbox".
export default async function IntakePage() {
  const features = await loadFeatures()
  const byName = { select: { id: true, name: true }, orderBy: { name: "asc" } } as const
  const [{ items, householdNames }, properties, vehicles, equipment, people, schedules] = await Promise.all([
    listInboxItems(),
    prisma.property.findMany(byName),
    prisma.vehicle.findMany({ select: { id: true, name: true, meterUnit: true }, orderBy: { name: "asc" } }),
    prisma.equipment.findMany(byName),
    // People go with the rest of Health.
    features.health ? prisma.person.findMany(byName) : Promise.resolve([]),
    // "Completes reminder" offers active (not paused) reminders only.
    prisma.maintenanceSchedule.findMany({
      where: { isActive: true, ...ownedWhere(features) },
      select: { id: true, title: true, assetType: true, assetId: true },
      orderBy: { title: "asc" },
    }),
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
