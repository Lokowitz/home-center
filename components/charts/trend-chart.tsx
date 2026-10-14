"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { ChartFrame } from "./primitives/chart-frame"
import { XLabels } from "./primitives/axis"
import { Legend, type LegendItem } from "./primitives/legend"
import { ChartTable } from "./primitives/chart-table"
import { TooltipCard, useChartTooltip, type TooltipContent } from "./primitives/tooltip"
import { niceMax, niceTicks } from "./primitives/scale"
import {
  CATEGORY_ORDER, categoryColor, categoryLabel, type CategoryKey, type StackedBucket,
} from "@/lib/costs"
import { useFormat } from "@/components/regional-provider"

const PLOT_HEIGHT = 240
/// Bars are capped rather than filling their slot — the leftover is the air that
/// keeps a dense chart from reading as a solid block.
const MAX_BAR_WIDTH = 24
/// The gap that separates touching segments. Surface-coloured negative space,
/// not a stroke: a border would add ink that is not data.
const SEGMENT_GAP = 2

export function TrendChart({
  buckets,
  trend,
  trendWindow,
  bucketHrefs,
  maxLabels = 12,
  plotHeight = PLOT_HEIGHT,
}: {
  buckets: StackedBucket[]
  /// Trailing rolling average, aligned index-for-index with `buckets`; `null`
  /// where the window is not yet full.
  trend: (number | null)[]
  trendWindow: number
  /// Drill-down targets, aligned index-for-index with `buckets`; null where
  /// clicking would change nothing — a period already the only one on screen.
  /// An array rather than a callback because this is a client component and a
  /// function cannot cross the RSC boundary from the server page that renders it.
  bucketHrefs?: (string | null)[]
  maxLabels?: number
  /// The asset detail panels reuse this chart in a narrow column, where the
  /// full-height version would dominate the page it is a sidebar on.
  plotHeight?: number
}) {
  const fmt = useFormat()
  const [muted, setMuted] = useState<Set<string>>(new Set())
  const { containerRef, cardRef, tip, offset, anchorProps } = useChartTooltip()

  // Only categories actually present get a legend entry, walked in fixed order so
  // a category's colour never depends on which others happen to be on screen.
  const present = useMemo(
    () => CATEGORY_ORDER.filter((key) => buckets.some((b) => b.segments.some((s) => s.key === key))),
    [buckets]
  )

  const legendItems: LegendItem[] = present.map((key) => ({
    key,
    label: categoryLabel(key),
    color: categoryColor(key),
  }))

  // Muting recomputes the stack and rescales the axis, which is the point of it:
  // hiding the one category that dwarfs the rest is how the rest become readable.
  const visible = useMemo(
    () =>
      buckets.map((bucket) => {
        const segments = bucket.segments.filter((s) => !muted.has(s.key))
        return {
          ...bucket,
          segments,
          visibleTotal: segments.reduce((total, s) => total + s.total, 0),
        }
      }),
    [buckets, muted]
  )

  const peak = Math.max(0, ...visible.map((b) => b.visibleTotal))
  const domainMax = niceMax(peak)
  const ticks = niceTicks(peak)

  // The trend line follows the unmuted total, so it is only honest while nothing
  // is muted. Muting anything hides it rather than leaving a line that averages
  // series the reader can no longer see.
  const showTrend = muted.size === 0 && trend.some((v) => v !== null)

  const toggle = (key: string) =>
    setMuted((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const trendPath = useMemo(() => {
    if (!showTrend) return ""
    const points = trend.flatMap((value, i) =>
      value === null
        ? []
        : [{ x: ((i + 0.5) / buckets.length) * 100, y: (1 - value / domainMax) * 100 }]
    )
    if (points.length < 2) return ""
    return points
      .map((p, i) => (i === 0 ? "M" : "L") + p.x.toFixed(3) + "," + p.y.toFixed(3))
      .join(" ")
  }, [showTrend, trend, buckets.length, domainMax])

  if (buckets.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">No spending in this range.</p>
  }

  return (
    <div className="space-y-3">
      <ChartFrame
        plotHeight={plotHeight}
        ticks={ticks}
        domainMax={domainMax}
        formatTick={fmt.moneyCompact}
        xAxis={<XLabels labels={buckets.map((b) => b.label)} maxLabels={maxLabels} />}
      >
        <div ref={containerRef} className="absolute inset-0">
          <div className="flex h-full items-stretch">
            {visible.map((bucket, i) => {
              // Reversed so the tooltip lists categories top-down in the order
              // they are actually stacked on screen.
              const rows = bucket.segments
                .slice()
                .reverse()
                .map((segment) => ({
                  label: segment.label,
                  value: fmt.money(segment.total),
                  color: segment.color,
                }))
              const trendValue = showTrend ? trend[i] : null
              if (trendValue != null) {
                rows.push({
                  label: trendWindow + "-period average",
                  value: fmt.money(trendValue),
                  color: "var(--chart-trend)",
                })
              }
              const content: TooltipContent = {
                title: bucket.fullLabel,
                rows: rows.length > 0 ? rows : [{ label: "No spending", value: fmt.money(0) }],
                total: fmt.money(bucket.visibleTotal),
              }

              const href = bucketHrefs?.[i] ?? null
              const ariaLabel = bucket.fullLabel + ": " + fmt.money(bucket.visibleTotal)

              // The hit area is the whole column, not the drawn bar: a thin bar in
              // a dense chart is well below a comfortable target, and the reader
              // is aiming at the period rather than at the ink.
              const inner = (
                <div className="relative h-full w-full">
                  {(() => {
                    let cumulative = 0
                    return bucket.segments.map((segment, s) => {
                      const bottom = (cumulative / domainMax) * 100
                      cumulative += segment.total
                      const heightPct = (segment.total / domainMax) * 100
                      const isTop = s === bucket.segments.length - 1
                      return (
                        <div
                          key={segment.key}
                          className="chart-grow absolute left-1/2 -translate-x-1/2"
                          style={{
                            width: "80%",
                            maxWidth: MAX_BAR_WIDTH,
                            bottom: bottom + "%",
                            // The gap is taken out of the segment's own height, so
                            // the stack still totals to the right place.
                            height: "calc(" + heightPct + "% - " + SEGMENT_GAP + "px)",
                            backgroundColor: segment.color,
                            borderTopLeftRadius: isTop ? 4 : 0,
                            borderTopRightRadius: isTop ? 4 : 0,
                            animationDelay: Math.min(i * 18, 300) + "ms",
                          }}
                        />
                      )
                    })
                  })()}
                </div>
              )

              const shared = {
                className:
                  "relative flex min-w-0 flex-1 items-stretch rounded-sm outline-none transition-colors hover:bg-muted/40 focus-visible:bg-muted/50",
                ...anchorProps(content),
              }

              return href ? (
                <Link key={bucket.key} href={href} aria-label={ariaLabel} {...shared}>
                  {inner}
                </Link>
              ) : (
                <div key={bucket.key} tabIndex={0} role="img" aria-label={ariaLabel} {...shared}>
                  {inner}
                </div>
              )
            })}
          </div>

          {/* The rolling average. SVG because a polyline is the one shape CSS
              cannot draw. preserveAspectRatio="none" is right here rather than a
              distortion: the plot genuinely has independent x and y scales, and
              the axes state them. The non-scaling stroke holds the line at 2px
              whatever the container width. */}
          {trendPath ? (
            <svg
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
            >
              <path
                d={trendPath}
                fill="none"
                stroke="var(--chart-trend)"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
                opacity={0.85}
              />
            </svg>
          ) : null}

          <TooltipCard tip={tip} cardRef={cardRef} offset={offset} />
        </div>
      </ChartFrame>

      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <Legend items={legendItems} mutedKeys={muted} onToggle={toggle} />
        {/* Tied to the drawn path, not to the intent to draw one: a series short
            enough that the rolling average never fills its window produces no
            line, and a legend entry for an invisible line is a lie. */}
        {trendPath ? (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span
              aria-hidden="true"
              className="h-0.5 w-4 shrink-0 rounded-full"
              style={{ backgroundColor: "var(--chart-trend)" }}
            />
            {trendWindow}-period average
          </span>
        ) : null}
      </div>

      <ChartTable
        caption="Spending per period, broken down by category"
        columns={[
          { key: "period", label: "Period" },
          ...present.map((key) => ({ key, label: categoryLabel(key), align: "right" as const })),
          { key: "total", label: "Total", align: "right" as const },
        ]}
        rows={buckets.map((bucket) => ({
          period: bucket.fullLabel,
          ...Object.fromEntries(
            present.map((key: CategoryKey) => {
              const segment = bucket.segments.find((s) => s.key === key)
              return [key, segment ? fmt.money(segment.total) : "—"]
            })
          ),
          total: fmt.money(bucket.total),
        }))}
      />
    </div>
  )
}
