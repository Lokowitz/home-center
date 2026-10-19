// What a medical summary includes. Lives in the URL (?allergies=1&obs=90...) so
// a configured report can be bookmarked and the page stays a plain server
// render. Pure and client-safe: the sidebar and the page share it.

export const OBS_RANGES = [
  { value: "off", label: "Off" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "365", label: "12 months" },
  { value: "730", label: "2 years" },
  { value: "1095", label: "3 years" },
  { value: "1825", label: "5 years" },
  { value: "all", label: "All time" },
] as const
export const HISTORY_RANGES = [
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "365", label: "12 months" },
  { value: "730", label: "2 years" },
  { value: "1095", label: "3 years" },
  { value: "1825", label: "5 years" },
  { value: "all", label: "All time" },
] as const
export const MED_NOTES = [
  { value: "off", label: "No notes" },
  { value: "last", label: "Latest entry only" },
  { value: "all", label: "Every entry" },
] as const
export const OBS_VIEWS = [
  { value: "heatmap", label: "Heatmap" },
  { value: "histogram", label: "Daily severity histogram" },
  { value: "none", label: "No chart" },
] as const
export const VISIT_MODES = [
  { value: "off", label: "Off" },
  { value: "cost", label: "On, with cost" },
  { value: "nocost", label: "On, no cost" },
] as const

export type ObsRange = (typeof OBS_RANGES)[number]["value"]
export type HistoryRange = (typeof HISTORY_RANGES)[number]["value"]
export type MedNotes = (typeof MED_NOTES)[number]["value"]
export type ObsView = (typeof OBS_VIEWS)[number]["value"]
export type VisitMode = (typeof VISIT_MODES)[number]["value"]

export type ReportOptions = {
  allergies: boolean
  conditions: boolean
  medications: boolean
  immunizations: boolean
  insurance: boolean
  careTeam: boolean
  review: boolean
  history: boolean
  historyRange: HistoryRange
  medList: boolean
  medListNotes: MedNotes
  changes: boolean
  obs: ObsRange
  obsView: ObsView
  obsList: boolean
  obsNotes: boolean
  expense: boolean
  visits: VisitMode
  reminders: boolean
}

export const DEFAULT_REPORT_OPTIONS: ReportOptions = {
  allergies: false,
  conditions: true,
  medications: true,
  immunizations: false,
  insurance: false,
  careTeam: false,
  review: false,
  history: true,
  historyRange: "all",
  medList: false,
  medListNotes: "off",
  changes: false,
  obs: "off",
  obsView: "heatmap",
  obsList: true,
  obsNotes: false,
  expense: false,
  visits: "off",
  reminders: false,
}

const BOOLEAN_KEYS = [
  "allergies", "conditions", "medications", "immunizations", "insurance", "careTeam",
  "review", "history", "medList", "changes", "obsList", "obsNotes", "expense", "reminders",
] as const

type Params = Record<string, string | string[] | undefined>

function pick<T extends string>(raw: string | string[] | undefined, choices: readonly { value: T }[], fallback: T): T {
  const v = Array.isArray(raw) ? raw[0] : raw
  return choices.find((c) => c.value === v)?.value ?? fallback
}

export function parseReportOptions(params: Params): ReportOptions {
  const out: ReportOptions = { ...DEFAULT_REPORT_OPTIONS }
  for (const k of BOOLEAN_KEYS) {
    const v = Array.isArray(params[k]) ? params[k]![0] : params[k]
    if (v === "1") out[k] = true
    else if (v === "0") out[k] = false
  }
  out.obs = pick(params.obs, OBS_RANGES, DEFAULT_REPORT_OPTIONS.obs)
  out.historyRange = pick(params.historyRange, HISTORY_RANGES, DEFAULT_REPORT_OPTIONS.historyRange)
  out.medListNotes = pick(params.medListNotes, MED_NOTES, DEFAULT_REPORT_OPTIONS.medListNotes)
  out.obsView = pick(params.obsView, OBS_VIEWS, DEFAULT_REPORT_OPTIONS.obsView)
  out.visits = pick(params.visits, VISIT_MODES, DEFAULT_REPORT_OPTIONS.visits)
  return out
}

export function reportOptionsQuery(o: ReportOptions): string {
  const q = new URLSearchParams()
  for (const k of BOOLEAN_KEYS) q.set(k, o[k] ? "1" : "0")
  q.set("obs", o.obs)
  q.set("historyRange", o.historyRange)
  q.set("medListNotes", o.medListNotes)
  q.set("obsView", o.obsView)
  q.set("visits", o.visits)
  return q.toString()
}

/// Days to show; `null` when observations are off, `"all"` for all time.
export const obsDays = (o: ReportOptions): number | "all" | null =>
  o.obs === "off" ? null : o.obs === "all" ? "all" : Number(o.obs)

export const rangeLabel = (days: number | "all") =>
  days === "all" ? "all time"
    : days === 365 ? "last 12 months"
    : days > 365 && days % 365 === 0 ? `last ${days / 365} years`
    : `last ${days} days`
