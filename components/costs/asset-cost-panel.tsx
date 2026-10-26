import { TrendChart } from "@/components/charts/trend-chart"
import { Meter } from "@/components/charts/meter"
import { loadCostRecords, loadPlannedSchedules } from "@/lib/costs-server"
import { prisma } from "@/lib/prisma"
import { costPerYearOwned, nextDueMeter, warrantyMeter, type StatusMeter, type Tone } from "@/lib/asset-status"
import {
  costPerMeter, costRange, stackedBuckets, sum, yearToDate,
  type Granularity,
} from "@/lib/costs"
import type { AssetType, MeterUnit } from "@/app/generated/prisma/client"
import { getFormat } from "@/lib/regional-server"
import { forecastSchedules } from "@/lib/forecast"
import { localDay } from "@/lib/equipment-life"
import { warrantyToday } from "@/lib/llm/warranty-status"

/// Below this many years of history, yearly columns would be one or two marks —
/// not a chart, just a number drawn tall. Short histories get quarters instead.
const YEARS_FOR_YEARLY = 3
/// And below this many periods with any spending in them, there is no shape to
/// show: one bar beside two empty slots is a stat tile wearing a chart's
/// apparatus. The panel's own figures say it better.
const MIN_POPULATED_BUCKETS = 3
const PLOT_HEIGHT = 150

export async function AssetCostPanel({
  assetType,
  assetId,
  purchasePrice,
  ownedSince,
  meterUnit,
  equipmentIds,
}: {
  assetType: AssetType
  assetId: string
  purchasePrice?: number | null
  /// When it was bought or installed. Without it there is no cost per year.
  ownedSince?: Date | null
  /// Vehicles only. Its presence is what turns on the cost-per-unit row.
  meterUnit?: MeterUnit
  /// A property's equipment: their reminders count toward its planned figure. History stays the asset's own.
  equipmentIds?: string[]
}) {
  const fmt = await getFormat()
  const [rows, plannedSchedules] = await Promise.all([
    loadCostRecords({ assetId, assetType }),
    loadPlannedSchedules({
      assets: [{ assetType, assetId }, ...(equipmentIds ?? []).map((id) => ({ assetType: "EQUIPMENT" as const, assetId: id }))],
    }),
  ])
  const planned = forecastSchedules(plannedSchedules, localDay(new Date())).total
  // An asset nobody has spent on, and nothing is planned for, gets no panel at all —
  // an empty one would be a row of dashes claiming to be information.
  if (rows.length === 0 && planned === 0) return null
  // Planned spend with no history yet: just that figure. The rest describes past spending.
  if (rows.length === 0) {
    return (
      <div className="space-y-4 rounded-lg border bg-card p-4">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Cost</div>
        <dl className="space-y-1.5 text-sm">
          <Row label="Planned, next 12 months" value={fmt.money(planned)} />
        </dl>
      </div>
    )
  }

  const now = new Date()
  const [schedules, warranties] = await Promise.all([
    prisma.maintenanceSchedule.findMany({
      where: { assetId, assetType, isActive: true, nextDueDate: { not: null } },
      select: { title: true, nextDueDate: true, lastCompletedDate: true, createdAt: true, reminderDaysBefore: true },
    }),
    prisma.warranty.findMany({
      where: { assetId, assetType, expirationDate: { gte: warrantyToday(now) } },
      select: { productName: true, purchaseDate: true, expirationDate: true },
    }),
  ])
  const lifetime = sum(rows)
  const ownedCost = lifetime + (purchasePrice ?? 0)
  const perYear = costPerYearOwned(ownedCost, ownedSince ?? null, now)
  const statuses = [nextDueMeter(schedules, now), warrantyMeter(warranties, now)].filter((m): m is StatusMeter => m !== null)
  const perMeter = meterUnit ? costPerMeter(rows) : null

  const range = costRange(rows, now)
  const spanYears = range.end.getUTCFullYear() - range.start.getUTCFullYear() + 1
  const granularity: Granularity = spanYears >= YEARS_FOR_YEARLY ? "year" : "quarter"
  const buckets = stackedBuckets(rows, granularity, range)
  const populated = buckets.filter((b) => b.total > 0).length

  return (
    <div className="space-y-4 rounded-lg border bg-card p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Cost</div>

      <div>
        {/* Proportional figures on the panel's headline number; tabular is for
            the aligned rows below it. */}
        <div className="text-xl font-semibold leading-none">{fmt.money(lifetime)}</div>
        <div className="mt-1 text-xs text-muted-foreground">
          Service, across {rows.length} record{rows.length === 1 ? "" : "s"}
        </div>
      </div>

      {/* The same chart and the same category colours as the costs page, so a
          hue means one thing everywhere in the app. No rolling average: over one
          asset's handful of service events, a trailing mean smooths noise into a
          trend that isn't there. */}
      {populated >= MIN_POPULATED_BUCKETS ? (
        <TrendChart
          buckets={buckets}
          trend={[]}
          trendWindow={0}
          plotHeight={PLOT_HEIGHT}
          maxLabels={6}
        />
      ) : null}

      <dl className="space-y-1.5 text-sm">
        <Row label={`${now.getFullYear()} to date`} value={fmt.money(sum(yearToDate(rows, now)))} />
        {perMeter != null && (
          <Row label={`Per ${fmt.meterWord(meterUnit!)}`} value={fmt.moneyRate(perMeter)} />
        )}
        {purchasePrice != null && (
          <>
            <Row label="Purchase" value={fmt.money(purchasePrice)} />
            <Row label="Total owned cost" value={fmt.money(ownedCost)} strong />
          </>
        )}
        {perYear != null && <Row label="Per year owned" value={fmt.money(perYear)} />}
        {planned > 0 && <Row label="Planned, next 12 months" value={fmt.money(planned)} />}
      </dl>

      {/* Looking ahead rather than back: what is due next, and how long the
          warranty still covers it. Each is shown only when there is one. */}
      {statuses.map((m) => (
        <Status key={m.label} meter={m} />
      ))}
    </div>
  )
}

const TONE_COLOR: Record<Tone, string> = {
  ok: "var(--cost-bar)",
  soon: "var(--cost-inspection)",
  late: "var(--destructive)",
}

function Status({ meter }: { meter: StatusMeter }) {
  if (meter.fraction === null) return <Row label={meter.label} value={meter.valueLabel} />
  return <Meter value={meter.fraction} max={1} color={TONE_COLOR[meter.tone]} label={meter.label} valueLabel={meter.valueLabel} note={meter.note} />
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`tabular-nums ${strong ? "font-semibold" : ""}`}>{value}</dd>
    </div>
  )
}
