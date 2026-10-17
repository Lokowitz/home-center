// An observation the assistant has drafted from what the user said, shown as a
// card in the chat and saved only when the user presses Save. Pure and
// client-safe: the tool builds drafts with these helpers, the chat stores and
// summarises them, and the card turns one into the form values
// createObservation takes.

import { normalizeTags } from "./health-schemas"
import { RATING_WORDS } from "./day-ratings"

const DAY = 86_400_000

export type Severity = 1 | 2 | 3 | 4 | 5

export type ObservationDraft = {
  /// "obs-" + six base36 characters, made by the tool; kept across revisions.
  draftId: string
  personId: string
  personName: string
  /// YYYY-MM-DD, and HH:MM (24-hour) when the user said when.
  date: string
  time: string | null
  type: string
  severity: Severity
  /// "estimated" when the user gave none and the model judged it.
  severitySource: "stated" | "estimated"
  durationMinutes: number | null
  notes: string | null
  tags: string[]
}

export type DraftState = "draft" | "saved" | "discarded"
export type DraftCard = { draft: ObservationDraft; state: DraftState; savedId?: string; error?: string }

/// Saved on estimated entries so a guess stays distinguishable from a rating.
export const ESTIMATED_TAG = "severity-estimated"

const SEVERITY_WORDS: [RegExp, Severity][] = [
  [/^(mild|slight|light|very mild)$/, 1],
  [/^(minor|mild[\s\-–]*(to[\s]*)?moderate)$/, 2],
  [/^(moderate|medium)$/, 3],
  [/^(bad|serious|moderate[\s\-–]*(to[\s]*)?severe)$/, 4],
  [/^(severe|extreme|very severe|worst)$/, 5],
]

export function parseSeverity(input: unknown): Severity | null {
  if (typeof input === "number") return Number.isInteger(input) && input >= 1 && input <= 5 ? (input as Severity) : null
  if (typeof input !== "string") return null
  const s = input.trim().toLowerCase()
  const n = s.match(/^([1-5])(\s*\/\s*5)?$/)
  if (n) return Number(n[1]) as Severity
  for (const [re, v] of SEVERITY_WORDS) if (re.test(s)) return v
  return null
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]
const isoOf = (t: number) => new Date(t).toISOString().slice(0, 10)

/// "today", "yesterday", "monday" (the most recent, today included), "last
/// monday" (before today), or YYYY-MM-DD; `today` is the viewer's YYYY-MM-DD.
export function resolveDraftDate(input: string, today: string): { date: string } | { error: string } {
  const base = Date.parse(`${today}T00:00:00Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today) || !Number.isFinite(base) || isoOf(base) !== today)
    return { error: "Today's date wasn't readable; ask the user for the date as YYYY-MM-DD." }
  const s = input.trim().toLowerCase().replace(/\s+/g, " ")
  let t: number | null = null
  if (s === "today") t = base
  else if (s === "yesterday") t = base - DAY
  else {
    const wd = s.match(/^(last )?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/)
    if (wd) {
      const back = (new Date(base).getUTCDay() - WEEKDAYS.indexOf(wd[2]) + 7) % 7
      t = base - (back === 0 && wd[1] ? 7 : back) * DAY
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(s) && isoOf(Date.parse(`${s}T00:00:00Z`) || 0) === s) {
      t = Date.parse(`${s}T00:00:00Z`)
    }
  }
  if (t === null) return { error: `"${input}" isn't a date. Use YYYY-MM-DD, "today", "yesterday" or a weekday.` }
  if (t > base) return { error: `${isoOf(t)} is in the future. Ask the user which day it happened.` }
  if (t < base - 365 * DAY) return { error: `${isoOf(t)} is more than a year ago. Ask the user to add it from the Observations tab instead.` }
  return { date: isoOf(t) }
}

const typeKey = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ")

/// The person's own spelling when it is the same type, so drafts don't fork "Meltdown" into "meltdown".
export function matchExistingType(type: string, known: string[]): string {
  return known.find((k) => typeKey(k) === typeKey(type)) ?? type.trim().replace(/\s+/g, " ")
}

export function toFormValues(d: ObservationDraft): Record<string, string> {
  const tags = d.tags.filter((t) => t.trim().toLowerCase() !== ESTIMATED_TAG)
  if (d.severitySource === "estimated") tags.push(ESTIMATED_TAG)
  return {
    date: d.date,
    time: d.time ?? "",
    type: d.type,
    severity: String(d.severity),
    durationMinutes: d.durationMinutes == null ? "" : String(d.durationMinutes),
    conditionId: "",
    tags: normalizeTags(tags.join(",")) ?? "",
    notes: d.notes ?? "",
  }
}

const NOTE_LIMIT = 200

/// Summary lines are matched one physical line at a time, so free text never carries a line break.
export const oneLine = (s: string) => s.replace(/\s+/g, " ")

const stateWords = (c: DraftCard) =>
  c.state === "draft" ? "not saved"
  : c.state === "discarded" ? "discarded"
  : c.savedId ? `saved as entry ${c.savedId}; to change it, call propose_observation_edit with observationId ${c.savedId}` : "saved"

/// The line the model sees in history for each card, so it can revise by id.
/// Notes stay whole while the card is a draft (the model resends them on a revision); finished cards are cut.
export function draftSummaryLine(card: DraftCard): string {
  const { draft: d, state } = card
  const flat = d.notes ? oneLine(d.notes) : d.notes
  const notes = state !== "draft" && flat && flat.length > NOTE_LIMIT ? `${flat.slice(0, NOTE_LIMIT)}…` : flat
  const parts = [
    oneLine(d.personName),
    oneLine(`${d.date}${d.time ? ` ${d.time}` : ""}`),
    oneLine(d.type),
    `${d.severitySource === "estimated" ? "severityEstimate" : "severity"} ${d.severity}`,
    ...(d.durationMinutes != null ? [`${d.durationMinutes} min`] : []),
    ...(d.tags.length ? [`tags ${oneLine(d.tags.join(", "))}`] : []),
    ...(notes ? [`"${notes}"`] : []),
  ]
  return `[observation draft ${d.draftId}, ${stateWords(card)}: ${parts.join(" · ")}]`
}

const str = (v: unknown) => typeof v === "string"
const strOrNull = (v: unknown) => v === null || typeof v === "string"

export function isDraftCard(v: unknown): v is DraftCard {
  const c = v as DraftCard | null
  if (!c || typeof c !== "object" || !["draft", "saved", "discarded"].includes(c.state)) return false
  const d = c.draft
  return !!d && str(d.draftId) && str(d.personId) && str(d.personName) && str(d.date) && strOrNull(d.time) && str(d.type)
    && typeof d.severity === "number" && parseSeverity(d.severity) !== null && (d.severitySource === "stated" || d.severitySource === "estimated")
    && (d.durationMinutes === null || typeof d.durationMinutes === "number") && strOrNull(d.notes)
    && Array.isArray(d.tags) && d.tags.every(str)
}

export const severityLabel = (s: Severity) => `${s} / 5 · ${RATING_WORDS[s]}`

/// Today on the viewer's calendar, as YYYY-MM-DD.
export function localDay(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}
