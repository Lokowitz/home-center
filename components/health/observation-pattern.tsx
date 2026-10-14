import { useFormat } from "@/components/regional-provider"
import type { Formatter } from "@/lib/regional"
import type { WeekBucket } from "@/lib/observations"

const PLOT_HEIGHT = 96

const shortDay = (iso: string, fmt: Formatter) => fmt.dayMonth(new Date(`${iso}T00:00:00Z`), { utc: true })

function describeWeek(b: WeekBucket, fmt: Formatter): string {
  const sev = b.avgSeverity != null ? `, average severity ${b.avgSeverity}` : ""
  return `Week of ${shortDay(b.start, fmt)}: ${b.count} logged${sev}`
}

// A plain count per week — one hue, because bar length is the only thing that
// varies; which type is counted is chosen by the filter above it.
export function ObservationPattern({ weeks, label }: { weeks: WeekBucket[]; label: string }) {
  const fmt = useFormat()
  const max = Math.max(1, ...weeks.map((w) => w.count))
  const total = weeks.reduce((s, w) => s + w.count, 0)

  return (
    <figure className="rounded-lg border bg-card p-4">
      <figcaption className="mb-3 flex items-baseline justify-between gap-2 text-sm">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground">Last {weeks.length} weeks · {total} total</span>
      </figcaption>
      <div className="flex items-end gap-1" style={{ height: PLOT_HEIGHT }} aria-hidden="true">
        {weeks.map((w) => (
          <div key={w.start} className="group relative flex h-full flex-1 flex-col justify-end" title={describeWeek(w, fmt)}>
            {w.count > 0 && (
              <span className="mb-0.5 text-center text-[10px] leading-none text-muted-foreground tabular-nums">{w.count}</span>
            )}
            <div
              className="w-full rounded-sm bg-[var(--cost-bar)] transition-opacity group-hover:opacity-80"
              style={{ height: w.count ? `${Math.max(4, (w.count / max) * (PLOT_HEIGHT - 14))}px` : "1px", opacity: w.count ? 1 : 0.25 }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground" aria-hidden="true">
        <span>{shortDay(weeks[0].start, fmt)}</span>
        <span>This week</span>
      </div>
      <table className="sr-only">
        <caption>{label}, per week</caption>
        <thead><tr><th>Week of</th><th>Count</th><th>Average severity</th></tr></thead>
        <tbody>
          {weeks.map((w) => (
            <tr key={w.start}><td>{shortDay(w.start, fmt)}</td><td>{w.count}</td><td>{w.avgSeverity ?? "—"}</td></tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}
