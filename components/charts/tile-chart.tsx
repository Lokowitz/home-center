"use client"

import { Sparkline } from "./sparkline"
import { TooltipCard, useChartTooltip } from "./primitives/tooltip"

// The small chart on a stat tile: a line or a row of bars, like Sparkline it
// carries shape rather than values, and hovering (or focusing) a point names its
// period and amount. The tile's own figure and the charts below hold the same
// numbers, so the tooltip enhances and never gates.

const VIEW_W = 100
const VIEW_H = 30
const GAP = 0.25 // of a bar's slot
// Past this many points, tabbing through every one would trap keyboard users.
const FOCUSABLE_UP_TO = 12

export type TilePoint = {
  /// The period, written out for the tooltip title.
  label: string
  total: number
  /// The amount as the reader sees it, formatted by the caller.
  text: string
}

export function TileChart({
  kind,
  points,
  ariaLabel,
  edgeLabels,
  valueLabel = "Spend",
}: {
  kind: "line" | "bars"
  points: TilePoint[]
  ariaLabel: string
  /// Short first and last labels shown under the chart, for bars.
  edgeLabels?: [string, string]
  valueLabel?: string
}) {
  const { containerRef, cardRef, tip, offset, anchorProps } = useChartTooltip()
  if (points.length < 2) return null

  const max = Math.max(...points.map((p) => p.total))
  const scale = max > 0 ? max : 1
  const slot = VIEW_W / points.length
  const width = slot * (1 - GAP)
  const focusable = points.length <= FOCUSABLE_UP_TO

  return (
    <div>
      <div ref={containerRef} className="relative h-8">
        {kind === "line" ? (
          <Sparkline values={points.map((p) => p.total)} ariaLabel={ariaLabel} className="h-8 w-full" />
        ) : (
          <svg viewBox={"0 0 " + VIEW_W + " " + VIEW_H} preserveAspectRatio="none" className="h-8 w-full" role="img" aria-label={ariaLabel}>
            {points.map((p, i) => {
              // A real but tiny value keeps a visible sliver rather than vanishing.
              const height = p.total > 0 ? Math.max((p.total / scale) * VIEW_H, 1.5) : 0
              return (
                <rect key={p.label} x={i * slot + (slot - width) / 2} y={VIEW_H - height} width={width} height={height} rx={0.8} fill="var(--cost-bar)" />
              )
            })}
          </svg>
        )}

        {/* One invisible column per point over the chart, so the whole height of
            a thin bar or a flat stretch of line is a target. */}
        <div className="absolute inset-0 flex">
          {points.map((p) => (
            <div
              key={p.label}
              className="flex-1 rounded-sm outline-none hover:bg-foreground/5 focus-visible:bg-foreground/10"
              {...(focusable ? { tabIndex: 0, role: "img", "aria-label": p.label + ": " + p.text } : {})}
              {...anchorProps({ title: p.label, rows: [{ label: valueLabel, value: p.text }] })}
            />
          ))}
        </div>
        <TooltipCard tip={tip} cardRef={cardRef} offset={offset} />
      </div>
      {edgeLabels ? (
        <div className="mt-1 flex justify-between text-[10px] tabular-nums text-muted-foreground">
          <span>{edgeLabels[0]}</span>
          <span>{edgeLabels[1]}</span>
        </div>
      ) : null}
    </div>
  )
}
