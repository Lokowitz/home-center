import Link from "next/link"
import { X } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { RankedBars, type RankedRow } from "@/components/charts/ranked-bars"
import { TrendChart } from "@/components/charts/trend-chart"
import { CompositionBar } from "@/components/charts/composition-bar"
import { TileChart, type TilePoint } from "@/components/charts/tile-chart"
import { loadCostRecords, loadPlannedSchedules } from "@/lib/costs-server"
import { loadFeatures } from "@/lib/features-server"
import { loadAssetIndex } from "@/lib/assets-server"
import { loadPropertyScope } from "@/lib/property-filter-server"
import { filteredEmptyText } from "@/lib/property-filter"
import { assetHref, assetIcon } from "@/lib/assets"
import { cn } from "@/lib/utils"
import { withParams } from "@/lib/table-params"
import type { AssetType } from "@/app/generated/prisma/client"
import {
  CATEGORY_ORDER, assetKey, averagePerMonth, monthsBack, dailyTotals, lastYearMonthly, yearlyBars, nestedByAsset, bucketed, byAsset, byCategory, byVendor, categoryColor,
  categoryLabel, costRange, inYear, isGranularity, parseAssetKey, ranked,
  rollingAverage, stackedBuckets, sum, yearToDate, type CategoryKey, type CostRow,
  type Granularity,
} from "@/lib/costs"
import { getFormat } from "@/lib/regional-server"
import type { Formatter } from "@/lib/regional"
import { forecastByMonth, forecastSchedules, largestPlanned, mileageNote, type Forecast } from "@/lib/forecast"
import { localDay } from "@/lib/equipment-life"

const TOP_ASSETS = 8
const TOP_VENDORS = 6
const BIGGEST_EXPENSES = 8
const TOP_PLANNED = 8
/// Months of history behind the year-to-date tile.
const TILE_MONTHS = 12
const DAILY_DAYS = 60
/// Buckets in the hero's trailing average. Three is enough to damp a single
/// large repair without smoothing away a real change of direction.
const TREND_WINDOW = 3

const ASSET_TYPE_FILTERS: { value: AssetType; label: string }[] = [
  { value: "PROPERTY", label: "Properties" },
  { value: "VEHICLE", label: "Vehicles" },
  { value: "EQUIPMENT", label: "Equipment" },
  { value: "PERSON", label: "People" },
]

const GRANULARITY_FILTERS: { value: Granularity; label: string }[] = [
  { value: "month", label: "Monthly" },
  { value: "quarter", label: "Quarterly" },
  { value: "year", label: "Yearly" },
]

const serviceTab = (assetType: AssetType) => (assetType === "PERSON" ? "visits" : "service")

export default async function CostsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const fmt = await getFormat()
  const now = new Date()
  // Every one of these arrives from the query string, so every one is whitelisted
  // against a known set before it reaches a filter.
  const typeParam = typeof params.type === "string" ? params.type : undefined
  const requestedType = ASSET_TYPE_FILTERS.some((t) => t.value === typeParam) ? (typeParam as AssetType) : undefined
  const scope = await loadPropertyScope()
  // Planned spend follows the asset-type filter only; year, bucket and category are about history.
  // It loads beside the rest: it only needs the type, and with Health off it returns nothing for people.
  const [allRows, assets, features, plannedSchedules] = await Promise.all([
    loadCostRecords({ scope }),
    loadAssetIndex(scope),
    loadFeatures(),
    loadPlannedSchedules(requestedType ? { assetType: requestedType, scope } : { scope }),
  ])
  const typeFilters = features.health ? ASSET_TYPE_FILTERS : ASSET_TYPE_FILTERS.filter((t) => t.value !== "PERSON")
  const assetType = typeFilters.some((t) => t.value === requestedType) ? requestedType : undefined
  // ?type=PERSON with Health off falls back to every asset, as the rest of the page does.
  const planned = assetType === requestedType ? plannedSchedules : await loadPlannedSchedules({ scope })
  const today = localDay(now)
  const forecast = forecastSchedules(planned, today)
  const plannedPanel = <PlannedPanel forecast={forecast} today={today} assets={assets} fmt={fmt} />

  if (allRows.length === 0) {
    const empty = filteredEmptyText(scope)
    return (
      <div className="space-y-6">
        <Heading />
        <div className="rounded-lg border border-dashed p-12 text-center text-muted-foreground">
          {empty ? (
            <p className="font-medium">{empty}</p>
          ) : (
            <>
              <p className="font-medium">No costs recorded yet</p>
              <p className="mt-1 text-sm">
                Add a cost to a service record and this page will start reporting on it.
              </p>
            </>
          )}
        </div>
        {plannedPanel}
      </div>
    )
  }

  const yearRaw = typeof params.year === "string" ? params.year : undefined
  const yearParam = Number(yearRaw ?? NaN)
  // The page opens on the current year, monthly, across all assets. "all" is an
  // explicit value because an absent param now means "the default", not "no filter".
  // Falls back to every year when the current one has no costs, so a fresh January
  // doesn't open on an empty page.
  const years = [...new Set(allRows.map((r) => r.date.getUTCFullYear()))].sort((a, b) => b - a)
  const thisYear = now.getFullYear()
  const year =
    yearRaw === "all"
      ? undefined
      : Number.isInteger(yearParam)
        ? yearParam
        : years.includes(thisYear)
          ? thisYear
          : undefined
  const bucketParam = typeof params.bucket === "string" ? params.bucket : undefined
  const granularity: Granularity = isGranularity(bucketParam) ? bucketParam : "month"
  const categoryParam = typeof params.category === "string" ? params.category : undefined
  const category = (CATEGORY_ORDER as string[]).includes(categoryParam ?? "")
    ? (categoryParam as CategoryKey)
    : undefined

  // Years come from the unfiltered set so the list doesn't shift when an asset
  // type is picked.
  const typeRows = assetType ? allRows.filter((r) => r.assetType === assetType) : allRows
  const yearRows = year != null ? inYear(typeRows, year) : typeRows
  // The category filter stops here. The composition bar below is what sets it, so
  // it has to keep showing the whole mix — a bar filtered to its own selection
  // would collapse to a single full-width segment and lose the comparison that
  // made it worth clicking.
  const rows = category ? yearRows.filter((r) => (r.category ?? "UNCATEGORIZED") === category) : yearRows

  const filters = (
    <FilterRow
      params={params}
      years={years}
      types={typeFilters}
      assetType={assetType}
      year={year}
      granularity={granularity}
      category={category}
    />
  )

  if (rows.length === 0) {
    return (
      <div className="space-y-6">
        <Heading />
        {filters}
        <div className="rounded-lg border border-dashed p-12 text-center text-muted-foreground">
          <p className="font-medium">No costs match those filters</p>
          <p className="mt-1 text-sm">Try a different year, asset type, or category.</p>
        </div>
        {plannedPanel}
      </div>
    )
  }

  const range = costRange(typeRows, now, year)
  const buckets = stackedBuckets(rows, granularity, range)
  const trend = rollingAverage(buckets, TREND_WINDOW)

  // Year-to-date against the same point last year, not against all of last year —
  // comparing March-to-date with twelve months would make every spring look thrifty.
  const ytd = sum(yearToDate(typeRows, now))
  const ytdPrior = sum(yearToDate(typeRows, now, thisYear - 1))
  const lastYear = sum(inYear(typeRows, thisYear - 1))
  const yearBefore = sum(inYear(typeRows, thisYear - 2))
  // Every tile chart follows the asset type but not the year or category filters.
  const withText = (points: { label: string; total: number }[]): TilePoint[] =>
    points.map((p) => ({ ...p, text: fmt.money(p.total) }))
  const tileHistory = withText(
    bucketed(
      typeRows,
      "month",
      { start: monthsBack(now, TILE_MONTHS), end: localDay(now) }
    ).map((p) => ({ label: p.fullLabel, total: p.total }))
  )
  const lastYearHistory = withText(lastYearMonthly(typeRows, now))
  const yearBars = withText(yearlyBars(typeRows, now))
  const dailyPoints = withText(dailyTotals(typeRows, now, DAILY_DAYS).map((d) => ({ label: fmt.date(d.date, { utc: true }), total: d.total })))

  // Equipment rolls into its property only when the view includes equipment (All).
  // Filtered to Properties it is not in the rows at all, and filtered to Equipment
  // the properties are not in the view, so there is nothing to nest under.
  const nested = assetType == null ? nestedByAsset(rows, assets.equipmentProperty) : null
  const assetLabel = (key: string) => {
    const { assetType: t, assetId } = parseAssetKey(key)
    return assets.assetName(t, assetId) ?? "Unknown"
  }
  const assetEntries = ranked(nested ? nested.top : byAsset(rows), {
    limit: TOP_ASSETS,
    label: assetLabel,
  })
  // Each asset's own history, on the same monthly grid, so the sparklines beside
  // the bars are comparable with one another rather than each self-scaled to a
  // different span of time. A property's history includes its equipment.
  const historyOf = (keys: string[]) => {
    const wanted = new Set(keys)
    const own = rows.filter((r) => wanted.has(assetKey(r.assetType, r.assetId)))
    return bucketed(own, granularity, range).map((p) => p.total)
  }

  // Colours and links are resolved here rather than passed to the charts as
  // callbacks: the chart components are client components, and a function cannot
  // cross the server/client boundary.
  const assetRows = assetEntries.flatMap((entry) => {
    const hrefOf = (key: string) => {
      const { assetType: t, assetId } = parseAssetKey(key)
      return assetHref(t, assetId)
    }
    const kids = nested?.children.get(entry.key)
    const parent = {
      ...entry,
      history: historyOf(kids ? [...kids.keys()] : [entry.key]),
      href: hrefOf(entry.key),
    }
    if (!kids) return [parent]
    const childRows = ranked(kids, {
      label: (key) => (key === entry.key ? "Property itself" : assetLabel(key)),
    }).map((c) => ({ ...c, depth: 1, history: historyOf([c.key]), href: hrefOf(c.key) }))
    return [parent, ...childRows]
  })

  // No cast needed: Map's methods are bivariant in TypeScript, so a
  // Map<CategoryKey, Bucket> is assignable to the Map<string, Bucket> ranked takes.
  const categoryEntries = ranked(byCategory(yearRows), {
    label: (key) => categoryLabel(key as CategoryKey),
  })
  const categorySlices = categoryEntries.map((entry) => ({
    ...entry,
    color: categoryColor(entry.key as CategoryKey),
    // Clicking the active category clears it, so the bar toggles rather than
    // trapping the reader in a filter they set by clicking a chart.
    href: `/costs${withParams(params, {
      category: entry.key === category ? undefined : entry.key,
    })}`,
  }))
  const vendorEntries = ranked(byVendor(rows), { limit: TOP_VENDORS })
  const biggest = [...rows].sort((a, b) => b.cost - a.cost).slice(0, BIGGEST_EXPENSES)
  const biggestMax = biggest[0]?.cost ?? 0

  return (
    <div className="space-y-6">
      <Heading />
      {filters}

      {/* Year-filter-independent on purpose: these labels name their own periods,
          so narrowing them to a selected year would make "All time" untrue. */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi
          label={`${thisYear} to date`}
          value={fmt.money(ytd)}
          delta={ytdPrior > 0 ? (ytd - ytdPrior) / ytdPrior : null}
          deltaNote={`vs ${fmt.money(ytdPrior)} by this point in ${thisYear - 1}`}
          chart={{ kind: "line", points: tileHistory, label: `Monthly spending over the last ${TILE_MONTHS} months` }}
        />
        <Kpi
          label={`All of ${thisYear - 1}`}
          value={fmt.money(lastYear)}
          delta={yearBefore > 0 ? (lastYear - yearBefore) / yearBefore : null}
          deltaNote={`vs ${fmt.money(yearBefore)} in ${thisYear - 2}`}
          chart={{ kind: "line", points: lastYearHistory, label: `Monthly spending in ${thisYear - 1}, January to December` }}
        />
        {/* All time is cumulative, so a line could only ever rise: it gets a bar per
            year instead. The monthly average has no trend line of its own (it would
            repeat the first tile), so it shows the last 60 days day by day. */}
        <Kpi
          label="All time"
          value={fmt.money(sum(typeRows))}
          chart={{
            kind: "bars",
            points: yearBars,
            label: "Total spending for each year",
            edgeLabels: [yearBars[0]?.label ?? "", yearBars[yearBars.length - 1]?.label ?? ""],
          }}
        />
        <Kpi
          label="Average per month"
          value={fmt.money(averagePerMonth(typeRows, now))}
          chart={{
            kind: "bars",
            points: dailyPoints,
            label: `Daily spending over the last ${DAILY_DAYS} days`,
            edgeLabels: [dailyPoints[0].label, dailyPoints[dailyPoints.length - 1].label],
          }}
        />
      </div>

      <Panel title={year != null ? `Spend through ${year}` : "Spend over time"}>
        <TrendChart
          buckets={buckets}
          trend={trend}
          trendWindow={TREND_WINDOW}
          // Clicking a period narrows to its year, but only while no year is
          // selected — once one is, every column is already inside it and the
          // click would be a no-op dressed up as a control.
          bucketHrefs={
            year == null
              ? buckets.map((b) => `/costs${withParams(params, { year: Number(b.key.split("-")[0]) })}`)
              : undefined
          }
        />
      </Panel>

      <Panel title="Spend by category">
        <CompositionBar
          entries={categorySlices}
          activeKey={category}
          caption="Share of spending by category"
        />
      </Panel>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="Spend by asset">
          <RankedBars entries={assetRows} valueLabel="Spend" caption="Spending by asset" />
        </Panel>

        <Panel title="Top vendors">
          <RankedBars
            entries={vendorEntries}
            emptyMessage="No vendors recorded yet."
            valueLabel="Spend"
            caption="Spending by vendor"
            size="compact"
          />
        </Panel>

        <Panel title="Biggest single expenses" className="lg:col-span-2">
          <ul className="space-y-0.5">
            {biggest.map((row, i) => (
              <BiggestRow key={`${row.title}-${i}`} row={row} assets={assets} max={biggestMax} fmt={fmt} />
            ))}
          </ul>
        </Panel>
      </div>

      {plannedPanel}
    </div>
  )
}

/// Reminders with an estimated cost, spread over the next 12 months. No card at all
/// when nothing is estimated and nothing is waiting on a mileage.
function PlannedPanel({
  forecast,
  today,
  assets,
  fmt,
}: {
  forecast: Forecast
  today: Date
  assets: Awaited<ReturnType<typeof loadAssetIndex>>
  fmt: Formatter
}) {
  if (forecast.total === 0 && forecast.mileageOnly === 0) return null
  const note = mileageNote(forecast.mileageOnly)
  const monthRows: RankedRow[] = forecastByMonth(forecast.occurrences, today).map((m) => ({
    ...m,
    label: m.start.toLocaleString(undefined, { month: "short", year: "numeric", timeZone: "UTC" }),
  }))
  const itemRows: RankedRow[] = largestPlanned(forecast.occurrences, TOP_PLANNED).map((item) => ({
    key: item.scheduleId,
    label: `${item.title} · ${assets.assetName(item.assetType, item.assetId) ?? "Unknown"}`,
    total: item.total,
    count: item.count,
    share: item.share,
    href: `${assetHref(item.assetType, item.assetId)}?tab=${item.assetType === "PERSON" ? "reminders" : "maintenance"}&open=${item.scheduleId}`,
  }))

  return (
    <Panel title="Planned, next 12 months">
      <div className="text-[22px] font-semibold leading-none">{fmt.money(forecast.total)}</div>
      {note && <p className="mt-1.5 text-xs text-muted-foreground">{note}</p>}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <RankedBars entries={monthRows} valueLabel="Planned" caption="Planned spend by month" size="compact" countNoun="occurrence" />
        <RankedBars entries={itemRows} valueLabel="Planned" caption="Largest planned items" size="compact" countNoun="occurrence" emptyMessage="Nothing planned with a date." />
      </div>
    </Panel>
  )
}

function Heading() {
  return (
    <div>
      <h1 className="font-heading text-2xl font-semibold">Costs</h1>
      <p className="mt-0.5 text-sm text-muted-foreground">
        What your homes, vehicles, and equipment have cost to keep.
      </p>
    </div>
  )
}

function Kpi({
  label,
  value,
  delta,
  deltaNote,
  chart,
}: {
  label: string
  value: string
  /// Signed fraction against the named prior period, or null when there is no
  /// prior period to compare against.
  delta?: number | null
  deltaNote?: string
  /// A line, or bars where a line could not show the figure honestly.
  chart?: { kind: "line" | "bars"; points: TilePoint[]; label: string; edgeLabels?: [string, string] }
}) {
  return (
    <Card className="py-4">
      <CardContent className="px-5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
          {/* Proportional figures, not tabular: at this size equal-width digits
              make a number like $121 read loose. tabular-nums is for columns. */}
          <div className="text-[22px] font-semibold leading-none">{value}</div>
          {delta != null ? <DeltaChip delta={delta} /> : null}
        </div>
        <div className="mt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        {chart && chart.points.length > 1 ? (
          <div className="mt-3">
            <TileChart kind={chart.kind} points={chart.points} ariaLabel={chart.label} edgeLabels={chart.edgeLabels} />
          </div>
        ) : null}
        {deltaNote && delta != null ? (
          <p className="mt-2 text-[11px] text-muted-foreground">{deltaNote}</p>
        ) : null}
      </CardContent>
    </Card>
  )
}

/// Spending more is not automatically bad — a planned roof is not a regression —
/// so the chip states direction without colouring it as good or bad. Reserving
/// the status hues for actual status is also what keeps them meaningful elsewhere.
function DeltaChip({ delta }: { delta: number }) {
  const up = delta >= 0
  return (
    <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-muted-foreground">
      {up ? "↑" : "↓"} {Math.abs(delta * 100).toFixed(0)}%
    </span>
  )
}

function Panel({
  title,
  children,
  className,
}: {
  title: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <Card className={cn("py-5", className)}>
      <CardHeader className="px-5 pb-1">
        <CardTitle className="text-[13px] font-medium uppercase tracking-wide text-muted-foreground">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-5">{children}</CardContent>
    </Card>
  )
}

function BiggestRow({
  row,
  assets,
  max,
  fmt,
}: {
  row: CostRow
  assets: Awaited<ReturnType<typeof loadAssetIndex>>
  max: number
  fmt: Formatter
}) {
  const AssetIcon = assetIcon[row.assetType]
  const name = assets.assetName(row.assetType, row.assetId)
  return (
    <li>
      <Link
        href={`${assetHref(row.assetType, row.assetId)}?tab=${serviceTab(row.assetType)}&open=${row.id}`}
        className="relative flex items-center gap-2 overflow-hidden rounded-md px-2 py-2.5 text-sm transition-colors hover:bg-muted/60"
      >
        {/* A thin rule along the bottom edge rather than a wash behind the text:
            a filled block spanning part of a row reads as a selection, not as a
            measure, and it fights the hover state for the same signal. */}
        <span
          aria-hidden="true"
          className="absolute bottom-0 left-2 h-0.5 rounded-full"
          style={{
            width: max > 0 ? `calc((100% - 1rem) * ${Math.max(row.cost / max, 0.01)})` : "0%",
            backgroundColor: "var(--cost-bar)",
            opacity: 0.55,
          }}
        />
        <AssetIcon className="relative h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="relative flex-1 truncate">{row.title}</span>
        <span className="relative shrink-0 text-xs text-muted-foreground">{name ?? "Unknown"}</span>
        <span className="relative shrink-0 tabular-nums">{fmt.money(row.cost)}</span>
      </Link>
    </li>
  )
}

function FilterRow({
  params,
  years,
  types,
  assetType,
  year,
  granularity,
  category,
}: {
  params: Record<string, string | string[] | undefined>
  years: number[]
  types: { value: AssetType; label: string }[]
  assetType?: AssetType
  year?: number
  granularity: Granularity
  category?: CategoryKey
}) {
  return (
    // One filter row above everything it scopes, rather than a control tucked
    // inside the chart card it happens to drive. Every panel below re-reads the
    // same slice.
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
      <FilterGroup label="Assets">
        <FilterLink label="All" href={`/costs${withParams(params, { type: undefined })}`} active={!assetType} />
        {types.map((t) => (
          <FilterLink
            key={t.value}
            label={t.label}
            href={`/costs${withParams(params, { type: t.value })}`}
            active={assetType === t.value}
          />
        ))}
      </FilterGroup>

      <FilterGroup label="Year">
        <FilterLink label="All" href={`/costs${withParams(params, { year: "all" })}`} active={year == null} />
        {years.map((y) => (
          <FilterLink
            key={y}
            label={String(y)}
            href={`/costs${withParams(params, { year: y })}`}
            active={year === y}
          />
        ))}
      </FilterGroup>

      <FilterGroup label="By">
        {GRANULARITY_FILTERS.map((g) => (
          <FilterLink
            key={g.value}
            label={g.label}
            href={`/costs${withParams(params, { bucket: g.value })}`}
            active={granularity === g.value}
          />
        ))}
      </FilterGroup>

      {/* The category filter has no chip row of its own — it is set by clicking
          the composition bar. It still needs to be visible and clearable here,
          or a reader who clicked a slice has no way back other than the browser. */}
      {category ? (
        <FilterGroup label="Category">
          <Link
            href={`/costs${withParams(params, { category: undefined })}`}
            className="relative flex items-center gap-1 rounded-md bg-primary/10 px-2.5 py-1 text-xs max-sm:before:absolute max-sm:before:top-1/2 max-sm:before:left-1/2 max-sm:before:h-10 max-sm:before:w-full max-sm:before:-translate-1/2 font-medium text-primary transition-colors hover:bg-primary/20"
          >
            <span
              aria-hidden="true"
              className="h-2 w-2 rounded-sm"
              style={{ backgroundColor: categoryColor(category) }}
            />
            {categoryLabel(category)}
            <X className="h-3 w-3" aria-hidden="true" />
            <span className="sr-only">Clear category filter</span>
          </Link>
        </FilterGroup>
      ) : null}
    </div>
  )
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="mr-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  )
}

function FilterLink({ label, href, active }: { label: string; href: string; active: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={cn(
        "relative rounded-md px-2.5 py-1 text-xs font-medium transition-colors duration-150 max-sm:before:absolute max-sm:before:top-1/2 max-sm:before:left-1/2 max-sm:before:h-10 max-sm:before:w-full max-sm:before:-translate-1/2",
        active
          ? "bg-primary/10 text-primary"
          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
      )}
    >
      {label}
    </Link>
  )
}
