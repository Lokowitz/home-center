import type { AssetType, ServiceCategory } from "@/app/generated/prisma/client"
import { localDay } from "@/lib/equipment-life"

// Pure, client-safe cost aggregation. Anything needing the database lives in
// lib/costs-server.ts instead, matching the assets.ts / assets-server.ts split.

/// The minimal row shape every rollup works from. Deliberately not the Prisma
/// model: these functions must stay usable from a client component and testable
/// without a database.
export type CostRow = {
  id: string
  assetId: string
  assetType: AssetType
  date: Date
  cost: number
  category: ServiceCategory | null
  vendor: string | null
  title: string
  mileageAtService: number | null
}

export type Bucket = { total: number; count: number }

/// Map key standing in for `category === null`. Records logged before categories
/// existed get their own bucket rather than being folded into OTHER, which would
/// misstate every one of them.
export const UNCATEGORIZED = "UNCATEGORIZED"

export type CategoryKey = ServiceCategory | typeof UNCATEGORIZED

/// Categories for houses, vehicles and equipment.
export const ASSET_CATEGORIES: { value: ServiceCategory; label: string }[] = [
  { value: "ROUTINE", label: "Routine" },
  { value: "REPAIR", label: "Repair" },
  { value: "UPGRADE", label: "Upgrade" },
  { value: "INSPECTION", label: "Inspection" },
  { value: "PARTS", label: "Parts" },
  { value: "OTHER", label: "Other" },
]

const MEDICAL_ONLY: { value: ServiceCategory; label: string }[] = [
  { value: "OFFICE_VISIT", label: "Office visit" },
  { value: "PRESCRIPTION", label: "Prescription" },
  { value: "LAB", label: "Lab / imaging" },
  { value: "DENTAL", label: "Dental" },
  { value: "VISION", label: "Vision" },
  { value: "PROCEDURE", label: "Procedure" },
  { value: "THERAPY", label: "Therapy" },
]

const OTHER_CATEGORY = { value: "OTHER" as ServiceCategory, label: "Other" }

/// Categories for people's visits and medical expenses.
export const MEDICAL_CATEGORIES = [...MEDICAL_ONLY, OTHER_CATEGORY]

/// Every category, in the fixed order the charts colour them. Other stays last
/// among the real categories whichever set it came from.
export const SERVICE_CATEGORIES = [
  ...ASSET_CATEGORIES.filter((c) => c.value !== "OTHER"),
  ...MEDICAL_ONLY,
  OTHER_CATEGORY,
]

export const SERVICE_CATEGORY_VALUES = [
  "ROUTINE", "REPAIR", "UPGRADE", "INSPECTION", "PARTS", "OTHER",
  "OFFICE_VISIT", "PRESCRIPTION", "LAB", "DENTAL", "VISION", "PROCEDURE", "THERAPY",
] as const satisfies readonly ServiceCategory[]

export function categoriesFor(assetType: AssetType) {
  return assetType === "PERSON" ? MEDICAL_CATEGORIES : ASSET_CATEGORIES
}

// Fixed order, assigned in sequence and never cycled — the colour a category
// wears must not depend on which categories happen to be on screen. Uncategorized
// sorts last because it is an absence, not a kind of spending.
export const CATEGORY_ORDER: CategoryKey[] = [
  ...SERVICE_CATEGORIES.map((c) => c.value),
  UNCATEGORIZED,
]

const CATEGORY_LABELS = Object.fromEntries(
  SERVICE_CATEGORIES.map((c) => [c.value, c.label])
) as Record<ServiceCategory, string>

export function categoryLabel(key: CategoryKey): string {
  return key === UNCATEGORIZED ? "Uncategorized" : CATEGORY_LABELS[key] ?? "Other"
}

// Colours are CSS variables, not literals, so light and dark are one definition
// in globals.css rather than a branch in every component.
const CATEGORY_COLORS: Record<CategoryKey, string> = {
  ROUTINE: "var(--cost-routine)",
  REPAIR: "var(--cost-repair)",
  UPGRADE: "var(--cost-upgrade)",
  INSPECTION: "var(--cost-inspection)",
  PARTS: "var(--cost-parts)",
  OTHER: "var(--cost-other)",
  OFFICE_VISIT: "var(--cost-office-visit)",
  PRESCRIPTION: "var(--cost-prescription)",
  LAB: "var(--cost-lab)",
  DENTAL: "var(--cost-dental)",
  VISION: "var(--cost-vision)",
  PROCEDURE: "var(--cost-procedure)",
  THERAPY: "var(--cost-therapy)",
  [UNCATEGORIZED]: "var(--cost-uncategorized)",
}

export function categoryColor(key: CategoryKey): string {
  return CATEGORY_COLORS[key]
}

/// `ServiceRecord.cost` is a SQLite Float, so summing many of them accumulates
/// sub-cent drift. Every rollup rounds at its boundary.
export function cents(n: number): number {
  return Math.round(n * 100) / 100
}

/// The one primitive every grouping is built from. Returning `null` from `keyFn`
/// drops the row, which is how records with no vendor stay out of vendor
/// rankings without a separate filtering pass.
export function rollup<K extends string>(
  rows: CostRow[],
  keyFn: (row: CostRow) => K | null
): Map<K, Bucket> {
  const out = new Map<K, Bucket>()
  for (const row of rows) {
    const key = keyFn(row)
    if (key === null) continue
    const bucket = out.get(key)
    if (bucket) {
      bucket.total += row.cost
      bucket.count += 1
    } else {
      out.set(key, { total: row.cost, count: 1 })
    }
  }
  for (const bucket of out.values()) bucket.total = cents(bucket.total)
  return out
}

export function assetKey(assetType: AssetType, assetId: string): string {
  return `${assetType}:${assetId}`
}

export function parseAssetKey(key: string): { assetType: AssetType; assetId: string } {
  const i = key.indexOf(":")
  return { assetType: key.slice(0, i) as AssetType, assetId: key.slice(i + 1) }
}

/// Record dates are stored as UTC midnight, so period math below reads them with
/// UTC getters. `now` is a real instant: pass it through localDay first, so today
/// and a record dated today fall on the same day in any server time zone.

/// The first day of the month `count - 1` months before now's month, for a range
/// of the last `count` months ending now.
export function monthsBack(now: Date, count: number): Date {
  return new Date(Date.UTC(now.getFullYear(), now.getMonth() - (count - 1), 1))
}

export function byYear(rows: CostRow[]): Map<string, Bucket> {
  return rollup(rows, (r) => String(r.date.getUTCFullYear()))
}

export function byAsset(rows: CostRow[]): Map<string, Bucket> {
  return rollup(rows, (r) => assetKey(r.assetType, r.assetId))
}

export type NestedAssets = {
  /// Property totals include the equipment installed there.
  top: Map<string, Bucket>
  /// Per parent key: its own direct spend plus each equipment item, keyed by
  /// asset key. Present only for properties that have equipment spend.
  children: Map<string, Map<string, Bucket>>
}

/// Like byAsset, but equipment spend rolls into its property. Callers pass this
/// only when equipment is part of the view — rolling it into a property the
/// reader filtered down to alone would overstate that filter's total.
export function nestedByAsset(rows: CostRow[], equipmentProperty: Map<string, string>): NestedAssets {
  const parentOf = (r: CostRow) => {
    const propertyId = r.assetType === "EQUIPMENT" ? equipmentProperty.get(r.assetId) : undefined
    return propertyId ? assetKey("PROPERTY", propertyId) : assetKey(r.assetType, r.assetId)
  }
  const top = rollup(rows, parentOf)
  const children = new Map<string, Map<string, Bucket>>()
  for (const parent of top.keys()) {
    const group = rows.filter((r) => parentOf(r) === parent)
    if (group.some((r) => assetKey(r.assetType, r.assetId) !== parent)) {
      children.set(parent, byAsset(group))
    }
  }
  return { top, children }
}

export function byCategory(rows: CostRow[]): Map<CategoryKey, Bucket> {
  return rollup(rows, (r) => (r.category ?? UNCATEGORIZED) as CategoryKey)
}

export function byVendor(rows: CostRow[]): Map<string, Bucket> {
  return rollup(rows, (r) => {
    const v = r.vendor?.trim()
    return v ? v : null
  })
}

/// React key for a row in a ranked list. A property's "Property itself" row repeats
/// the property's own asset key one level down, so the key alone is not unique.
export function rankedRowKey(entry: { key: string; depth?: number }): string {
  return `${entry.depth ?? 0}:${entry.key}`
}

export type RankedEntry = {
  key: string
  label: string
  total: number
  count: number
  /// This entry's total as a fraction of the largest total, for bar width.
  share: number
}

/// Sorted descending, with a key tiebreaker so equal totals keep a stable order
/// between renders.
export function ranked(
  map: Map<string, Bucket>,
  { limit, label }: { limit?: number; label?: (key: string) => string } = {}
): RankedEntry[] {
  const sorted = [...map.entries()].sort(
    (a, b) => b[1].total - a[1].total || a[0].localeCompare(b[0])
  )
  const max = sorted[0]?.[1].total ?? 0
  return (limit ? sorted.slice(0, limit) : sorted).map(([key, bucket]) => ({
    key,
    label: label ? label(key) : key,
    total: bucket.total,
    count: bucket.count,
    share: max > 0 ? bucket.total / max : 0,
  }))
}

export type StackSegment = { key: CategoryKey; label: string; color: string; total: number }

export function sum(rows: CostRow[]): number {
  return cents(rows.reduce((s, r) => s + r.cost, 0))
}

export function inYear(rows: CostRow[], year: number): CostRow[] {
  return rows.filter((r) => r.date.getUTCFullYear() === year)
}

/// Rows from 1 January of `year` through the same month and day as `now`.
/// Passing `now.getFullYear() - 1` gives the same window a year earlier, which is
/// what makes a year-on-year comparison fair in, say, March.
export function yearToDate(rows: CostRow[], now: Date, year: number = now.getFullYear()): CostRow[] {
  const today = localDay(now)
  const start = new Date(Date.UTC(year, 0, 1))
  const end = new Date(Date.UTC(year, today.getUTCMonth(), today.getUTCDate(), 23, 59, 59, 999))
  return rows.filter((r) => r.date >= start && r.date <= end)
}

/// Last calendar year, one total per month, January to December. Drawn beside the
/// first tile's rolling twelve months, it shows whether spending peaks in the same
/// season each year.
export function lastYearMonthly(rows: CostRow[], now: Date): { label: string; total: number }[] {
  const year = now.getFullYear() - 1
  return bucketed(inYear(rows, year), "month", costRange([], now, year)).map((p) => ({ label: p.fullLabel, total: p.total }))
}

/// One total per day for the last `days` days, oldest first, ending today. Days
/// with nothing stay in as zero, so quiet stretches show as gaps.
export function dailyTotals(rows: CostRow[], now: Date, days: number): { date: Date; total: number }[] {
  const dayKey = (d: Date) => `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`
  const totals = rollup<string>(rows, (r) => dayKey(r.date))
  const today = localDay(now)
  return Array.from({ length: days }, (_, i) => {
    const date = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - (days - 1 - i)))
    return { date, total: totals.get(dayKey(date))?.total ?? 0 }
  })
}

const YEARLY_BARS = 12

/// One total per calendar year, from the first year with a record to this one.
/// Years with nothing in them stay in as zero, so a gap reads as a gap. Capped at
/// the latest twelve so the bars stay readable.
export function yearlyBars(rows: CostRow[], now: Date): { label: string; total: number }[] {
  if (rows.length === 0) return []
  return bucketed(rows, "year", costRange(rows, now))
    .slice(-YEARLY_BARS)
    .map((p) => ({ label: p.label, total: p.total }))
}

/// Divides all-time spend by the months elapsed since the earliest costed record,
/// not by twelve — a household two months in should not be shown a twelve-month
/// average.
export function averagePerMonth(rows: CostRow[], now: Date): number {
  if (rows.length === 0) return 0
  const earliest = rows.reduce((min, r) => (r.date < min ? r.date : min), rows[0].date)
  const months = Math.max(
    1,
    (now.getFullYear() - earliest.getUTCFullYear()) * 12 + (now.getMonth() - earliest.getUTCMonth()) + 1
  )
  return cents(sum(rows) / months)
}

/// Cost per mile or hour across the meter span the records themselves cover.
/// Two readings are the minimum for a span to exist; anything less returns null
/// so the caller omits the figure rather than printing a divide-by-zero.
export function costPerMeter(rows: CostRow[]): number | null {
  const readings = rows.flatMap((r) => (r.mileageAtService != null ? [r.mileageAtService] : []))
  if (readings.length < 2) return null
  const span = Math.max(...readings) - Math.min(...readings)
  if (span <= 0) return null
  return sum(rows) / span
}

// ---------------------------------------------------------------------------
// Bucketing over a date range.
//
// `monthSeries` above answers one narrow question — the last N months ending
// now — which is all the dashboard needed. The costs page needs the same shaping
// at three granularities over an arbitrary range, so the general form lives here
// and the two share their gap-filling policy: a bucket with no spending is
// emitted as zero, never skipped. Skipping it would draw the chart straight
// across the gap and claim money was spent in a period that had none.
// ---------------------------------------------------------------------------

export type Granularity = "month" | "quarter" | "year"

export type DateRange = { start: Date; end: Date }

const GRANULARITIES: Granularity[] = ["month", "quarter", "year"]

export function isGranularity(value: unknown): value is Granularity {
  return typeof value === "string" && (GRANULARITIES as string[]).includes(value)
}

/// The first instant of the bucket `d` falls in.
function bucketStart(d: Date, g: Granularity): Date {
  if (g === "year") return new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  if (g === "quarter") return new Date(Date.UTC(d.getUTCFullYear(), Math.floor(d.getUTCMonth() / 3) * 3, 1))
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))
}

function nextBucket(d: Date, g: Granularity): Date {
  const step = g === "year" ? 12 : g === "quarter" ? 3 : 1
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + step, 1))
}

function bucketKeyOf(d: Date, g: Granularity): string {
  if (g === "year") return String(d.getUTCFullYear())
  if (g === "quarter") return `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}`
}

/// Two labels per bucket on purpose. `label` is the axis tick, kept short enough
/// that twelve of them fit side by side; `fullLabel` is unambiguous on its own and
/// is what the tooltip and the table view use, where there is room for it and no
/// neighbouring tick to supply the year.
function bucketLabels(d: Date, g: Granularity): { label: string; fullLabel: string } {
  const year = d.getUTCFullYear()
  if (g === "year") return { label: String(year), fullLabel: String(year) }
  if (g === "quarter") {
    const q = `Q${Math.floor(d.getUTCMonth() / 3) + 1}`
    return { label: q, fullLabel: `${q} ${year}` }
  }
  return {
    label: d.toLocaleString(undefined, { month: "short", timeZone: "UTC" }),
    fullLabel: d.toLocaleString(undefined, { month: "long", year: "numeric", timeZone: "UTC" }),
  }
}

/// The window the costs page charts. With a year selected it is that calendar
/// year; with none it runs from the earliest costed record to the bucket `now`
/// falls in, so the range is derived from the data rather than being a third
/// control the reader has to set.
export function costRange(rows: CostRow[], now: Date, year?: number): DateRange {
  if (year != null) return { start: new Date(Date.UTC(year, 0, 1)), end: new Date(Date.UTC(year, 11, 31)) }
  const today = localDay(now)
  if (rows.length === 0) return { start: bucketStart(today, "month"), end: today }
  const earliest = rows.reduce((min, r) => (r.date < min ? r.date : min), rows[0].date)
  return { start: earliest, end: today }
}

export type BucketPoint = {
  key: string
  label: string
  fullLabel: string
  total: number
  /// This bucket's total as a fraction of the largest in the series.
  share: number
}

export type StackedBucket = BucketPoint & { segments: StackSegment[] }

/// Every bucket start from `range.start` through `range.end`, inclusive of the
/// bucket the end falls in. Capped so a corrupt range cannot spin forever.
const MAX_BUCKETS = 600

function bucketStarts(range: DateRange, g: Granularity): Date[] {
  const out: Date[] = []
  let cursor = bucketStart(range.start, g)
  const last = bucketStart(range.end, g)
  while (cursor <= last && out.length < MAX_BUCKETS) {
    out.push(cursor)
    cursor = nextBucket(cursor, g)
  }
  return out
}

function withShares<T extends { total: number }>(points: T[]): (T & { share: number })[] {
  const max = Math.max(0, ...points.map((p) => p.total))
  return points.map((p) => ({ ...p, share: max > 0 ? p.total / max : 0 }))
}

export function bucketed(rows: CostRow[], g: Granularity, range: DateRange): BucketPoint[] {
  const totals = rollup<string>(rows, (r) => bucketKeyOf(r.date, g))
  return withShares(
    bucketStarts(range, g).map((start) => ({
      key: bucketKeyOf(start, g),
      ...bucketLabels(start, g),
      total: totals.get(bucketKeyOf(start, g))?.total ?? 0,
    }))
  )
}

export function stackedBuckets(rows: CostRow[], g: Granularity, range: DateRange): StackedBucket[] {
  const grouped = new Map<string, CostRow[]>()
  for (const row of rows) {
    const key = bucketKeyOf(row.date, g)
    const list = grouped.get(key)
    if (list) list.push(row)
    else grouped.set(key, [row])
  }

  return withShares(
    bucketStarts(range, g).map((start) => {
      const key = bucketKeyOf(start, g)
      const categories = byCategory(grouped.get(key) ?? [])
      // Walked in CATEGORY_ORDER, not the map's order, so a category keeps its
      // position in every stack whether or not its neighbours are present.
      const segments = CATEGORY_ORDER.filter((c) => categories.has(c)).map((c) => ({
        key: c,
        label: categoryLabel(c),
        color: categoryColor(c),
        total: categories.get(c)!.total,
      }))
      return {
        key,
        ...bucketLabels(start, g),
        total: cents(segments.reduce((s, seg) => s + seg.total, 0)),
        segments,
      }
    })
  )
}

/// Trailing mean over `window` buckets. The leading positions where the window is
/// not yet full emit `null` rather than a partial mean: a three-bucket average
/// that averages one bucket is just that bucket wearing a trend line's authority.
export function rollingAverage(points: BucketPoint[], window: number): (number | null)[] {
  return points.map((_, i) => {
    if (i + 1 < window) return null
    let total = 0
    for (let j = i - window + 1; j <= i; j++) total += points[j].total
    return cents(total / window)
  })
}

/// The same buckets one year earlier, aligned index-for-index with `points`, for
/// the year-on-year reference series. Returns totals only — the labels come from
/// the primary series, which is what the reader is actually looking at.
export function priorPeriod(rows: CostRow[], points: BucketPoint[], g: Granularity): number[] {
  const totals = rollup<string>(rows, (r) => bucketKeyOf(r.date, g))
  return points.map((point) => {
    // Reconstructing the key a year back from the key itself keeps this honest
    // for all three granularities without a second date walk.
    const prior = priorKey(point.key, g)
    return totals.get(prior)?.total ?? 0
  })
}

function priorKey(key: string, g: Granularity): string {
  if (g === "year") return String(Number(key) - 1)
  if (g === "quarter") {
    const [year, q] = key.split("-")
    return `${Number(year) - 1}-${q}`
  }
  const [year, month] = key.split("-")
  return `${Number(year) - 1}-${month}`
}
