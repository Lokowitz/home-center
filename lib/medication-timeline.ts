// Pure, client-safe logic behind the medication timeline. Dates are UTC
// midnight (see lib/health.ts), and an end date is taken through the whole of
// that day, so a segment's drawn end is the day after its stored endDate.

const DAY = 86_400_000

/// The Medications tab's List / Timeline choice, kept in a cookie the page
/// reads on the server (the same approach as the asset list layouts).
export type MedicationView = "list" | "timeline"
export const MEDICATION_VIEW_COOKIE = "hc-view-medications"
export const parseMedicationView = (value: string | undefined | null): MedicationView =>
  value === "timeline" ? "timeline" : "list"

export type TimelineMedication = {
  id: string
  name: string
  dosage: string | null
  frequency: string | null
  startDate: Date | null
  endDate: Date | null
  notes: string | null
  condition?: { name: string } | null
}

export type ParsedDose = { value: number; unit: string }

export type DoseChange = "start" | "up" | "down" | "same" | "restart"

export type TimelineSegment = {
  med: TimelineMedication
  /// UTC ms, inclusive.
  start: number
  /// UTC ms, exclusive: the day after the stored end date, or now when ongoing.
  end: number
  ongoing: boolean
  /// Started and stopped on the same day: drawn as a marker, not a bar.
  point: boolean
  dose: ParsedDose | null
  /// 0..1 within this medication (same unit), null when the dose can't be compared.
  intensity: number | null
  change: DoseChange
  /// The dosage text of the segment this one directly followed, for "up from".
  previousDosage: string | null
}

export type TimelineLane = {
  key: string
  name: string
  segments: TimelineSegment[]
  first: number
  last: number
  active: boolean
  current: TimelineSegment | null
}

/// Medications by start date: earliest first ("asc", how the timeline reads) or
/// most recent first ("desc", how the past list reads). Rows without a start
/// date go last either way; ties fall back to end date in the same direction,
/// then name.
export function sortChronologically<T extends { startDate: Date | null; endDate: Date | null; name: string }>(
  rows: T[],
  order: "asc" | "desc" = "asc"
): T[] {
  const sign = order === "asc" ? 1 : -1
  const cmp = (a: Date | null, b: Date | null) => {
    if (!a || !b) return a ? -1 : b ? 1 : 0
    return sign * (new Date(a).getTime() - new Date(b).getTime())
  }
  return [...rows].sort(
    (a, b) => cmp(a.startDate, b.startDate) || cmp(a.endDate, b.endDate) || a.name.localeCompare(b.name)
  )
}

const UNIT_ALIASES: Record<string, string> = {
  mg: "mg", mgs: "mg", milligram: "mg", milligrams: "mg",
  mcg: "mcg", µg: "mcg", ug: "mcg",
  g: "g", ml: "ml", iu: "iu", units: "iu", unit: "iu", k: "k",
  pill: "pill", pills: "pill", tab: "tab", tabs: "tab", tablet: "tab", tablets: "tab",
  capsule: "cap", capsules: "cap", cap: "cap", caps: "cap", drop: "drop", drops: "drop", puff: "puff", puffs: "puff",
}

/// The first amount in a free-text dosage: "150 mg", "0.05mg", "1/2 pill",
/// "1.5 pills", "300 mg (later 400 mg)". Anything without a number is null.
export function parseDose(text: string | null | undefined): ParsedDose | null {
  if (!text) return null
  const m = text.trim().toLowerCase().match(/(\d+(?:\.\d+)?)(?:\s*\/\s*(\d+(?:\.\d+)?))?\s*([a-zµ]+)?/)
  if (!m) return null
  const value = m[2] ? Number(m[1]) / Number(m[2]) : Number(m[1])
  if (!Number.isFinite(value) || value <= 0) return null
  const unit = (m[3] && UNIT_ALIASES[m[3]]) || ""
  return { value, unit }
}

const laneKey = (name: string) => name.trim().toLowerCase()

/// Group medications into one lane per drug, each lane's dose periods in date
/// order with the direction of every change worked out. Rows without a start
/// date can't be placed and are left out.
export function buildTimeline(meds: TimelineMedication[], now: Date): TimelineLane[] {
  const nowMs = now.getTime()
  const groups = new Map<string, TimelineMedication[]>()
  for (const m of meds) {
    if (!m.startDate) continue
    const key = laneKey(m.name)
    groups.set(key, [...(groups.get(key) ?? []), m])
  }

  const lanes: TimelineLane[] = []
  for (const [key, rows] of groups) {
    const ordered = sortChronologically(rows)
    const raw = ordered.map((m) => parseDose(m.dosage))
    // A bare number ("1000") is read in the lane's unit when every other dose
    // agrees on one ("3000 IU"), so the two compare instead of each scaling alone.
    const named = new Set(raw.filter((p) => p?.unit).map((p) => p!.unit))
    const parsed = raw.map((p) => (p && !p.unit && named.size === 1 ? { ...p, unit: [...named][0] } : p))
    const maxByUnit = new Map<string, number>()
    for (const p of parsed) if (p) maxByUnit.set(p.unit, Math.max(maxByUnit.get(p.unit) ?? 0, p.value))

    const segments: TimelineSegment[] = ordered.map((med, i) => {
      const start = new Date(med.startDate!).getTime()
      const ongoing = !med.endDate || new Date(med.endDate).getTime() + DAY > nowMs
      const storedEnd = med.endDate ? new Date(med.endDate).getTime() + DAY : nowMs
      const end = Math.max(start + DAY, ongoing && !med.endDate ? Math.max(nowMs, start + DAY) : storedEnd)
      const dose = parsed[i]
      // Doses compare only within one unit: 1.5 pills and 0.1 mg each scale
      // against the largest dose written the same way.
      const intensity = dose ? dose.value / maxByUnit.get(dose.unit)! : null
      const prev = i > 0 ? ordered[i - 1] : null
      const prevEnd = prev ? (prev.endDate ? new Date(prev.endDate).getTime() + DAY : nowMs) : null
      // Within three days of the previous period ending counts as a dose change;
      // a longer gap means the medication was stopped and restarted.
      const contiguous = prevEnd != null && start - prevEnd <= 3 * DAY
      let change: DoseChange = "start"
      if (prev && !contiguous) change = "restart"
      else if (prev) {
        const a = parsed[i - 1]
        change = a && dose && a.unit === dose.unit ? (dose.value > a.value ? "up" : dose.value < a.value ? "down" : "same") : "same"
      }
      return {
        med, start, end, ongoing,
        point: !!med.endDate && new Date(med.endDate).getTime() === start,
        dose,
        intensity,
        change,
        previousDosage: prev && contiguous ? prev.dosage : null,
      }
    })

    const current = [...segments].reverse().find((s) => s.ongoing) ?? null
    lanes.push({
      key,
      name: ordered[ordered.length - 1].name.trim(),
      segments,
      first: segments[0].start,
      last: Math.max(...segments.map((s) => s.end)),
      active: !!current,
      current,
    })
  }
  return lanes.sort((a, b) => a.first - b.first || a.name.localeCompare(b.name))
}

export type AxisTick = { at: number; label: string; major: boolean }

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/// Month-start gridlines for [from, to). Long spans label only the years,
/// medium ones each quarter, short ones every month; Januaries are major.
export function axisTicks(from: number, to: number): AxisTick[] {
  const spanDays = (to - from) / DAY
  const step = spanDays > 365 * 3 ? 12 : spanDays > 400 ? 3 : 1
  const d = new Date(from)
  let y = d.getUTCFullYear()
  let m = d.getUTCMonth() + 1
  if (m > 11) { m = 0; y++ }
  const ticks: AxisTick[] = []
  for (;;) {
    const at = Date.UTC(y, m, 1)
    if (at >= to) break
    if (m % step === 0) {
      ticks.push({ at, label: m === 0 ? String(y) : MONTHS[m], major: m === 0 })
    }
    m++
    if (m > 11) { m = 0; y++ }
  }
  return ticks
}

export type WeekCount = { start: number; count: number }

/// Observations per week across [from, to), weeks starting on Monday (UTC).
export function weeklyObservationCounts(dates: Date[], from: number, to: number): WeekCount[] {
  const first = new Date(from)
  const monday = Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), first.getUTCDate()) - ((first.getUTCDay() + 6) % 7) * DAY
  const weeks: WeekCount[] = []
  for (let s = monday; s < to; s += 7 * DAY) weeks.push({ start: s, count: 0 })
  for (const d of dates) {
    const t = new Date(d).getTime()
    const i = Math.floor((t - monday) / (7 * DAY))
    if (i >= 0 && i < weeks.length) weeks[i].count++
  }
  return weeks
}

export const daysBetween = (a: number, b: number) => Math.max(1, Math.round((b - a) / DAY))

/// "3 days", "5 weeks", "7 months", "1.5 years" — the length of a dose period.
export function formatSpan(days: number): string {
  if (days < 14) return `${days} day${days === 1 ? "" : "s"}`
  if (days < 70) return `${Math.round(days / 7)} weeks`
  if (days < 548) return `${Math.round(days / 30.44)} months`
  return `${Math.round((days / 365.25) * 10) / 10} years`
}
