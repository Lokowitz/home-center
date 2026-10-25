"use client"

import Link from "next/link"
import { ChartTable } from "./primitives/chart-table"
import { TooltipCard, useChartTooltip } from "./primitives/tooltip"
import { Sparkline } from "./sparkline"
import { niceMax, niceTicks } from "./primitives/scale"
import { rankedRowKey, type RankedEntry } from "@/lib/costs"
import { useFormat } from "@/components/regional-provider"

// Nominal categories — assets, vendors — so every bar wears the same hue. Bar
// length already encodes magnitude; colouring each one differently would spend
// the identity channel re-encoding what the length already shows, and a
// darker-where-bigger ramp would do it twice.

export type RankedRow = RankedEntry & {
  /// Optional per-row history, drawn as a sparkline beside the bar. This is the
  /// thing a bare ranking cannot say: two assets with the same lifetime total
  /// are different propositions if one is winding down and the other is not.
  history?: number[]
  /// Resolved on the server rather than passed as an href-building callback.
  /// This is a client component, so every prop crossing into it has to be
  /// serializable, and a function is not.
  href?: string
  /// 1 for a row nested under the one above it, whose total is already counted
  /// in that row. Only the label is indented: the bar keeps the full width so
  /// every row stays on the one shared scale.
  depth?: number
}

export function RankedBars({
  entries,
  emptyMessage = "Nothing to show yet.",
  valueLabel = "Total",
  caption,
  size = "default",
  countNoun = "record",
}: {
  entries: RankedRow[]
  emptyMessage?: string
  valueLabel?: string
  caption?: string
  size?: "default" | "compact"
  /// What each entry counts, singular: "record" for spending, "occurrence" for planned spend.
  countNoun?: string
}) {
  const fmt = useFormat()
  const { containerRef, cardRef, tip, offset, anchorProps } = useChartTooltip()

  if (entries.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">{emptyMessage}</p>
  }

  // One scale across every row, stated by the ticks underneath. Without it the
  // bars are only relative to each other and a reader cannot attach a number to
  // any of them without hovering.
  const peak = Math.max(0, ...entries.map((e) => e.total))
  const domainMax = niceMax(peak, 3)
  const ticks = niceTicks(peak, 3)

  const barHeight = size === "compact" ? 6 : 8

  return (
    <div>
      <div ref={containerRef} className="relative">
        <ul className={size === "compact" ? "space-y-1.5" : "space-y-2"}>
          {entries.map((entry, i) => {
            const content = {
              title: entry.label,
              rows: [
                { label: valueLabel, value: fmt.money(entry.total) },
                {
                  label: entry.count === 1 ? `1 ${countNoun}` : `${entry.count} ${countNoun}s`,
                  value: fmt.money(entry.count > 0 ? entry.total / entry.count : 0) + " avg",
                  muted: true,
                },
              ],
            }

            const row = (
              <>
                <div className="flex items-baseline justify-between gap-3">
                  <span
                    className={entry.depth ? "truncate pl-4 text-[13px] text-muted-foreground" : "truncate text-sm"}
                  >
                    {entry.label}
                  </span>
                  <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
                    {fmt.money(entry.total)}
                  </span>
                </div>
                <div className="mt-1.5 flex items-center gap-2">
                  <div className="relative min-w-0 flex-1">
                    {/* Gridlines behind the bars, so the shared scale is visible
                        rather than merely claimed by the ticks below. */}
                    <div aria-hidden="true" className="pointer-events-none absolute inset-0">
                      {ticks.slice(1).map((tick) => (
                        <div
                          key={tick}
                          className="absolute inset-y-0 w-px"
                          style={{ left: (tick / domainMax) * 100 + "%", backgroundColor: "var(--chart-grid)" }}
                        />
                      ))}
                    </div>
                    <div
                      className="relative rounded-full bg-muted"
                      style={{ height: entry.depth ? Math.min(barHeight, 5) : barHeight }}
                    >
                      <div
                        className="chart-grow-x h-full rounded-full"
                        // A sub-pixel width vanishes entirely, so a real but tiny
                        // value keeps a visible sliver rather than rendering as
                        // nothing at all.
                        style={{
                          width: entry.total > 0 ? Math.max((entry.total / domainMax) * 100, 1.5) + "%" : "0%",
                          backgroundColor: "var(--cost-bar)",
                          animationDelay: Math.min(i * 30, 240) + "ms",
                        }}
                      />
                    </div>
                  </div>
                  {entry.history && entry.history.length > 1 ? (
                    <Sparkline
                      values={entry.history}
                      ariaLabel={"Spending history for " + entry.label}
                      className="h-5 w-16 shrink-0"
                      color="var(--chart-ghost)"
                      showArea={false}
                      showEnd={false}
                    />
                  ) : null}
                </div>
              </>
            )

            const shared = {
              className:
                "block rounded-md px-1.5 py-1 outline-none transition-colors hover:bg-muted/40 focus-visible:bg-muted/50",
              ...anchorProps(content),
            }

            return (
              <li key={rankedRowKey(entry)}>
                {entry.href ? (
                  <Link href={entry.href} {...shared}>
                    {row}
                  </Link>
                ) : (
                  <div tabIndex={0} {...shared}>
                    {row}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
        <TooltipCard tip={tip} cardRef={cardRef} offset={offset} />
      </div>

      {/* The axis sits under the whole list, not under each row — one scale, one
          statement of it. Inset to match the bars' own padding. */}
      <div aria-hidden="true" className="relative mt-2 h-4 px-1.5">
        {ticks.map((tick) => (
          <span
            key={tick}
            className="absolute top-0 -translate-x-1/2 text-[10px] tabular-nums text-muted-foreground"
            style={{ left: (tick / domainMax) * 100 + "%" }}
          >
            {fmt.moneyCompact(tick)}
          </span>
        ))}
      </div>

      <ChartTable
        caption={caption}
        columns={[
          { key: "label", label: "Name" },
          { key: "total", label: valueLabel, align: "right" },
          { key: "count", label: countNoun.charAt(0).toUpperCase() + countNoun.slice(1) + "s", align: "right" },
        ]}
        rows={entries.map((entry) => ({
          label: entry.depth ? "  " + entry.label : entry.label,
          total: fmt.money(entry.total),
          count: entry.count,
        }))}
      />
    </div>
  )
}
