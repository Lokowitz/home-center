import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Building2, Car, Wrench, ShieldCheck, Calendar, Clock, Refrigerator, PiggyBank, HeartPulse } from "lucide-react"
import { SummaryCard } from "@/components/dashboard/summary-card"
import { ReminderRow } from "@/components/dashboard/reminder-row"
import { loadAssetIndex } from "@/lib/assets-server"
import { loadActivityIndex, mostRecentlyActive } from "@/lib/asset-activity"
import { assetHref } from "@/lib/assets"
import { scheduleDue, dueCandidateFilter, meterUnitShort, type Due } from "@/lib/maintenance-due"
import { loadVehicleMileage } from "@/lib/maintenance-due-server"
import { loadCostRecords } from "@/lib/costs-server"
import { bucketed, priorPeriod, sum, yearToDate } from "@/lib/costs"
import { SpendArea } from "@/components/charts/spend-area"
import { ownedWhere } from "@/lib/features"
import { loadFeatures } from "@/lib/features-server"
import { listInboxItems } from "@/lib/inbox-server"
import { IntakeCard } from "@/components/dashboard/intake-card"
import { FreshStartCard } from "@/components/dashboard/fresh-start-card"
import { getFormat } from "@/lib/regional-server"

// Months of history in the dashboard's spending chart. Twelve rather than six:
// six months cannot show a season, and a household's spending is seasonal.
const SPEND_MONTHS = 12

// Thumbnails per summary card.
const THUMBNAILS_LARGE = 7
// Equipment's card spans the full width of its column, so it fits many more.
const THUMBNAILS_COMPACT = 18

export default async function DashboardPage() {
  const fmt = await getFormat()
  const session = await auth()

  const now = new Date()
  const in60 = new Date(now.getTime() + 60 * 86400000)
  const features = await loadFeatures()
  const owned = ownedWhere(features)

  const [
    propertyCount, vehicleCount, equipmentCount, personCount, recordCount,
    warrantyCount, personTotal, recordTotal,
    maintenanceCandidates, mileage, expiringWarranties,
    properties, vehicles, equipment, people, assets, activity, costRows, intake,
  ] = await Promise.all([
    prisma.property.count(),
    prisma.vehicle.count(),
    prisma.equipment.count(),
    features.health ? prisma.person.count() : 0,
    prisma.serviceRecord.count({ where: owned }),
    prisma.warranty.count({ where: { ...owned, expirationDate: { gt: now } } }),
    // Unfiltered, so a household whose only data is hidden by a feature toggle is not called empty.
    prisma.person.count(),
    prisma.serviceRecord.count(),
    // Everything that could be due either way; narrowed to what actually is,
    // and counted, below — mileage can't be filtered in SQL.
    prisma.maintenanceSchedule.findMany({
      where: { AND: [dueCandidateFilter(30, now), owned] },
      orderBy: { nextDueDate: "asc" },
    }),
    loadVehicleMileage(),
    prisma.warranty.findMany({
      where: { ...owned, expirationDate: { gte: now, lte: in60 } },
      orderBy: { expirationDate: "asc" },
      take: 6,
    }),
    prisma.property.findMany({ select: { id: true, name: true, imageFilename: true, updatedAt: true } }),
    prisma.vehicle.findMany({ select: { id: true, name: true, imageFilename: true, updatedAt: true } }),
    prisma.equipment.findMany({ select: { id: true, name: true, imageFilename: true, updatedAt: true } }),
    features.health ? prisma.person.findMany({ select: { id: true, name: true, imageFilename: true, updatedAt: true } }) : [],
    loadAssetIndex(),
    loadActivityIndex(),
    loadCostRecords(),
    listInboxItems(now),
  ])

  // A schedule counts as due when its own date window says so (the card's "30d"
  // headline), or when the vehicle has reached its due mileage.
  const dueMaintenance = maintenanceCandidates
    .map((s) => ({ s, due: scheduleDue(s, mileage, now) }))
    .filter(({ due }) => due.overdue || due.dueSoon || (due.daysLeft != null && due.daysLeft <= 30))

  const empty = propertyCount + vehicleCount + equipmentCount + personTotal + recordTotal === 0

  const maintenanceCount = dueMaintenance.length

  // Same window a year earlier, not the whole of last year — comparing March-to-date
  // against a full twelve months would make every spring look thrifty.
  const spendThisYear = sum(yearToDate(costRows, now))
  const spendLastYear = sum(yearToDate(costRows, now, now.getFullYear() - 1))
  const spendDelta = spendLastYear > 0 ? (spendThisYear - spendLastYear) / spendLastYear : null
  const monthSpend = bucketed(costRows, "month", {
    start: new Date(now.getFullYear(), now.getMonth() - (SPEND_MONTHS - 1), 1),
    end: now,
  })
  const monthSpendPrior = priorPeriod(costRows, monthSpend, "month")

  // Rank by severity before taking the top few. Ordering by date alone would
  // hide a truck that's 300 miles past an oil change but whose due date is two
  // years out — it would be counted above and then never shown.
  const severity = (d: Due) => (d.overdue ? 0 : d.dueSoon ? 1 : 2)
  const urgentMaintenance = dueMaintenance
    .sort((a, b) =>
      severity(a.due) - severity(b.due) ||
      (a.due.daysLeft ?? Infinity) - (b.due.daysLeft ?? Infinity) ||
      a.s.id.localeCompare(b.s.id)
    )
    .slice(0, 6)

  const propertyThumbnails = mostRecentlyActive(properties, "PROPERTY", activity, THUMBNAILS_LARGE)
  const vehicleThumbnails = mostRecentlyActive(vehicles, "VEHICLE", activity, THUMBNAILS_LARGE)
  const equipmentThumbnails = mostRecentlyActive(equipment, "EQUIPMENT", activity, THUMBNAILS_COMPACT)
  const peopleThumbnails = mostRecentlyActive(people, "PERSON", activity, THUMBNAILS_COMPACT)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-xl font-semibold tracking-tight">
          Welcome back{session?.user?.name ? `, ${session.user.name.split(" ")[0]}` : ""}
        </h1>
      </div>

      {empty && session?.user.role === "ADMIN" && <FreshStartCard />}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-[1.3fr_1.3fr_1.6fr_1fr]">
        <SummaryCard icon={<Building2 />} label="Properties" value={propertyCount} href="/assets/properties" thumbnails={propertyThumbnails} hero />
        <SummaryCard icon={<Car />} label="Vehicles" value={vehicleCount} href="/assets/vehicles" thumbnails={vehicleThumbnails} hero />
        {/* People and Equipment stack full-width in the third column, each with
            room for its own thumbnail strip. With Health off, Equipment has the
            column to itself. */}
        <div className="col-span-2 grid grid-cols-1 gap-4 sm:col-span-3 lg:col-span-1">
          {features.health && (
            <SummaryCard icon={<HeartPulse />} label="People" value={personCount} href="/assets/people" thumbnails={peopleThumbnails} compact hero />
          )}
          <SummaryCard icon={<Refrigerator />} label="Equipment" value={equipmentCount} href="/assets/equipment" thumbnails={equipmentThumbnails} compact hero />
        </div>
        {/* Records, Active Warranties, and Due stack vertically in a
            narrow far-right column on wide screens; on narrower ones they run
            side by side so they don't stretch the page tall. */}
        <div className="col-span-2 grid grid-cols-3 gap-4 sm:col-span-3 lg:col-span-1 lg:flex lg:flex-col">
          <SummaryCard icon={<Wrench />} label="Records" value={recordCount} href="/records" compact />
          <SummaryCard icon={<ShieldCheck />} label="Active Warranties" value={warrantyCount} href="/warranties" compact />
          <SummaryCard icon={<Calendar />} label="Due (30d)" value={maintenanceCount} href="/maintenance" urgent={maintenanceCount > 0} compact />
        </div>
      </div>

      {/* Two by two until the page is wide enough for all four side by side. */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-4">
        <IntakeCard items={intake.items} householdNames={intake.householdNames} />

        {/* Upcoming reminders */}
        <Card className="py-5">
          <CardHeader className="px-5 pb-1">
            <CardTitle className="flex items-center justify-between text-[13px] font-medium uppercase tracking-wide text-muted-foreground">
              Reminders
              <Link
                href="/maintenance"
                className="rounded-md px-2 py-1 text-xs font-medium normal-case tracking-normal text-muted-foreground transition-colors duration-150 hover:bg-primary/10 hover:text-primary"
              >
                View all →
              </Link>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 px-5">
            {urgentMaintenance.length === 0 ? (
              <EmptyPanel icon={Clock} message="Nothing due in the next 30 days." />
            ) : urgentMaintenance.map(({ s, due }) => {
              const reading = s.assetType === "VEHICLE" ? mileage.get(s.assetId) : undefined
              return (
                <ReminderRow
                  key={s.id}
                  schedule={s}
                  assetName={assets.assetName(s.assetType, s.assetId)}
                  href={assetHref(s.assetType, s.assetId)}
                  overdue={due.overdue}
                  dueLabel={dueLabel(due)}
                  currentMileage={reading?.value ?? null}
                  meterUnit={reading?.unit ?? "MILES"}
                />
              )
            })}
          </CardContent>
        </Card>

        {/* Expiring warranties */}
        <Card className="py-5">
          <CardHeader className="px-5 pb-1">
            <CardTitle className="flex items-center justify-between text-[13px] font-medium uppercase tracking-wide text-muted-foreground">
              Expiring Warranties
              <Link
                href="/warranties"
                className="rounded-md px-2 py-1 text-xs font-medium normal-case tracking-normal text-muted-foreground transition-colors duration-150 hover:bg-primary/10 hover:text-primary"
              >
                View all →
              </Link>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 px-5">
            {expiringWarranties.length === 0 ? (
              <EmptyPanel icon={ShieldCheck} message="No warranties expiring in the next 60 days." />
            ) : expiringWarranties.map((w) => {
              const assetName = assets.assetName(w.assetType, w.assetId)
              const href = assetHref(w.assetType, w.assetId)
              const daysLeft = w.expirationDate ? Math.ceil((new Date(w.expirationDate).getTime() - now.getTime()) / 86400000) : null
              return (
                <Link
                  key={w.id}
                  href={href}
                  className="flex items-center gap-2 rounded-md px-2 py-2.5 text-sm transition-colors duration-150 hover:bg-muted/60"
                >
                  <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="flex-1 truncate">{w.productName}</span>
                  <span className="text-xs text-muted-foreground shrink-0">{assetName}</span>
                  <Badge variant="secondary" className="shrink-0 text-xs">{daysLeft}d</Badge>
                </Link>
              )
            })}
          </CardContent>
        </Card>

        {/* Spending */}
        <Card className="py-5">
          <CardHeader className="px-5 pb-1">
            <CardTitle className="flex items-center justify-between text-[13px] font-medium uppercase tracking-wide text-muted-foreground">
              Spending
              <Link
                href="/costs"
                className="rounded-md px-2 py-1 text-xs font-medium normal-case tracking-normal text-muted-foreground transition-colors duration-150 hover:bg-primary/10 hover:text-primary"
              >
                View all →
              </Link>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 px-5">
            {costRows.length === 0 ? (
              <EmptyPanel icon={PiggyBank} message="No costs recorded yet." />
            ) : (
              <>
                <div>
                  <div className="flex items-baseline gap-2">
                    {/* Proportional figures: tabular-nums gives every digit the
                        width of a zero, which reads loose at this size. */}
                    <span className="text-2xl font-semibold leading-none">{fmt.money(spendThisYear)}</span>
                    <span className="text-xs text-muted-foreground">in {now.getFullYear()}</span>
                    {spendDelta !== null && (
                      <span className="ml-auto shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-muted-foreground">
                        {spendDelta >= 0 ? "↑" : "↓"} {Math.abs(spendDelta * 100).toFixed(0)}%
                      </span>
                    )}
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {spendDelta === null
                      ? `Nothing recorded by this point in ${now.getFullYear() - 1}.`
                      : `vs the same point last year (${fmt.money(spendLastYear)}).`}
                  </p>
                </div>
                <SpendArea
                  points={monthSpend}
                  prior={monthSpendPrior}
                  priorLabel={`${now.getFullYear() - 1}`}
                />
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

// Mileage-driven rows have no meaningful day count, so they report the meter instead.
function dueLabel(due: Due) {
  if (due.reason === "mileage" && due.milesLeft != null) {
    const unit = meterUnitShort(due.meterUnit ?? "MILES")
    return due.milesLeft < 0
      ? `${Math.abs(due.milesLeft).toLocaleString()} ${unit} over`
      : `${due.milesLeft.toLocaleString()} ${unit}`
  }
  const d = due.daysLeft
  if (d === null) return "—"
  return d < 0 ? `${Math.abs(d)}d late` : d === 0 ? "Today" : `${d}d`
}

function EmptyPanel({ icon: Icon, message }: { icon: React.ElementType; message: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-6 text-center">
      <Icon className="h-5 w-5 text-muted-foreground/40" strokeWidth={1.5} />
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  )
}

