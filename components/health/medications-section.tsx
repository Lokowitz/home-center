"use client"

import { useState } from "react"
import { ChartGantt, GitCompareArrows, List } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { EntityFormDialog } from "@/components/forms/entity-form-dialog"
import { EntityTable, type EntityColumn } from "@/components/forms/entity-table"
import { AttachmentList } from "@/components/attachments/attachment-list"
import { AttachmentCount } from "@/components/attachments/attachment-count"
import {
  createMedication, deleteMedication, markMedicationRefilled, updateMedication,
} from "@/lib/actions/health"
import { useFormat } from "@/components/regional-provider"
import type { Formatter } from "@/lib/regional"
import { daysUntil, isMedicationActive, refillDue, toDateInput } from "@/lib/health"
import { MEDICATION_VIEW_COOKIE, sortChronologically, type MedicationView } from "@/lib/medication-timeline"
import { ASSET_VIEW_COOKIE_MAX_AGE } from "@/lib/asset-view"
import type { FieldConfig, FormValues } from "@/lib/form-types"
import { cn } from "@/lib/utils"
import type { Attachment, Medication } from "@/app/generated/prisma/client"
import { MedicationTimeline } from "./medication-timeline"
import { MedicationEffectsView } from "./medication-effects"

export type MedicationRow = Medication & { attachments: Attachment[]; prescriber: { name: string } | null; condition: { name: string } | null }

const VIEWS: { value: MedicationView; label: string; icon: React.ElementType }[] = [
  { value: "list", label: "List", icon: List },
  { value: "timeline", label: "Timeline", icon: ChartGantt },
  { value: "effects", label: "Before & after", icon: GitCompareArrows },
]

function ViewToggle({ value, onChange }: { value: MedicationView; onChange: (v: MedicationView) => void }) {
  return (
    <div role="group" aria-label="Medications view" className="inline-flex items-center rounded-lg border bg-card p-0.5">
      {VIEWS.map((option) => {
        const Icon = option.icon
        const active = value === option.value
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={active}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
              active
                ? "bg-sidebar-primary/10 text-sidebar-primary"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

function RefillCell({ m }: { m: MedicationRow }) {
  const fmt = useFormat()
  if (!m.nextRefillDate) return <span className="text-muted-foreground">—</span>
  const shown = fmt.date(m.nextRefillDate, { utc: true })
  const now = new Date()
  if (!refillDue(m, now)) return <span className="text-muted-foreground">{shown}</span>
  return daysUntil(m.nextRefillDate, now) < 0
    ? <Badge variant="destructive">Overdue · {shown}</Badge>
    : <Badge variant="secondary">Due {shown}</Badge>
}

const columnsFor = (fmt: Formatter): EntityColumn<MedicationRow>[] => [
  {
    key: "name", label: "Medication",
    cell: (m) => (
      <div>
        <div className="font-medium">{m.name}</div>
        {(m.dosage || m.frequency) && (
          <div className="text-xs text-muted-foreground">{[m.dosage, m.frequency].filter(Boolean).join(" · ")}</div>
        )}
      </div>
    ),
  },
  { key: "started", label: "Started", className: "whitespace-nowrap text-muted-foreground", cell: (m) => (m.startDate ? fmt.date(m.startDate, { utc: true }) : "—") },
  { key: "for", label: "For", className: "text-muted-foreground", cell: (m) => m.condition?.name ?? "—" },
  { key: "prescriber", label: "Prescriber", className: "text-muted-foreground", cell: (m) => m.prescriber?.name ?? "—" },
  { key: "refill", label: "Next refill", className: "whitespace-nowrap", cell: (m) => <RefillCell m={m} /> },
  { key: "files", label: "Files", cell: (m) => <AttachmentCount attachments={m.attachments} /> },
]

const pastColumnsFor = (fmt: Formatter): EntityColumn<MedicationRow>[] => {
  const COLUMNS = columnsFor(fmt)
  return [
  COLUMNS[0],
  COLUMNS[1],
  { key: "ended", label: "Stopped", className: "whitespace-nowrap text-muted-foreground", cell: (m) => (m.endDate ? fmt.date(m.endDate, { utc: true }) : "—") },
  COLUMNS[2],
  COLUMNS[COLUMNS.length - 1],
  ]
}

function initialFor(m: MedicationRow | null): FormValues {
  return {
    name: m?.name ?? "",
    dosage: m?.dosage ?? "",
    frequency: m?.frequency ?? "",
    prescriberId: m?.prescriberId ?? "",
    conditionId: m?.conditionId ?? "",
    pharmacy: m?.pharmacy ?? "",
    startDate: toDateInput(m?.startDate),
    endDate: toDateInput(m?.endDate),
    refillIntervalDays: m?.refillIntervalDays?.toString() ?? "",
    nextRefillDate: toDateInput(m?.nextRefillDate),
    notes: m?.notes ?? "",
  }
}

interface Props {
  personId: string
  medications: MedicationRow[]
  providers: { id: string; name: string }[]
  conditions: { id: string; name: string }[]
  /// Observation dates for the same person, drawn under the timeline so dose
  /// changes can be read against how often things were logged.
  observations?: { date: Date; type: string; severity?: number | null }[]
  initialView?: MedicationView
  openId?: string
}

export function MedicationsSection({ personId, medications, providers, conditions, observations = [], initialView = "list", openId }: Props) {
  const fmt = useFormat()
  const [editing, setEditing] = useState<MedicationRow | null>(null)
  const [open, setOpen] = useState(false)

  const [prevOpenId, setPrevOpenId] = useState<string | undefined>(undefined)
  if (openId !== prevOpenId) {
    setPrevOpenId(openId)
    const match = openId ? medications.find((m) => m.id === openId) : undefined
    if (match) { setEditing(match); setOpen(true) }
  }

  // Seeded from the cookie the page already read, like the asset list layouts,
  // so the first paint is the saved view and no effect has to correct it.
  const [view, setView] = useState<MedicationView>(initialView)
  function chooseView(v: MedicationView) {
    setView(v)
    document.cookie = `${MEDICATION_VIEW_COOKIE}=${v}; Path=/; Max-Age=${ASSET_VIEW_COOKIE_MAX_AGE}; SameSite=Lax`
  }

  const now = new Date()
  const active = medications.filter((m) => isMedicationActive(m, now))
  const past = sortChronologically(medications.filter((m) => !isMedicationActive(m, now)), "desc")

  const fields: FieldConfig[] = [
    { name: "name", label: "Medication", kind: "text", required: true, placeholder: "Metformin", wide: true, help: "medication.name" },
    { name: "dosage", label: "Dosage", kind: "text", placeholder: "500 mg", help: "medication.dosage" },
    { name: "frequency", label: "Frequency", kind: "text", placeholder: "Twice daily", help: "medication.frequency" },
    { name: "prescriberId", label: "Prescriber", kind: "select", options: providers.map((p) => ({ value: p.id, label: p.name })), help: "medication.prescriber" },
    { name: "conditionId", label: "For condition", kind: "select", options: conditions.map((c) => ({ value: c.id, label: c.name })), help: "medication.condition" },
    { name: "startDate", label: "Started", kind: "date", help: "medication.started" },
    { name: "endDate", label: "Stopped", kind: "date", help: "medication.stopped" },
    { name: "refillIntervalDays", label: "Refill every (days)", kind: "number", placeholder: "30", help: "medication.refill-every" },
    { name: "nextRefillDate", label: "Next refill", kind: "date", help: "medication.next-refill" },
    { name: "pharmacy", label: "Pharmacy", kind: "text", placeholder: "Walgreens on Main", wide: true, help: "medication.pharmacy" },
    { name: "notes", label: "Notes", kind: "textarea", wide: true, help: "medication.notes" },
  ]

  async function handleDelete(m: MedicationRow) {
    if (!confirm(`Delete "${m.name}"? To keep its history, set a Stopped date instead.`)) return
    const result = await deleteMedication(m.id)
    if (result.error) { toast.error("Delete failed."); return }
    toast.success("Medication deleted.")
  }

  async function handleRefilled(m: MedicationRow) {
    const result = await markMedicationRefilled(m.id)
    if (result.error) { toast.error(typeof result.error === "string" ? result.error : "Update failed."); return }
    toast.success(`${m.name}: next refill in ${m.refillIntervalDays} days.`)
  }

  const openEdit = (m: MedicationRow) => { setEditing(m); setOpen(true) }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <ViewToggle value={view} onChange={chooseView} />
          <p className="whitespace-nowrap text-sm text-muted-foreground">{active.length} current · {past.length} past</p>
        </div>
        <Button size="sm" onClick={() => { setEditing(null); setOpen(true) }}>Add Medication</Button>
      </div>

      {view === "timeline" ? (
        <MedicationTimeline
          medications={medications}
          observations={observations}
          onSelect={(id) => { const m = medications.find((x) => x.id === id); if (m) openEdit(m) }}
        />
      ) : view === "effects" ? (
        <MedicationEffectsView medications={medications} observations={observations} />
      ) : (
      <>
      <EntityTable
        rows={active}
        columns={columnsFor(fmt)}
        describe={(m) => m.name}
        onEdit={openEdit}
        onDelete={handleDelete}
        empty="No current medications."
        extraActions={(m) =>
          m.refillIntervalDays ? (
            <Button variant="outline" size="sm" className="h-7" onClick={() => handleRefilled(m)}>Refilled</Button>
          ) : null
        }
        renderExpanded={(m) => <AttachmentList recordId={m.id} recordType="MEDICATION" attachments={m.attachments} />}
      />

      {past.length > 0 && (
        <div className="mt-6 space-y-2">
          <h3 className="text-sm font-medium text-muted-foreground">Past medications</h3>
          <EntityTable rows={past} columns={pastColumnsFor(fmt)} describe={(m) => m.name} onEdit={openEdit} onDelete={handleDelete} empty="" renderExpanded={(m) => <AttachmentList recordId={m.id} recordType="MEDICATION" attachments={m.attachments} />} />
        </div>
      )}
      </>
      )}

      <EntityFormDialog
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? "Edit Medication" : "Add Medication"}
        submitLabel={editing ? "Save Changes" : "Add Medication"}
        successMessage={editing ? "Medication updated." : "Medication added."}
        fields={fields}
        initial={initialFor(editing)}
        onSubmit={(values) => (editing ? updateMedication(editing.id, values) : createMedication(personId, values))}
        attachmentRecordType="MEDICATION"
        recordId={editing?.id}
        attachments={editing?.attachments}
      />
    </>
  )
}
