import { prisma } from "@/lib/prisma"
import { DropPageAsset } from "@/components/drop/drop-provider"
import { notFound } from "next/navigation"
import Link from "next/link"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Calendar, Download, Factory, Tag, Fingerprint, MapPin, Building2, DollarSign, Wrench, FileText, Hourglass } from "lucide-react"
import { ServiceRecordList } from "@/components/service-records/service-record-list"
import { WarrantyList } from "@/components/warranties/warranty-list"
import { MaintenanceList } from "@/components/maintenance/maintenance-list"
import { loadManualOptions } from "@/lib/manual-reference-server"
import { AssetDocuments } from "@/components/attachments/asset-documents"
import { AssetImageUploader } from "@/components/asset-image-uploader"
import { EquipmentEditButton } from "@/components/equipment/equipment-edit-button"
import { PlanReplacementButton } from "@/components/equipment/plan-replacement-button"
import { ageLabel, equipmentAge, localDay } from "@/lib/equipment-life"
import { categoryLabel } from "@/components/equipment/categories"
import { AssetCostPanel } from "@/components/costs/asset-cost-panel"
import { getFormat } from "@/lib/regional-server"
import { propertiesWithRooms, roomOptionsFor } from "@/lib/rooms-server"
import { locationLabel } from "@/lib/rooms"

export default async function EquipmentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ tab?: string; open?: string }>
}) {
  const { id } = await params
  const fmt = await getFormat()
  const { tab, open } = await searchParams
  const equipment = await prisma.equipment.findUnique({
    where: { id },
    include: { property: { select: { id: true, name: true } }, room: { select: { name: true } } },
  })
  if (!equipment) notFound()

  const [serviceRecords, warranties, maintenanceSchedules, properties, documents, roomOptions, manualOptions] = await Promise.all([
    prisma.serviceRecord.findMany({ where: { assetId: id, assetType: "EQUIPMENT" }, include: { attachments: true }, orderBy: { date: "desc" } }),
    prisma.warranty.findMany({ where: { assetId: id, assetType: "EQUIPMENT" }, include: { attachments: true }, orderBy: { expirationDate: "asc" } }),
    prisma.maintenanceSchedule.findMany({ where: { assetId: id, assetType: "EQUIPMENT" }, include: { attachments: true }, orderBy: { nextDueDate: "asc" } }),
    propertiesWithRooms(),
    prisma.attachment.findMany({ where: { recordType: "DOCUMENT", assetType: "EQUIPMENT", assetId: id }, orderBy: { uploadedAt: "asc" } }),
    // Rooms of its property, for the room selects and badges; empty with Rooms off or no property.
    roomOptionsFor("EQUIPMENT", id),
    loadManualOptions([{ assetType: "EQUIPMENT", assetId: id }]),
  ])

  const age = equipmentAge(equipment, localDay(new Date()))

  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
      {/* Files dropped anywhere on this page go to Intake for this equipment. */}
      <DropPageAsset assetType="EQUIPMENT" assetId={id} name={equipment.name} />
      <aside className="space-y-4 lg:w-72 lg:shrink-0">
        <AssetImageUploader assetType="EQUIPMENT" assetId={id} imageFilename={equipment.imageFilename} alt={equipment.name} />

        <div className="space-y-2">
          <Stat icon={Wrench} label="Category" value={categoryLabel(equipment.category)} />
          {equipment.manufacturer && <Stat icon={Factory} label="Manufacturer" value={equipment.manufacturer} />}
          {equipment.modelNumber && <Stat icon={Tag} label="Model" value={equipment.modelNumber} mono />}
          {equipment.serialNumber && <Stat icon={Fingerprint} label="Serial" value={equipment.serialNumber} mono />}
          {locationLabel(equipment) && <Stat icon={MapPin} label="Location" value={locationLabel(equipment)} />}
          {equipment.property && (
            <Stat
              icon={Building2}
              label="Property"
              value={
                <Link href={`/assets/properties/${equipment.property.id}`} className="hover:underline">
                  {equipment.property.name}
                </Link>
              }
            />
          )}
          {equipment.installDate && <Stat icon={Calendar} label="Installed" value={fmt.date(equipment.installDate)} />}
          {equipment.purchaseDate && <Stat icon={Calendar} label="Purchased" value={fmt.date(equipment.purchaseDate)} />}
          {age && (
            <Stat
              icon={Hourglass}
              label="Age"
              value={age.pastLife ? <span className="text-amber-700 dark:text-amber-400">{ageLabel(age)}</span> : ageLabel(age)}
            />
          )}
          {equipment.purchasePrice != null && (
            <Stat icon={DollarSign} label="Price" value={fmt.moneyWhole(equipment.purchasePrice)} />
          )}
        </div>

        <AssetCostPanel assetType="EQUIPMENT" assetId={id} purchasePrice={equipment.purchasePrice} ownedSince={equipment.purchaseDate ?? equipment.installDate} />

        {equipment.notes && (
          <div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground whitespace-pre-wrap">
            {equipment.notes}
          </div>
        )}
      </aside>

      <div className="min-w-0 flex-1 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <h1 className="font-heading text-2xl font-semibold">{equipment.name}</h1>
          <div className="flex shrink-0 items-center gap-2">
            <EquipmentEditButton equipment={equipment} properties={properties} />
            <PlanReplacementButton equipment={equipment} roomOptions={roomOptions} />
            <Link
              href={`/reports/equipment/${id}`}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md border bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted transition-colors"
            >
              <FileText className="h-3.5 w-3.5" /> Report
            </Link>
            <a
              href={`/api/assets/equipment/${id}/download`}
              download
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md border bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted transition-colors"
            >
              <Download className="h-3.5 w-3.5" /> Download all files
            </a>
          </div>
        </div>

        <Tabs defaultValue={tab ?? "service"}>
          <TabsList variant="line" className="w-full justify-start border-b">
            <TabsTrigger value="service">Service ({serviceRecords.length})</TabsTrigger>
            <TabsTrigger value="warranties">Warranties ({warranties.length})</TabsTrigger>
            <TabsTrigger value="maintenance">Maintenance Reminders ({maintenanceSchedules.length})</TabsTrigger>
            <TabsTrigger value="documents">Documents ({documents.length})</TabsTrigger>
          </TabsList>
          <TabsContent value="service" className="mt-4">
            <ServiceRecordList records={serviceRecords} assetId={id} assetType="EQUIPMENT" roomOptions={roomOptions} defaultRoomId={equipment.roomId} reminders={maintenanceSchedules} openId={tab === "service" ? open : undefined} />
          </TabsContent>
          <TabsContent value="warranties" className="mt-4">
            <WarrantyList warranties={warranties} assetId={id} assetType="EQUIPMENT" openId={tab === "warranties" ? open : undefined} />
          </TabsContent>
          <TabsContent value="maintenance" className="mt-4">
            <MaintenanceList schedules={maintenanceSchedules} assetId={id} assetType="EQUIPMENT" roomOptions={roomOptions} defaultRoomId={equipment.roomId} currentMileage={null} manualOptions={manualOptions} openId={tab === "maintenance" ? open : undefined} />
          </TabsContent>
          <TabsContent value="documents" className="mt-4">
            <AssetDocuments assetId={id} documents={documents} hint="Manual, install guide, spec sheet: files for the equipment itself, not one service." />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}

function Stat({ icon: Icon, label, value, mono }: { icon: React.ElementType; label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border bg-card px-3 py-2">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0">
        <Icon className="h-3.5 w-3.5" /> {label}
      </div>
      <div className={mono ? "font-mono text-xs break-all text-right" : "font-semibold text-sm text-right"}>{value}</div>
    </div>
  )
}
