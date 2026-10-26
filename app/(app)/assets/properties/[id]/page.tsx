import { prisma } from "@/lib/prisma"
import { DropPageAsset } from "@/components/drop/drop-provider"
import { notFound } from "next/navigation"
import Link from "next/link"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { MapPin, Calendar, DollarSign, Maximize, Download, Home, FileText } from "lucide-react"
import { ServiceRecordList } from "@/components/service-records/service-record-list"
import { WarrantyList } from "@/components/warranties/warranty-list"
import { MaintenanceList } from "@/components/maintenance/maintenance-list"
import { loadManualOptions } from "@/lib/manual-reference-server"
import { AssetDocuments } from "@/components/attachments/asset-documents"
import { AssetImageUploader } from "@/components/asset-image-uploader"
import { PropertyEditButton } from "@/components/properties/property-edit-button"
import { AssetCostPanel } from "@/components/costs/asset-cost-panel"
import { AssetInsurance } from "@/components/insurance/asset-insurance"
import { loadAssetPolicies, loadPolicyChoices } from "@/lib/insurance-server"
import { belongingsComparison } from "@/lib/insurance"
import { equipmentValueTotals } from "@/lib/equipment-value"
import { getFormat } from "@/lib/regional-server"
import { loadFeatures } from "@/lib/features-server"
import { RoomList } from "@/components/rooms/room-list"
import { PropertyEquipment } from "@/components/equipment/property-equipment"
import { HiddenByFilter } from "@/components/hidden-by-filter"
import { assetInScope } from "@/lib/property-filter"
import { loadPropertyScope } from "@/lib/property-filter-server"

const typeLabel: Record<string, string> = {
  HOUSE: "House", CONDO: "Condo", TOWNHOUSE: "Townhouse", LOT: "Lot / Land", OTHER: "Other",
}

export default async function PropertyDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ tab?: string; open?: string }>
}) {
  const { id } = await params
  const fmt = await getFormat()
  const { tab, open } = await searchParams
  const property = await prisma.property.findUnique({ where: { id } })
  if (!property) notFound()

  const scope = await loadPropertyScope()
  if (!assetInScope(scope, "PROPERTY", id)) return <HiddenByFilter propertyName={scope!.propertyName} ownerName={property.name} />

  const [propertyServiceRecords, propertyWarranties, propertyMaintenanceSchedules, equipment, documents, features, policies, policyChoices] = await Promise.all([
    prisma.serviceRecord.findMany({ where: { assetId: id, assetType: "PROPERTY" }, include: { attachments: true }, orderBy: { date: "desc" } }),
    prisma.warranty.findMany({ where: { assetId: id, assetType: "PROPERTY" }, include: { attachments: true }, orderBy: { expirationDate: "asc" } }),
    prisma.maintenanceSchedule.findMany({ where: { assetId: id, assetType: "PROPERTY" }, include: { attachments: true }, orderBy: { nextDueDate: "asc" } }),
    prisma.equipment.findMany({ where: { propertyId: id }, include: { room: { select: { name: true } } }, orderBy: { name: "asc" } }),
    prisma.attachment.findMany({ where: { recordType: "DOCUMENT", assetType: "PROPERTY", assetId: id }, orderBy: { uploadedAt: "asc" } }),
    loadFeatures(),
    loadAssetPolicies("PROPERTY", id),
    loadPolicyChoices("properties", false, scope),
  ])
  const { rooms, roomServiceRecords, roomSchedules } = features.rooms ? await loadRooms(id) : { rooms: [], roomServiceRecords: [], roomSchedules: [] }
  // For the room selects and badges on the Service and Maintenance tabs; empty with Rooms off.
  const roomOptions = rooms.map((r) => ({ id: r.id, name: r.name }))

  const equipmentIds = equipment.map((e) => e.id)

  // The manuals need the equipment ids, so they load beside the equipment's own records.
  const [[equipmentServiceRecords, equipmentWarranties, equipmentMaintenanceSchedules], manualOptions] = await Promise.all([
    equipmentIds.length
    ? Promise.all([
        prisma.serviceRecord.findMany({
          where: { assetId: { in: equipmentIds }, assetType: "EQUIPMENT" },
          include: { attachments: true },
          orderBy: { date: "desc" },
        }),
        prisma.warranty.findMany({
          where: { assetId: { in: equipmentIds }, assetType: "EQUIPMENT" },
          include: { attachments: true },
          orderBy: { expirationDate: "asc" },
        }),
        prisma.maintenanceSchedule.findMany({
          where: { assetId: { in: equipmentIds }, assetType: "EQUIPMENT" },
          include: { attachments: true },
          orderBy: { nextDueDate: "asc" },
        }),
      ])
    : [[], [], []],
    loadManualOptions([
      { assetType: "PROPERTY", assetId: id },
      ...equipmentIds.map((e) => ({ assetType: "EQUIPMENT" as const, assetId: e })),
    ]),
  ])

  const serviceRecords = [...propertyServiceRecords, ...equipmentServiceRecords]
  const warranties = [...propertyWarranties, ...equipmentWarranties]
  const maintenanceSchedules = [...propertyMaintenanceSchedules, ...equipmentMaintenanceSchedules]

  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
      {/* Files dropped anywhere on this page go to Intake for this property. */}
      <DropPageAsset assetType="PROPERTY" assetId={id} name={property.name} />
      <aside className="space-y-4 lg:w-72 lg:shrink-0">
        <AssetImageUploader assetType="PROPERTY" assetId={id} imageFilename={property.imageFilename} alt={property.name} />

        <div className="space-y-2">
          <Stat icon={Home} label="Type" value={typeLabel[property.type]} />
          <Stat icon={MapPin} label="Address" value={property.address} />
          {property.yearBuilt && <Stat icon={Calendar} label="Year Built" value={property.yearBuilt.toString()} />}
          {property.sqFt && <Stat icon={Maximize} label={fmt.areaLabel} value={fmt.area(property.sqFt)} />}
          {property.purchasePrice && <Stat icon={DollarSign} label="Purchase Price" value={fmt.moneyWhole(property.purchasePrice)} />}
          {property.purchaseDate && <Stat icon={Calendar} label="Purchased" value={fmt.date(property.purchaseDate, { utc: true })} />}
        </div>

        <AssetInsurance policies={policies} belongings={belongingsComparison(equipmentValueTotals(equipment).CONTENTS, policies)} />
        <AssetCostPanel assetType="PROPERTY" assetId={id} purchasePrice={property.purchasePrice} ownedSince={property.purchaseDate} equipmentIds={equipmentIds} />

        {property.notes && (
          <div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground whitespace-pre-wrap">
            {property.notes}
          </div>
        )}
      </aside>

      <div className="min-w-0 flex-1 space-y-4">
        <div className="flex flex-col gap-2 xl:flex-row xl:items-start xl:justify-between xl:gap-4">
          <h1 className="min-w-0 break-words font-heading text-2xl font-semibold">{property.name}</h1>
          <div className="flex flex-wrap items-center gap-2 xl:shrink-0">
            <PropertyEditButton property={property} policyChoices={policyChoices} policyIds={policies.map((p) => p.id)} />
            <Link
              href={`/reports/properties/${id}`}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md border bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted transition-colors"
            >
              <FileText className="h-3.5 w-3.5" /> Report
            </Link>
            <a
              href={`/api/assets/properties/${id}/download`}
              download
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md border bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted transition-colors"
            >
              <Download className="h-3.5 w-3.5" /> Download all files
            </a>
          </div>
        </div>

        {/* Keyed on the tab and open params so a link to ?tab=…&open=… from inside this page (a room's history) switches tabs, even to the tab already showing. */}
        <Tabs key={`${tab ?? ""}:${open ?? ""}`} defaultValue={(tab === "rooms" && !features.rooms) || (tab === "equipment" && !features.equipmentTab) ? "service" : tab ?? "service"}>
          <TabsList variant="line" className="w-full justify-start border-b overflow-x-auto">
            <TabsTrigger value="service">Service ({serviceRecords.length})</TabsTrigger>
            <TabsTrigger value="warranties">Warranties ({warranties.length})</TabsTrigger>
            {features.rooms && <TabsTrigger value="rooms">Rooms ({rooms.length})</TabsTrigger>}
            {features.equipmentTab && <TabsTrigger value="equipment">Equipment ({equipment.length})</TabsTrigger>}
            <TabsTrigger value="maintenance">Maintenance Reminders ({maintenanceSchedules.length})</TabsTrigger>
            <TabsTrigger value="documents">Documents ({documents.length})</TabsTrigger>
          </TabsList>
          <TabsContent value="service" className="mt-4">
            <ServiceRecordList records={serviceRecords} assetId={id} assetType="PROPERTY" equipment={equipment} propertyName={property.name} roomOptions={roomOptions} reminders={maintenanceSchedules} openId={tab === "service" ? open : undefined} scopeToggle={equipment.length > 0 ? { ownLabel: "Property only", withLabel: "Property + equipment" } : undefined} />
          </TabsContent>
          <TabsContent value="warranties" className="mt-4">
            <WarrantyList warranties={warranties} assetId={id} assetType="PROPERTY" equipment={equipment} propertyName={property.name} openId={tab === "warranties" ? open : undefined} />
          </TabsContent>
          {features.rooms && (
            <TabsContent value="rooms" className="mt-4">
              <RoomList rooms={rooms} propertyId={id} propertyName={property.name} showEquipment={features.equipmentTab} propertyEquipment={equipment.map((e) => ({ id: e.id, name: e.name, roomId: e.roomId }))} reminderOptions={maintenanceSchedules.map((m) => ({ id: m.id, title: m.title, assetType: m.assetType, assetId: m.assetId }))} serviceRecords={roomServiceRecords} schedules={roomSchedules} openId={tab === "rooms" ? open : undefined} />
            </TabsContent>
          )}
          {features.equipmentTab && (
            <TabsContent value="equipment" className="mt-4">
              <PropertyEquipment equipment={equipment} property={{ id, name: property.name, rooms: roomOptions }} openId={tab === "equipment" ? open : undefined} />
            </TabsContent>
          )}
          <TabsContent value="maintenance" className="mt-4">
            <MaintenanceList schedules={maintenanceSchedules} assetId={id} assetType="PROPERTY" equipment={equipment} propertyName={property.name} roomOptions={roomOptions} manualOptions={manualOptions} openId={tab === "maintenance" ? open : undefined} />
          </TabsContent>
          <TabsContent value="documents" className="mt-4">
            <AssetDocuments assetId={id} documents={documents} hint="Deed, survey, closing papers, floor plans: files for the property itself, not one service." />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}

/** The property's rooms, plus the history the room dialog lists: records tagged with a room or on equipment in one. */
async function loadRooms(propertyId: string) {
  const rooms = await prisma.room.findMany({
    where: { propertyId },
    include: {
      paints: { orderBy: { sortOrder: "asc" } },
      attachments: { orderBy: { uploadedAt: "asc" } },
      equipment: { include: { room: { select: { name: true } } }, orderBy: { name: "asc" } },
    },
    orderBy: { name: "asc" },
  })
  const roomIds = rooms.map((r) => r.id)
  const roomEquipmentIds = rooms.flatMap((r) => r.equipment.map((e) => e.id))
  if (!roomIds.length) return { rooms, roomServiceRecords: [], roomSchedules: [] }

  const where = {
    OR: [
      { roomId: { in: roomIds } },
      ...(roomEquipmentIds.length ? [{ assetType: "EQUIPMENT" as const, assetId: { in: roomEquipmentIds } }] : []),
    ],
  }
  const [roomServiceRecords, roomSchedules] = await Promise.all([
    prisma.serviceRecord.findMany({ where, include: { attachments: true }, orderBy: { date: "desc" } }),
    prisma.maintenanceSchedule.findMany({ where, select: { id: true, title: true, nextDueDate: true, assetType: true, assetId: true, roomId: true }, orderBy: { nextDueDate: "asc" } }),
  ])
  return { rooms, roomServiceRecords, roomSchedules }
}

function Stat({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border bg-card px-3 py-2">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0">
        <Icon className="h-3.5 w-3.5" /> {label}
      </div>
      <div className="min-w-0 break-words font-semibold text-sm text-right">{value}</div>
    </div>
  )
}
