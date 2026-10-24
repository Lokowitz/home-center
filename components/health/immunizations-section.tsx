"use client"

import { useState } from "react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { EntityFormDialog } from "@/components/forms/entity-form-dialog"
import { EntityTable, type EntityColumn } from "@/components/forms/entity-table"
import { AttachmentList } from "@/components/attachments/attachment-list"
import { AttachmentCount } from "@/components/attachments/attachment-count"
import { createImmunization, deleteImmunization, updateImmunization } from "@/lib/actions/health"
import { useFormat } from "@/components/regional-provider"
import { daysUntil, HEALTH_WINDOWS, isSupersededImmunization, toDateInput } from "@/lib/health"
import type { FieldConfig, FormValues } from "@/lib/form-types"
import type { Attachment, Immunization } from "@/app/generated/prisma/client"

export type ImmunizationRow = Immunization & { attachments: Attachment[] }

const FIELDS: FieldConfig[] = [
  { name: "vaccine", label: "Vaccine", kind: "text", required: true, placeholder: "Tdap", wide: true, help: "immunization.vaccine" },
  { name: "dateGiven", label: "Date given", kind: "date", required: true, help: "immunization.date-given" },
  { name: "nextDueDate", label: "Next due", kind: "date", help: "immunization.next-due" },
  { name: "dose", label: "Dose", kind: "text", placeholder: "Booster", help: "immunization.dose" },
  { name: "givenBy", label: "Given by", kind: "text", placeholder: "CVS Pharmacy", help: "immunization.given-by" },
  { name: "notes", label: "Notes", kind: "textarea", wide: true, help: "immunization.notes" },
]

function initialFor(i: ImmunizationRow | null): FormValues {
  return {
    vaccine: i?.vaccine ?? "",
    dateGiven: toDateInput(i?.dateGiven) || toDateInput(new Date()),
    nextDueDate: toDateInput(i?.nextDueDate),
    dose: i?.dose ?? "",
    givenBy: i?.givenBy ?? "",
    notes: i?.notes ?? "",
  }
}

function DueBadge({ date, superseded }: { date: Date | null; superseded: boolean }) {
  const fmt = useFormat()
  if (!date) return <span className="text-muted-foreground">—</span>
  const shown = fmt.date(date, { utc: true })
  if (superseded) return <span className="text-muted-foreground">{shown}</span>
  const days = daysUntil(date, new Date())
  if (days < 0) return <Badge variant="destructive">Overdue · {shown}</Badge>
  if (days <= HEALTH_WINDOWS.immunizationDays) return <Badge variant="secondary">Due {shown}</Badge>
  return <span className="text-muted-foreground">{shown}</span>
}

export function ImmunizationsSection({ personId, immunizations, openId }: { personId: string; immunizations: ImmunizationRow[]; openId?: string }) {
  const fmt = useFormat()
  const [editing, setEditing] = useState<ImmunizationRow | null>(null)
  const [open, setOpen] = useState(false)

  const [prevOpenId, setPrevOpenId] = useState<string | undefined>(undefined)
  if (openId !== prevOpenId) {
    setPrevOpenId(openId)
    const match = openId ? immunizations.find((i) => i.id === openId) : undefined
    if (match) { setEditing(match); setOpen(true) }
  }

  // Superseded doses (an older row for the same vaccine, now replaced by a
  // later one) never nag — computed here since this is the full per-person list.
  const COLUMNS: EntityColumn<ImmunizationRow>[] = [
    { key: "vaccine", label: "Vaccine", cell: (i) => <div><div className="font-medium">{i.vaccine}</div>{i.dose && <div className="text-xs text-muted-foreground">{i.dose}</div>}</div> },
    { key: "given", label: "Given", className: "whitespace-nowrap text-muted-foreground", cell: (i) => (i.dateGiven ? fmt.date(i.dateGiven, { utc: true }) : "—") },
    { key: "by", label: "Given by", className: "text-muted-foreground", cell: (i) => i.givenBy ?? "—" },
    { key: "next", label: "Next due", className: "whitespace-nowrap", cell: (i) => <DueBadge date={i.nextDueDate} superseded={isSupersededImmunization(i, immunizations)} /> },
    { key: "files", label: "Files", cell: (i) => <AttachmentCount attachments={i.attachments} /> },
  ]

  async function handleDelete(i: ImmunizationRow) {
    if (!confirm(`Delete the ${i.vaccine} record from ${i.dateGiven ? fmt.date(i.dateGiven, { utc: true }) : "—"}?`)) return
    const result = await deleteImmunization(i.id)
    if (result.error) { toast.error("Delete failed."); return }
    toast.success("Immunization deleted.")
  }

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-muted-foreground">{immunizations.length} immunization{immunizations.length === 1 ? "" : "s"}</p>
        <Button size="sm" onClick={() => { setEditing(null); setOpen(true) }}>Add Immunization</Button>
      </div>

      <EntityTable
        rows={immunizations}
        columns={COLUMNS}
        describe={(i) => `${i.vaccine} immunization`}
        onEdit={(i) => { setEditing(i); setOpen(true) }}
        onDelete={handleDelete}
        empty="No immunizations recorded."
        renderExpanded={(i) => <AttachmentList recordId={i.id} recordType="IMMUNIZATION" attachments={i.attachments} />}
      />

      <EntityFormDialog
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? "Edit Immunization" : "Add Immunization"}
        submitLabel={editing ? "Save Changes" : "Add Immunization"}
        successMessage={editing ? "Immunization updated." : "Immunization added."}
        fields={FIELDS}
        initial={initialFor(editing)}
        onSubmit={(values) => (editing ? updateImmunization(editing.id, values) : createImmunization(personId, values))}
        attachmentRecordType="IMMUNIZATION"
        recordId={editing?.id}
        attachments={editing?.attachments}
      />
    </>
  )
}
