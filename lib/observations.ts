import type { FieldOption } from "@/lib/form-types"
import { assetHref } from "@/lib/assets"

// Pure helpers for health observations (meltdowns, bad nights, symptoms…),
// shared by the person page, the printable summary and the assistant's tool.
// Observation dates are stored as midnight UTC, like every other health day.

export type ObservationLike = {
  date: Date
  time: string | null
  type: string
  severity: number | null
  durationMinutes: number | null
  conditionId?: string | null
}

export const SEVERITIES: FieldOption[] = [
  { value: "1", label: "1 · Mild" },
  { value: "2", label: "2" },
  { value: "3", label: "3 · Moderate" },
  { value: "4", label: "4" },
  { value: "5", label: "5 · Severe" },
]

export const RANGES = [
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "365", label: "12 months" },
  { value: "all", label: "All" },
] as const
export type RangeValue = (typeof RANGES)[number]["value"]

const DAY = 86_400_000

/** Opens the entry on its person's Observations tab. */
export const observationHref = (personId: string, id: string) => `${assetHref("PERSON", personId)}?tab=observations&open=${id}`

/** Midnight UTC of the calendar day `now` falls on in UTC. */
export function utcDay(now: Date): number {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
}

/** "45 min", "1 h", "1 h 30 min". */
export function formatDuration(minutes: number | null | undefined): string {
  if (minutes == null) return "—"
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (!h) return `${m} min`
  return m ? `${h} h ${m} min` : `${h} h`
}

/** Types used before, most frequent first — the form offers these as you type. */
export function typeSuggestions(rows: { type: string }[]): string[] {
  const counts = new Map<string, { label: string; n: number }>()
  for (const r of rows) {
    const key = r.type.trim().toLowerCase()
    const hit = counts.get(key)
    if (hit) hit.n++
    else counts.set(key, { label: r.type.trim(), n: 1 })
  }
  return [...counts.values()].sort((a, b) => b.n - a.n || a.label.localeCompare(b.label)).map((c) => c.label)
}

export const sameType = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

export type ObservationFilter = { type?: string | null; conditionId?: string | null; range?: RangeValue }

/** Newest first is left to the caller; this only filters. */
export function filterObservations<T extends ObservationLike>(rows: T[], f: ObservationFilter, now: Date): T[] {
  const since = f.range && f.range !== "all" ? utcDay(now) - (Number(f.range) - 1) * DAY : null
  return rows.filter(
    (r) =>
      (!f.type || sameType(r.type, f.type)) &&
      (!f.conditionId || r.conditionId === f.conditionId) &&
      (since === null || new Date(r.date).getTime() >= since)
  )
}

export type WeekBucket = { start: string; count: number; avgSeverity: number | null }

/** Counts per week (weeks start Monday), oldest first, ending with the week containing `now`. */
export function weeklyCounts(rows: ObservationLike[], weeks: number, now: Date): WeekBucket[] {
  const today = utcDay(now)
  const weekday = (new Date(today).getUTCDay() + 6) % 7 // Monday = 0
  const lastStart = today - weekday * DAY
  const buckets = Array.from({ length: weeks }, (_, i) => ({
    startMs: lastStart - (weeks - 1 - i) * 7 * DAY,
    count: 0,
    severities: [] as number[],
  }))
  const first = buckets[0].startMs
  for (const r of rows) {
    const t = new Date(r.date).getTime()
    if (t < first || t >= lastStart + 7 * DAY) continue
    const b = buckets[Math.floor((t - first) / (7 * DAY))]
    b.count++
    if (r.severity != null) b.severities.push(r.severity)
  }
  return buckets.map((b) => ({
    start: new Date(b.startMs).toISOString().slice(0, 10),
    count: b.count,
    avgSeverity: b.severities.length ? round1(b.severities.reduce((s, n) => s + n, 0) / b.severities.length) : null,
  }))
}

export type ObservationSummary = {
  count: number
  byType: { type: string; count: number }[]
  avgSeverity: number | null
  totalMinutes: number | null
}

export function summarizeObservations(rows: ObservationLike[]): ObservationSummary {
  const severities = rows.map((r) => r.severity).filter((n): n is number => n != null)
  const minutes = rows.map((r) => r.durationMinutes).filter((n): n is number => n != null)
  const byType = new Map<string, { type: string; count: number }>()
  for (const r of rows) {
    const key = r.type.trim().toLowerCase()
    const hit = byType.get(key)
    if (hit) hit.count++
    else byType.set(key, { type: r.type.trim(), count: 1 })
  }
  return {
    count: rows.length,
    byType: [...byType.values()].sort((a, b) => b.count - a.count || a.type.localeCompare(b.type)),
    avgSeverity: severities.length ? round1(severities.reduce((s, n) => s + n, 0) / severities.length) : null,
    totalMinutes: minutes.length ? minutes.reduce((s, n) => s + n, 0) : null,
  }
}

/** Newest first: by day, then by time (untimed entries after timed ones on the same day). */
export function byNewest(a: ObservationLike, b: ObservationLike): number {
  const d = new Date(b.date).getTime() - new Date(a.date).getTime()
  if (d) return d
  return (b.time ?? "").localeCompare(a.time ?? "")
}

const round1 = (n: number) => Math.round(n * 10) / 10
