import { prisma } from "@/lib/prisma"
import { DropPageAsset } from "@/components/drop/drop-provider"
import { notFound } from "next/navigation"
import Link from "next/link"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Calendar, Gauge, Palette, Download, Factory, Tag, Fingerprint, FileText } from "lucide-react"
import { ServiceRecordList } from "@/components/service-records/service-record-list"
import { WarrantyList } from "@/components/warranties/warranty-list"
import { MaintenanceList } from "@/components/maintenance/maintenance-list"
import { loadManualOptions } from "@/lib/manual-reference-server"
import { AssetDocuments } from "@/components/attachments/asset-documents"
import { AssetImageUploader } from "@/components/asset-image-uploader"
import { VehicleEditButton } from "@/components/vehicles/vehicle-edit-button"
import { getFormat } from "@/lib/regional-server"
import { AssetCostPanel } from "@/components/costs/asset-cost-panel"
import { AssetInsurance } from "@/components/insurance/asset-insurance"
import { loadAssetPolicies, loadPolicyChoices } from "@/lib/insurance-server"

export default async function VehicleDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ tab?: string; open?: string }>
}) {
  const { id } = await params
  const { tab, open } = await searchParams
  const fmt = await getFormat()
  const vehicle = await prisma.vehicle.findUnique({ where: { id } })
  if (!vehicle) notFound()

  const [serviceRecords, warranties, maintenanceSchedules, documents, manualOptions, policies, policyChoices] = await Promise.all([
    prisma.serviceRecord.findMany({ where: { assetId: id, assetType: "VEHICLE" }, include: { attachments: true }, orderBy: { date: "desc" } }),
    prisma.warranty.findMany({ where: { assetId: id, assetType: "VEHICLE" }, include: { attachments: true }, orderBy: { expirationDate: "asc" } }),
    prisma.maintenanceSchedule.findMany({ where: { assetId: id, assetType: "VEHICLE" }, include: { attachments: true }, orderBy: { nextDueDate: "asc" } }),
    prisma.attachment.findMany({ where: { recordType: "DOCUMENT", assetType: "VEHICLE", assetId: id }, orderBy: { uploadedAt: "asc" } }),
    loadManualOptions([{ assetType: "VEHICLE", assetId: id }]),
    loadAssetPolicies("VEHICLE", id),
    loadPolicyChoices("vehicles", false),
  ])

  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
      {/* Files dropped anywhere on this page go to Intake for this vehicle. */}
      <DropPageAsset assetType="VEHICLE" assetId={id} name={vehicle.name} />
      <aside className="space-y-4 lg:w-72 lg:shrink-0">
        <AssetImageUploader assetType="VEHICLE" assetId={id} imageFilename={vehicle.imageFilename} alt={vehicle.name} />

        <div className="space-y-2">
          <Stat icon={Factory} label="Make" value={vehicle.make} />
          <Stat icon={Tag} label="Model" value={vehicle.model} />
          <Stat icon={Calendar} label="Year" value={vehicle.year.toString()} />
          {vehicle.currentMileage != null && <Stat icon={Gauge} label={fmt.meterNoun(vehicle.meterUnit)} value={`${vehicle.currentMileage.toLocaleString()} ${fmt.meterShort(vehicle.meterUnit)}`} />}
          {vehicle.color && <Stat icon={Palette} label="Color" value={vehicle.color} />}
          {vehicle.vin && <Stat icon={Fingerprint} label="VIN" value={vehicle.vin} mono />}
          {vehicle.purchaseDate && <Stat icon={Calendar} label="Purchased" value={fmt.date(vehicle.purchaseDate)} />}
        </div>

        <AssetInsurance policies={policies} />
        <AssetCostPanel
          assetType="VEHICLE"
          assetId={id}
          purchasePrice={vehicle.purchasePrice}
          ownedSince={vehicle.purchaseDate}
          meterUnit={vehicle.meterUnit}
        />

        {vehicle.notes && (
          <div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground whitespace-pre-wrap">
            {vehicle.notes}
          </div>
        )}
      </aside>

      <div className="min-w-0 flex-1 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <h1 className="font-heading text-2xl font-semibold">{vehicle.name}</h1>
          <div className="flex shrink-0 items-center gap-2">
            <VehicleEditButton vehicle={vehicle} policyChoices={policyChoices} policyIds={policies.map((p) => p.id)} />
            <Link
              href={`/reports/vehicles/${id}`}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md border bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted transition-colors"
            >
              <FileText className="h-3.5 w-3.5" /> Report
            </Link>
            <a
              href={`/api/assets/vehicles/${id}/download`}
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
            <ServiceRecordList records={serviceRecords} assetId={id} assetType="VEHICLE" meterUnit={vehicle.meterUnit} reminders={maintenanceSchedules} openId={tab === "service" ? open : undefined} />
          </TabsContent>
          <TabsContent value="warranties" className="mt-4">
            <WarrantyList warranties={warranties} assetId={id} assetType="VEHICLE" openId={tab === "warranties" ? open : undefined} />
          </TabsContent>
          <TabsContent value="maintenance" className="mt-4">
            <MaintenanceList schedules={maintenanceSchedules} assetId={id} assetType="VEHICLE" currentMileage={vehicle.currentMileage} meterUnit={vehicle.meterUnit} manualOptions={manualOptions} openId={tab === "maintenance" ? open : undefined} />
          </TabsContent>
          <TabsContent value="documents" className="mt-4">
            <AssetDocuments assetId={id} documents={documents} hint="Title, registration, owner's manual: files for the vehicle itself, not one service." />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}

function Stat({ icon: Icon, label, value, mono }: { icon: React.ElementType; label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border bg-card px-3 py-2">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0">
        <Icon className="h-3.5 w-3.5" /> {label}
      </div>
      <div className={mono ? "font-mono text-xs break-all text-right" : "font-semibold text-sm text-right"}>{value}</div>
    </div>
  )
}
