import { TrendChart } from "@/components/charts/trend-chart"
import { Meter } from "@/components/charts/meter"
import { loadCostRecords } from "@/lib/costs-server"
import {
  costPerMeter, costRange, stackedBuckets, sum, yearToDate,
  type Granularity,
} from "@/lib/costs"
import { meterUnitWord } from "@/lib/maintenance-due"
import type { AssetType, MeterUnit } from "@/app/generated/prisma/client"
import { getFormat } from "@/lib/regional-server"
import type { Formatter } from "@/lib/regional"

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
  meterUnit,
}: {
  assetType: AssetType
  assetId: string
  purchasePrice?: number | null
  /// Vehicles only. Its presence is what turns on the cost-per-unit row.
  meterUnit?: MeterUnit
}) {
  const fmt = await getFormat()
  const rows = await loadCostRecords({ assetId, assetType })
  // An asset nobody has spent on gets no panel at all — an empty one would be a
  // row of dashes claiming to be information.
  if (rows.length === 0) return null

  const now = new Date()
  const lifetime = sum(rows)
  const perMeter = meterUnit ? costPerMeter(rows) : null

  const range = costRange(rows, now)
  const spanYears = range.end.getFullYear() - range.start.getFullYear() + 1
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
          <Row label={`Per ${meterUnitWord(meterUnit!)}`} value={fmt.money(perMeter)} />
        )}
        {purchasePrice != null && (
          <>
            <Row label="Purchase" value={fmt.money(purchasePrice)} />
            <Row label="Total owned cost" value={fmt.money(purchasePrice + lifetime)} strong />
          </>
        )}
      </dl>

      {/* The panel already knows both numbers; this makes the ratio between them
          visible, which is the shape the question "is this still worth keeping"
          actually takes. */}
      {purchasePrice != null && purchasePrice > 0 ? (
        <ServiceShare lifetime={lifetime} purchasePrice={purchasePrice} fmt={fmt} />
      ) : null}
    </div>
  )
}

function ServiceShare({ lifetime, purchasePrice, fmt }: { lifetime: number; purchasePrice: number; fmt: Formatter }) {
  const share = lifetime / purchasePrice
  // Severity is the caller's to decide, and here it is a judgement about money
  // rather than a fact about the data: service approaching what the thing cost is
  // worth noticing, and service past it is worth saying plainly.
  const color =
    share >= 1 ? "var(--destructive)" : share >= 0.5 ? "var(--cost-inspection)" : "var(--cost-bar)"
  const percent = Math.round(share * 100)

  return (
    <Meter
      value={lifetime}
      max={purchasePrice}
      color={color}
      label="Service vs purchase price"
      valueLabel={`${percent}%`}
      note={
        share >= 1
          ? "Service has cost more than the purchase price."
          : `${fmt.money(purchasePrice - lifetime)} of the purchase price left to match.`
      }
    />
  )
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`tabular-nums ${strong ? "font-semibold" : ""}`}>{value}</dd>
    </div>
  )
}
