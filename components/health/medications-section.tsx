"use client"

import { useState } from "react"
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
import { daysUntil, formatDay, isMedicationActive, refillDue, toDateInput } from "@/lib/health"
import type { FieldConfig, FormValues } from "@/lib/form-types"
import type { Attachment, Medication } from "@/app/generated/prisma/client"

export type MedicationRow = Medication & { attachments: Attachment[]; prescriber: { name: string } | null; condition: { name: string } | null }

function RefillCell({ m }: { m: MedicationRow }) {
  if (!m.nextRefillDate) return <span className="text-muted-foreground">—</span>
  const now = new Date()
  if (!refillDue(m, now)) return <span className="text-muted-foreground">{formatDay(m.nextRefillDate)}</span>
  return daysUntil(m.nextRefillDate, now) < 0
    ? <Badge variant="destructive">Overdue · {formatDay(m.nextRefillDate)}</Badge>
    : <Badge variant="secondary">Due {formatDay(m.nextRefillDate)}</Badge>
}

const COLUMNS: EntityColumn<MedicationRow>[] = [
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
  { key: "started", label: "Started", className: "whitespace-nowrap text-muted-foreground", cell: (m) => formatDay(m.startDate) },
  { key: "for", label: "For", className: "text-muted-foreground", cell: (m) => m.condition?.name ?? "—" },
  { key: "prescriber", label: "Prescriber", className: "text-muted-foreground", cell: (m) => m.prescriber?.name ?? "—" },
  { key: "refill", label: "Next refill", className: "whitespace-nowrap", cell: (m) => <RefillCell m={m} /> },
  { key: "files", label: "Files", cell: (m) => <AttachmentCount attachments={m.attachments} /> },
]

const PAST_COLUMNS: EntityColumn<MedicationRow>[] = [
  COLUMNS[0],
  COLUMNS[1],
  { key: "ended", label: "Stopped", className: "whitespace-nowrap text-muted-foreground", cell: (m) => formatDay(m.endDate) },
  COLUMNS[2],
  COLUMNS[COLUMNS.length - 1],
]

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
  openId?: string
}

export function MedicationsSection({ personId, medications, providers, conditions, openId }: Props) {
  const [editing, setEditing] = useState<MedicationRow | null>(null)
  const [open, setOpen] = useState(false)

  const [prevOpenId, setPrevOpenId] = useState<string | undefined>(undefined)
  if (openId !== prevOpenId) {
    setPrevOpenId(openId)
    const match = openId ? medications.find((m) => m.id === openId) : undefined
    if (match) { setEditing(match); setOpen(true) }
  }

  const now = new Date()
  const active = medications.filter((m) => isMedicationActive(m, now))
  const past = medications.filter((m) => !isMedicationActive(m, now))

  const fields: FieldConfig[] = [
    { name: "name", label: "Medication", kind: "text", required: true, placeholder: "Metformin", wide: true },
    { name: "dosage", label: "Dosage", kind: "text", placeholder: "500 mg" },
    { name: "frequency", label: "Frequency", kind: "text", placeholder: "Twice daily" },
    { name: "prescriberId", label: "Prescriber", kind: "select", options: providers.map((p) => ({ value: p.id, label: p.name })) },
    { name: "conditionId", label: "For condition", kind: "select", options: conditions.map((c) => ({ value: c.id, label: c.name })) },
    { name: "startDate", label: "Started", kind: "date" },
    { name: "endDate", label: "Stopped", kind: "date" },
    { name: "refillIntervalDays", label: "Refill every (days)", kind: "number", placeholder: "30" },
    { name: "nextRefillDate", label: "Next refill", kind: "date" },
    { name: "pharmacy", label: "Pharmacy", kind: "text", placeholder: "Walgreens on Main", wide: true },
    { name: "notes", label: "Notes", kind: "textarea", wide: true },
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
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-muted-foreground">{active.length} current · {past.length} past</p>
        <Button size="sm" onClick={() => { setEditing(null); setOpen(true) }}>Add Medication</Button>
      </div>

      <EntityTable
        rows={active}
        columns={COLUMNS}
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
          <EntityTable rows={past} columns={PAST_COLUMNS} describe={(m) => m.name} onEdit={openEdit} onDelete={handleDelete} empty="" renderExpanded={(m) => <AttachmentList recordId={m.id} recordType="MEDICATION" attachments={m.attachments} />} />
        </div>
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
