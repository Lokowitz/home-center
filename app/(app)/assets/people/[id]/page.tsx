import { requireHealth } from "@/lib/features-server"
import { DropPageAsset } from "@/components/drop/drop-provider"
import { prisma } from "@/lib/prisma"
import { notFound } from "next/navigation"
import { cookies } from "next/headers"
import Link from "next/link"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Cake, Download, Droplet, FileText, Stethoscope, Users, User } from "lucide-react"
import { ServiceRecordList } from "@/components/service-records/service-record-list"
import { MaintenanceList } from "@/components/maintenance/maintenance-list"
import { loadManualOptions } from "@/lib/manual-reference-server"
import { loadPolicyChoices } from "@/lib/insurance-server"
import { AssetDocuments } from "@/components/attachments/asset-documents"
import { AssetImageUploader } from "@/components/asset-image-uploader"
import { AssetCostPanel } from "@/components/costs/asset-cost-panel"
import { PersonEditButton } from "@/components/people/person-edit-button"
import { AllergyCallout } from "@/components/health/allergy-callout"
import { AllergiesSection } from "@/components/health/allergies-section"
import { ImmunizationsSection } from "@/components/health/immunizations-section"
import { ConditionsSection } from "@/components/health/conditions-section"
import { MedicationsSection } from "@/components/health/medications-section"
import { ObservationsSection } from "@/components/health/observations-section"
import { LogObservationButton } from "@/components/health/observation-form"
import { byNewest, typeSuggestions } from "@/lib/observations"
import { getFormat } from "@/lib/regional-server"
import { ageFrom, labelFor, RELATIONSHIPS } from "@/lib/health"
import { AssetInsurance } from "@/components/insurance/asset-insurance"
import { MEDICATION_VIEW_COOKIE, parseMedicationView } from "@/lib/medication-timeline"
import { loadPropertyScope, loadPropertyFilterChoices } from "@/lib/property-filter-server"
import { assetInScope } from "@/lib/property-filter"
import { HiddenByFilter } from "@/components/hidden-by-filter"

export default async function PersonDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ tab?: string; open?: string }>
}) {
  await requireHealth()
  const scope = await loadPropertyScope()
  const fmt = await getFormat()
  const { id } = await params
  const { tab, open } = await searchParams
  // Checked before the full load below; hidden ids all exist, so a missing person still gets notFound().
  if (!assetInScope(scope, "PERSON", id)) {
    const hidden = await prisma.person.findUnique({ where: { id }, select: { property: { select: { name: true } } } })
    if (!hidden) notFound()
    return <HiddenByFilter propertyName={scope!.propertyName} ownerName={hidden.property?.name} />
  }
  const medicationView = parseMedicationView((await cookies()).get(MEDICATION_VIEW_COOKIE)?.value)
  const person = await prisma.person.findUnique({
    where: { id },
    include: {
      primaryProvider: { select: { id: true, name: true } },
      allergies: { include: { attachments: true }, orderBy: [{ severity: "desc" }, { substance: "asc" }] },
      immunizations: { include: { attachments: true }, orderBy: { dateGiven: "desc" } },
      conditions: {
        include: { attachments: true, provider: { select: { name: true } } },
        // ACTIVE < MANAGED < RESOLVED alphabetically, which is also the order that matters.
        orderBy: [{ status: "asc" }, { name: "asc" }],
      },
      medications: {
        include: { attachments: true, prescriber: { select: { name: true } }, condition: { select: { name: true } } },
        orderBy: { name: "asc" },
      },
      insurancePolicies: { select: { id: true, carrier: true, planName: true, kind: true, memberId: true }, orderBy: { carrier: "asc" } },
      observations: {
        include: { attachments: true, condition: { select: { name: true } }, createdBy: { select: { name: true } } },
        orderBy: { date: "desc" },
      },
    },
  })
  if (!person) notFound()

  const where = { assetId: id, assetType: "PERSON" as const }
  const [visits, schedules, providers, documents, manualOptions, policyChoices, propertyChoices] = await Promise.all([
    prisma.serviceRecord.findMany({ where, include: { attachments: true }, orderBy: { date: "desc" } }),
    prisma.maintenanceSchedule.findMany({ where, include: { attachments: true }, orderBy: { nextDueDate: "asc" } }),
    prisma.provider.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.attachment.findMany({ where: { recordType: "DOCUMENT", assetType: "PERSON", assetId: id }, orderBy: { uploadedAt: "asc" } }),
    loadManualOptions([{ assetType: "PERSON", assetId: id }]),
    // The page is behind requireHealth(), so health and life policies are fair game here.
    loadPolicyChoices("members", true, scope),
    loadPropertyFilterChoices(scope),
  ])

  const age = person.dateOfBirth ? ageFrom(person.dateOfBirth, new Date()) : null
  const conditionOptions = person.conditions.map((c) => ({ id: c.id, name: c.name }))
  const observations = [...person.observations].sort(byNewest)
  const observationTypes = typeSuggestions(observations)

  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
      {/* Files dropped anywhere on this page go to Intake for this person. */}
      <DropPageAsset assetType="PERSON" assetId={id} name={person.name} />
      <aside className="space-y-4 lg:w-72 lg:shrink-0">
        <AssetImageUploader assetType="PERSON" assetId={id} imageFilename={person.imageFilename} alt={person.name} />

        <AllergyCallout allergies={person.allergies} />

        <div className="space-y-2">
          <Stat icon={Users} label="Relationship" value={labelFor(RELATIONSHIPS, person.relationship)} />
          {person.dateOfBirth && (
            <Stat icon={Cake} label="Born" value={`${fmt.date(person.dateOfBirth, { utc: true })} (${age})`} />
          )}
          {person.sex && <Stat icon={User} label="Sex" value={person.sex} />}
          {person.bloodType && <Stat icon={Droplet} label="Blood type" value={person.bloodType} />}
          {person.primaryProvider && (
            <Stat
              icon={Stethoscope}
              label="Primary care"
              value={<Link href="/providers" className="hover:underline">{person.primaryProvider.name}</Link>}
            />
          )}
        </div>

        <AssetInsurance policies={person.insurancePolicies.map((p) => ({ ...p, detail: p.memberId }))} />

        <AssetCostPanel assetType="PERSON" assetId={id} purchasePrice={null} />

        {person.notes && (
          <div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground whitespace-pre-wrap">{person.notes}</div>
        )}
      </aside>

      <div className="min-w-0 flex-1 space-y-4">
        <div className="flex flex-col gap-2 xl:flex-row xl:items-start xl:justify-between xl:gap-4">
          <h1 className="min-w-0 break-words font-heading text-2xl font-semibold">{person.name}</h1>
          <div className="flex flex-wrap items-center gap-2 xl:shrink-0 xl:justify-end">
            <LogObservationButton personId={id} typeOptions={observationTypes} conditions={conditionOptions} />
            <PersonEditButton person={person} providers={providers} policyChoices={policyChoices} policyIds={person.insurancePolicies.map((p) => p.id)} propertyChoices={propertyChoices ?? undefined} />
            <Link
              href={`/reports/people/${id}`}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md border bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted transition-colors"
            >
              <FileText className="h-3.5 w-3.5" /> Medical summary
            </Link>
            <a
              href={`/api/assets/people/${id}/download`}
              download
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md border bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted transition-colors"
            >
              <Download className="h-3.5 w-3.5" /> Download all files
            </a>
          </div>
        </div>

        <Tabs defaultValue={tab ?? "visits"}>
          <TabsList variant="line" className="w-full justify-start border-b overflow-x-auto">
            <TabsTrigger value="visits">Visits &amp; Expenses ({visits.length})</TabsTrigger>
            <TabsTrigger value="observations">Observations ({observations.length})</TabsTrigger>
            <TabsTrigger value="conditions">Conditions ({person.conditions.length})</TabsTrigger>
            <TabsTrigger value="medications">Medications ({person.medications.length})</TabsTrigger>
            <TabsTrigger value="immunizations">Immunizations ({person.immunizations.length})</TabsTrigger>
            <TabsTrigger value="allergies">Allergies ({person.allergies.length})</TabsTrigger>
            <TabsTrigger value="reminders">Reminders ({schedules.length})</TabsTrigger>
            <TabsTrigger value="documents">Documents ({documents.length})</TabsTrigger>
          </TabsList>
          <TabsContent value="visits" className="mt-4">
            <ServiceRecordList records={visits} assetId={id} assetType="PERSON" providerOptions={providers} conditionOptions={conditionOptions} reminders={schedules} openId={tab === "visits" ? open : undefined} />
          </TabsContent>
          <TabsContent value="observations" className="mt-4">
            <ObservationsSection personId={id} observations={observations} conditions={conditionOptions} medications={person.medications} openId={tab === "observations" ? open : undefined} />
          </TabsContent>
          <TabsContent value="conditions" className="mt-4">
            <ConditionsSection personId={id} conditions={person.conditions} providers={providers} observations={observations} />
          </TabsContent>
          <TabsContent value="medications" className="mt-4">
            <MedicationsSection personId={id} medications={person.medications} providers={providers} conditions={conditionOptions} observations={observations.map((o) => ({ date: o.date, type: o.type, severity: o.severity }))} initialView={medicationView} openId={tab === "medications" ? open : undefined} />
          </TabsContent>
          <TabsContent value="immunizations" className="mt-4">
            <ImmunizationsSection personId={id} immunizations={person.immunizations} openId={tab === "immunizations" ? open : undefined} />
          </TabsContent>
          <TabsContent value="allergies" className="mt-4">
            <AllergiesSection personId={id} allergies={person.allergies} />
          </TabsContent>
          <TabsContent value="reminders" className="mt-4">
            <MaintenanceList schedules={schedules} assetId={id} assetType="PERSON" currentMileage={null} manualOptions={manualOptions} openId={tab === "reminders" ? open : undefined} />
          </TabsContent>
          <TabsContent value="documents" className="mt-4">
            <AssetDocuments assetId={id} documents={documents} hint="Birth certificate, passport scan, advance directive: files for this person, not one visit." />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}

function Stat({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border bg-card px-3 py-2">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0">
        <Icon className="h-3.5 w-3.5" /> {label}
      </div>
      <div className="min-w-0 break-words font-semibold text-sm text-right">{value}</div>
    </div>
  )
}
