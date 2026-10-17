// Every card the assistant can put in the chat: an add (a draft from
// observation-draft), an edit of an existing entry, or a delete. Pure and
// client-safe. Nothing here writes: the card's button calls a server action.

import { normalizeTags } from "./health-schemas"
import {
  draftSummaryLine, isDraftCard, oneLine, parseSeverity, severityLabel,
  type DraftCard, type DraftState, type Severity,
} from "./observation-draft"

export type ObservationValues = {
  date: string
  time: string | null
  type: string
  severity: Severity | null
  durationMinutes: number | null
  notes: string | null
  tags: string[]
  conditionId: string | null
}

/// The entry a change targets, as it was when the card was made.
export type EntryRef = {
  observationId: string
  /// ISO; Apply/Delete refuse if the entry has changed since.
  updatedAt: string
  personId: string
  personName: string
  attachments: number
  before: ObservationValues
}

export type EditCard = { kind: "edit"; id: string; target: EntryRef; after: ObservationValues; state: DraftState; error?: string }
export type DeleteCard = { kind: "delete"; id: string; target: EntryRef; state: DraftState; error?: string }
export type ChangeCard = EditCard | DeleteCard
export type ChatCard = DraftCard | ChangeCard
export type CardPatch = { state?: DraftState; savedId?: string; error?: string }

// Shown when a change card targets an entry edited after the card was made (used by lib/actions/health.ts)
export const STALE_ENTRY = "This entry changed after the card was made. Ask the assistant again."

export const isChangeCard = (c: ChatCard): c is ChangeCard => "kind" in c && (c.kind === "edit" || c.kind === "delete")
export const cardId = (c: ChatCard) => (isChangeCard(c) ? c.id : c.draft.draftId)
/// What a card is about. A revision must keep it; a reused id with another subject is a new card.
export const cardSubject = (c: ChatCard) => (isChangeCard(c) ? `entry:${c.target.observationId}:${c.kind}` : `person:${c.draft.personId}`)

export type ChangeField = Exclude<keyof ObservationValues, "conditionId">
const FIELDS: ChangeField[] = ["date", "time", "type", "severity", "durationMinutes", "notes", "tags"]
export const FIELD_LABELS: Record<ChangeField, string> = {
  date: "Date", time: "Time", type: "What", severity: "Severity", durationMinutes: "Duration", notes: "Notes", tags: "Tags",
}
const SUMMARY_NAMES: Record<ChangeField, string> = {
  date: "date", time: "time", type: "type", severity: "severity", durationMinutes: "duration", notes: "notes", tags: "tags",
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

export function changedFields(before: ObservationValues, after: ObservationValues): ChangeField[] {
  return FIELDS.filter((f) => !same(before[f], after[f]))
}

export function formatValue(field: ChangeField, v: ObservationValues): string {
  switch (field) {
    case "severity": return v.severity == null ? "—" : severityLabel(v.severity)
    case "durationMinutes": return v.durationMinutes == null ? "—" : `${v.durationMinutes} min`
    case "tags": return v.tags.length ? v.tags.join(", ") : "—"
    default: return v[field] == null || v[field] === "" ? "—" : String(v[field])
  }
}

/// The FormValues the observation schema and server actions take.
export function valuesToForm(v: ObservationValues): Record<string, string> {
  return {
    date: v.date,
    time: v.time ?? "",
    type: v.type,
    severity: v.severity == null ? "" : String(v.severity),
    durationMinutes: v.durationMinutes == null ? "" : String(v.durationMinutes),
    conditionId: v.conditionId ?? "",
    tags: normalizeTags(v.tags.join(",")) ?? "",
    notes: v.notes ?? "",
  }
}

const NOTE_LIMIT = 200
const short = (s: string, whole: boolean) => (whole || s.length <= NOTE_LIMIT ? s : `${s.slice(0, NOTE_LIMIT)}…`)
const plain = (field: ChangeField, v: ObservationValues, whole: boolean) => {
  if (field === "severity") return v.severity == null ? "none" : String(v.severity)
  if (field === "notes") return v.notes ? `"${short(oneLine(v.notes), whole)}"` : "none"
  if (field === "tags") return v.tags.length ? oneLine(v.tags.join(", ")) : "none"
  return v[field] == null ? "none" : oneLine(String(v[field]))
}

/// The line the model sees in history: id, state, and the entry it targets.
export function changeSummaryLine(c: ChangeCard): string {
  const open = c.state === "draft"
  const done = c.kind === "edit" ? `applied; to change this entry again, call propose_observation_edit with observationId ${c.target.observationId} and no proposalId` : "deleted"
  const word = open ? (c.kind === "edit" ? "not applied" : "not deleted") : c.state === "discarded" ? "discarded" : done
  const t = c.target
  const head = oneLine(`${t.personName} · entry ${t.observationId} (${t.before.date} ${t.before.type})`)
  if (c.kind === "delete") return `[observation delete ${c.id}, ${word}: ${head}]`
  const diffs = changedFields(t.before, c.after).map((f) => `${SUMMARY_NAMES[f]} ${plain(f, t.before, open)} → ${plain(f, c.after, open)}`)
  return `[observation edit ${c.id}, ${word}: ${[head, ...diffs].join(" · ")}]`
}

export const cardSummaryLine = (c: ChatCard) => (isChangeCard(c) ? changeSummaryLine(c) : draftSummaryLine(c))

const str = (v: unknown) => typeof v === "string"
const strOrNull = (v: unknown) => v === null || typeof v === "string"
const numOrNull = (v: unknown) => v === null || (typeof v === "number" && Number.isFinite(v))

function isValues(v: unknown): v is ObservationValues {
  const x = v as ObservationValues | null
  return !!x && str(x.date) && strOrNull(x.time) && str(x.type)
    && (x.severity === null || (typeof x.severity === "number" && parseSeverity(x.severity) !== null))
    && numOrNull(x.durationMinutes) && strOrNull(x.notes) && Array.isArray(x.tags) && x.tags.every(str) && strOrNull(x.conditionId)
}

function isTarget(v: unknown): v is EntryRef {
  const t = v as EntryRef | null
  return !!t && str(t.observationId) && str(t.updatedAt) && str(t.personId) && str(t.personName)
    && typeof t.attachments === "number" && isValues(t.before)
}

export function isChatCard(v: unknown): v is ChatCard {
  if (isDraftCard(v)) return true
  const c = v as ChangeCard | null
  if (!c || typeof c !== "object" || !str(c.id) || !["draft", "saved", "discarded"].includes(c.state) || !isTarget(c.target)) return false
  if (c.kind === "delete") return true
  return c.kind === "edit" && isValues((c as EditCard).after)
}
