"use client"

import { useMemo, useState } from "react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { EntityTable, type EntityColumn } from "@/components/forms/entity-table"
import { AttachmentList } from "@/components/attachments/attachment-list"
import { AttachmentCount } from "@/components/attachments/attachment-count"
import { deleteObservation } from "@/lib/actions/health"
import { useFormat } from "@/components/regional-provider"
import type { Formatter } from "@/lib/regional"
import {
  filterObservations, formatDuration, RANGES, summarizeObservations, typeSuggestions, weeklyCounts,
  type RangeValue,
} from "@/lib/observations"
import { cn } from "@/lib/utils"
import { ObservationDialog, type ConditionOption, type ObservationRow } from "./observation-form"
import { ObservationPattern } from "./observation-pattern"
import { ObservationCalendar } from "./observation-calendar"
import { X } from "lucide-react"
import { buildTimeline, type TimelineMedication } from "@/lib/medication-timeline"
import { medicationEvents } from "@/lib/medication-effects"
import { utcDay } from "@/lib/observation-calendar"

const ALL = "__all__"

const columnsFor = (fmt: Formatter): EntityColumn<ObservationRow>[] => [
  {
    key: "when", label: "When", className: "whitespace-nowrap",
    cell: (o) => (
      <span>
        {fmt.date(o.date, { utc: true })}
        {o.time && <span className="text-muted-foreground"> · {fmt.clock(o.time)}</span>}
      </span>
    ),
  },
  { key: "type", label: "What", cell: (o) => <span className="font-medium">{o.type}</span> },
  {
    key: "severity", label: "Severity", className: "whitespace-nowrap",
    cell: (o) => (o.severity ? <Badge variant={o.severity >= 4 ? "destructive" : "secondary"}>{o.severity} / 5</Badge> : "—"),
  },
  { key: "duration", label: "Duration", className: "whitespace-nowrap text-muted-foreground", cell: (o) => formatDuration(o.durationMinutes) },
  { key: "condition", label: "Condition", className: "text-muted-foreground", cell: (o) => o.condition?.name ?? "—" },
  { key: "by", label: "Logged by", className: "text-muted-foreground", cell: (o) => o.createdBy?.name ?? "Deleted user" },
  { key: "files", label: "Files", cell: (o) => <AttachmentCount attachments={o.attachments} /> },
]

interface Props {
  personId: string
  observations: ObservationRow[]
  conditions: ConditionOption[]
  /// The same person's medications, marked on the year calendar.
  medications?: TimelineMedication[]
  openId?: string
}

export function ObservationsSection({ personId, observations, conditions, medications = [], openId }: Props) {
  const fmt = useFormat()
  const [editing, setEditing] = useState<ObservationRow | null>(null)
  const [open, setOpen] = useState(false)
  const [type, setType] = useState<string>(ALL)
  const [conditionId, setConditionId] = useState<string>(ALL)
  const [range, setRange] = useState<RangeValue>("90")
  const [pickedDay, setPickedDay] = useState<number | null>(null)

  // A ?open= link (e.g. from a notification or the assistant) opens that entry once.
  const [handledOpenId, setHandledOpenId] = useState<string | undefined>(undefined)
  if (openId !== handledOpenId) {
    setHandledOpenId(openId)
    const match = openId ? observations.find((o) => o.id === openId) : undefined
    if (match) { setEditing(match); setOpen(true) }
  }

  const typeOptions = useMemo(() => typeSuggestions(observations), [observations])
  const now = new Date()
  const base = { type: type === ALL ? null : type, conditionId: conditionId === ALL ? null : conditionId }
  const matching = filterObservations(observations, base, now)
  // A day picked on the calendar overrides the time range until it's cleared.
  const shown = pickedDay != null
    ? matching.filter((o) => utcDay(o.date) === pickedDay)
    : filterObservations(observations, { ...base, range }, now)
  const summary = summarizeObservations(shown)
  const weeks = weeklyCounts(matching, 12, now)
  const events = useMemo(() => medicationEvents(buildTimeline(medications, new Date())), [medications])
  const linkedConditions = conditions.filter((c) => observations.some((o) => o.conditionId === c.id))

  async function handleDelete(o: ObservationRow) {
    if (!confirm(`Delete this "${o.type}" observation from ${fmt.date(o.date, { utc: true })} and its files?`)) return
    const result = await deleteObservation(o.id)
    if (result.error) { toast.error("Delete failed."); return }
    toast.success("Observation deleted.")
  }

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Meltdowns, bad nights, symptoms — anything you want to look back on later.
        </p>
        <Button size="sm" onClick={() => { setEditing(null); setOpen(true) }}>Log observation</Button>
      </div>

      {observations.length > 0 && (
        <div className="mb-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Select value={type} onValueChange={(v) => setType(v ?? ALL)}>
              <SelectTrigger className="w-44" aria-label="Filter by what happened">
                <SelectValue>{(v: string) => (v === ALL ? "Everything" : v)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Everything</SelectItem>
                {typeOptions.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
            {linkedConditions.length > 0 && (
              <Select value={conditionId} onValueChange={(v) => setConditionId(v ?? ALL)}>
                <SelectTrigger className="w-44" aria-label="Filter by condition">
                  <SelectValue>{(v: string) => (v === ALL ? "Any condition" : conditions.find((c) => c.id === v)?.name ?? "")}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Any condition</SelectItem>
                  {linkedConditions.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            <div className="inline-flex rounded-md border p-0.5" role="group" aria-label="Time range">
              {RANGES.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  aria-pressed={range === r.value}
                  onClick={() => { setRange(r.value); setPickedDay(null) }}
                  className={cn(
                    "rounded px-2.5 py-1 text-xs font-medium transition-colors",
                    range === r.value && pickedDay == null ?"bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          <ObservationCalendar observations={matching} events={events} pickedDay={pickedDay} onPickDay={setPickedDay} />

          <ObservationPattern weeks={weeks} label={type === ALL ? "All observations" : type} />

          <p className="flex flex-wrap items-center gap-x-1 text-sm text-muted-foreground">
            {pickedDay != null && (
              <button
                type="button"
                onClick={() => setPickedDay(null)}
                className="mr-1 inline-flex items-center gap-1 rounded-full border bg-card px-2 py-0.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
              >
                {fmt.date(new Date(pickedDay), { utc: true })}
                <X className="h-3 w-3" aria-label="Clear day" />
              </button>
            )}
            <span className="font-medium text-foreground">{summary.count}</span> {pickedDay != null ? "that day" : <>in {range === "all" ? "total" : `the last ${RANGES.find((r) => r.value === range)!.label}`}</>}
            {summary.avgSeverity != null && <> · average severity {summary.avgSeverity} / 5</>}
            {summary.totalMinutes != null && <> · {formatDuration(summary.totalMinutes)} in all</>}
            {type === ALL && summary.byType.length > 1 && (
              <> · {summary.byType.slice(0, 3).map((t) => `${t.type} ${t.count}`).join(", ")}</>
            )}
          </p>
        </div>
      )}

      <EntityTable
        rows={shown}
        columns={columnsFor(fmt)}
        describe={(o) => `${o.type} on ${fmt.date(o.date, { utc: true })}`}
        onEdit={(o) => { setEditing(o); setOpen(true) }}
        onDelete={handleDelete}
        empty={observations.length ? "Nothing matches these filters." : "No observations yet. Use “Log observation” when something happens."}
        renderExpanded={(o) => (
          <div className="space-y-3">
            {o.notes && <p className="text-sm whitespace-pre-wrap">{o.notes}</p>}
            {o.tags && (
              <div className="flex flex-wrap gap-1">
                {o.tags.split(", ").map((t) => <Badge key={t} variant="outline">{t}</Badge>)}
              </div>
            )}
            <AttachmentList recordId={o.id} recordType="OBSERVATION" attachments={o.attachments} />
          </div>
        )}
      />

      <ObservationDialog
        personId={personId}
        open={open}
        onClose={() => setOpen(false)}
        editing={editing}
        typeOptions={typeOptions}
        conditions={conditions}
      />
    </>
  )
}
