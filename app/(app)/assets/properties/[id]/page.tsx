import { prisma } from "@/lib/prisma"
import { DropPageAsset } from "@/components/drop/drop-provider"
import { notFound } from "next/navigation"
import Link from "next/link"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { MapPin, Calendar, DollarSign, Maximize, Download, Home, FileText } from "lucide-react"
import { ServiceRecordList } from "@/components/service-records/service-record-list"
import { WarrantyList } from "@/components/warranties/warranty-list"
import { MaintenanceList } from "@/components/maintenance/maintenance-list"
import { AssetDocuments } from "@/components/attachments/asset-documents"
import { AssetImageUploader } from "@/components/asset-image-uploader"
import { PropertyEditButton } from "@/components/properties/property-edit-button"
import { AssetCostPanel } from "@/components/costs/asset-cost-panel"
import { getFormat } from "@/lib/regional-server"

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

  const [propertyServiceRecords, propertyWarranties, propertyMaintenanceSchedules, equipment, documents] = await Promise.all([
    prisma.serviceRecord.findMany({ where: { assetId: id, assetType: "PROPERTY" }, include: { attachments: true }, orderBy: { date: "desc" } }),
    prisma.warranty.findMany({ where: { assetId: id, assetType: "PROPERTY" }, include: { attachments: true }, orderBy: { expirationDate: "asc" } }),
    prisma.maintenanceSchedule.findMany({ where: { assetId: id, assetType: "PROPERTY" }, include: { attachments: true }, orderBy: { nextDueDate: "asc" } }),
    prisma.equipment.findMany({ where: { propertyId: id }, select: { id: true, name: true } }),
    prisma.attachment.findMany({ where: { recordType: "DOCUMENT", assetType: "PROPERTY", assetId: id }, orderBy: { uploadedAt: "asc" } }),
  ])

  const equipmentIds = equipment.map((e) => e.id)

  const [equipmentServiceRecords, equipmentWarranties, equipmentMaintenanceSchedules] = equipmentIds.length
    ? await Promise.all([
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
    : [[], [], []]

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
          {property.purchaseDate && <Stat icon={Calendar} label="Purchased" value={fmt.date(property.purchaseDate)} />}
        </div>

        <AssetCostPanel assetType="PROPERTY" assetId={id} purchasePrice={property.purchasePrice} />

        {property.notes && (
          <div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground whitespace-pre-wrap">
            {property.notes}
          </div>
        )}
      </aside>

      <div className="min-w-0 flex-1 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <h1 className="font-heading text-2xl font-semibold">{property.name}</h1>
          <div className="flex shrink-0 items-center gap-2">
            <PropertyEditButton property={property} />
            <Link
              href={`/reports/properties/${id}`}
              target="_blank"
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

        <Tabs defaultValue={tab ?? "service"}>
          <TabsList variant="line" className="w-full justify-start border-b">
            <TabsTrigger value="service">Service ({serviceRecords.length})</TabsTrigger>
            <TabsTrigger value="warranties">Warranties ({warranties.length})</TabsTrigger>
            <TabsTrigger value="maintenance">Maintenance Reminders ({maintenanceSchedules.length})</TabsTrigger>
            <TabsTrigger value="documents">Documents ({documents.length})</TabsTrigger>
          </TabsList>
          <TabsContent value="service" className="mt-4">
            <ServiceRecordList records={serviceRecords} assetId={id} assetType="PROPERTY" equipment={equipment} propertyName={property.name} reminders={maintenanceSchedules} openId={tab === "service" ? open : undefined} />
          </TabsContent>
          <TabsContent value="warranties" className="mt-4">
            <WarrantyList warranties={warranties} assetId={id} assetType="PROPERTY" equipment={equipment} propertyName={property.name} openId={tab === "warranties" ? open : undefined} />
          </TabsContent>
          <TabsContent value="maintenance" className="mt-4">
            <MaintenanceList schedules={maintenanceSchedules} assetId={id} assetType="PROPERTY" equipment={equipment} propertyName={property.name} openId={tab === "maintenance" ? open : undefined} />
          </TabsContent>
          <TabsContent value="documents" className="mt-4">
            <AssetDocuments assetId={id} documents={documents} hint="Deed, survey, closing papers, floor plans: files for the property itself, not one service." />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}

function Stat({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border bg-card px-3 py-2">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0">
        <Icon className="h-3.5 w-3.5" /> {label}
      </div>
      <div className="font-semibold text-sm text-right">{value}</div>
    </div>
  )
}
