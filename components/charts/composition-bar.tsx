"use client"

import Link from "next/link"
import { ChartTable } from "./primitives/chart-table"
import { Legend, type LegendItem } from "./primitives/legend"
import { TooltipCard, useChartTooltip } from "./primitives/tooltip"
import { type RankedEntry } from "@/lib/costs"
import { useFormat } from "@/components/regional-provider"

/// Colour and link resolved by the caller, on the server. A client component
/// cannot take a `colorFor(key)` or `hrefFor(entry)` callback across the RSC
/// boundary — functions are not serializable — so the data arrives resolved.
export type CompositionSlice = RankedEntry & { color: string; href?: string }

const BAR_HEIGHT = 40
const SEGMENT_GAP = 2

// Part-to-whole, at a glance. A stacked bar rather than a pie because the
// question here is "what is the mix", and reading a mix off angles is harder
// than reading it off one straight run.
export function CompositionBar({
  entries,
  activeKey,
  emptyMessage = "Nothing to show yet.",
  caption,
}: {
  entries: CompositionSlice[]
  activeKey?: string
  emptyMessage?: string
  caption?: string
}) {
  const fmt = useFormat()
  const { containerRef, cardRef, tip, offset, anchorProps } = useChartTooltip()

  const total = entries.reduce((sum, e) => sum + e.total, 0)
  if (entries.length === 0 || total <= 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">{emptyMessage}</p>
  }

  // The share rides in the legend rather than inside the segment. A label set on
  // the fill has to clear contrast against whichever hue lands under it, and
  // three of this ramp's light slots cannot carry white text; the legend is on
  // the card surface, where every label is legible by construction.
  const legendItems: LegendItem[] = entries.map((entry) => ({
    key: entry.key,
    label: entry.label + "  " + Math.round((entry.total / total) * 100) + "%",
    color: entry.color,
  }))

  const hrefByKey = new Map(entries.flatMap((e) => (e.href ? [[e.key, e.href] as const] : [])))
  const linked = hrefByKey.size > 0

  return (
    <div className="space-y-3">
      <div ref={containerRef} className="relative">
        <div className="flex w-full overflow-hidden" style={{ height: BAR_HEIGHT }}>
          {entries.map((entry, i) => {
            const percent = (entry.total / total) * 100
            const color = entry.color
            const content = {
              title: entry.label,
              rows: [
                { label: "Spend", value: fmt.money(entry.total), color },
                { label: "Share", value: percent.toFixed(1) + "%", muted: true },
                {
                  label: entry.count === 1 ? "1 record" : entry.count + " records",
                  value: "",
                  muted: true,
                },
              ],
            }
            const isFirst = i === 0
            const isLast = i === entries.length - 1
            const dimmed = activeKey != null && activeKey !== entry.key

            const body = (
              <span
                className="chart-grow-x block h-full w-full"
                style={{
                  backgroundColor: color,
                  opacity: dimmed ? 0.35 : 1,
                  borderTopLeftRadius: isFirst ? 4 : 0,
                  borderBottomLeftRadius: isFirst ? 4 : 0,
                  borderTopRightRadius: isLast ? 4 : 0,
                  borderBottomRightRadius: isLast ? 4 : 0,
                  animationDelay: Math.min(i * 40, 240) + "ms",
                }}
              />
            )

            const shared = {
              className: "block h-full outline-none transition-opacity focus-visible:opacity-80",
              style: {
                width: percent + "%",
                // Negative space does the separating, at the same width as every
                // other stack in the app.
                marginRight: isLast ? 0 : SEGMENT_GAP,
              },
              ...anchorProps(content),
            }

            return entry.href ? (
              <Link
                key={entry.key}
                href={entry.href}
                aria-label={entry.label + ": " + fmt.money(entry.total)}
                {...shared}
              >
                {body}
              </Link>
            ) : (
              <div
                key={entry.key}
                tabIndex={0}
                role="img"
                aria-label={entry.label + ": " + fmt.money(entry.total)}
                {...shared}
              >
                {body}
              </div>
            )
          })}
        </div>
        <TooltipCard tip={tip} cardRef={cardRef} offset={offset} />
      </div>

      {/* The legend and the bar are the same control: both set the category
          filter, so clicking a label does exactly what clicking its slice does. */}
      <Legend
        items={legendItems}
        hrefFor={linked ? (item) => hrefByKey.get(item.key) ?? "" : undefined}
        activeKey={activeKey}
      />

      <ChartTable
        caption={caption}
        columns={[
          { key: "label", label: "Category" },
          { key: "total", label: "Spend", align: "right" },
          { key: "share", label: "Share", align: "right" },
          { key: "count", label: "Records", align: "right" },
        ]}
        rows={entries.map((entry) => ({
          label: entry.label,
          total: fmt.money(entry.total),
          share: ((entry.total / total) * 100).toFixed(1) + "%",
          count: entry.count,
        }))}
      />
    </div>
  )
}
