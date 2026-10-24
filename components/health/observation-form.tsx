"use client"

import { useState } from "react"
import { NotebookPen } from "lucide-react"
import { Button } from "@/components/ui/button"
import { EntityFormDialog } from "@/components/forms/entity-form-dialog"
import { createObservation, updateObservation } from "@/lib/actions/health"
import { toDateInput } from "@/lib/health"
import { SEVERITIES } from "@/lib/observations"
import type { FieldConfig, FormValues } from "@/lib/form-types"
import type { Attachment, Observation } from "@/app/generated/prisma/client"

export type ObservationRow = Observation & {
  attachments: Attachment[]
  condition: { name: string } | null
  createdBy: { name: string } | null
}

export type ConditionOption = { id: string; name: string }

/** Today on the viewer's calendar, as the date input wants it. */
function localToday(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function initialFor(o: ObservationRow | null): FormValues {
  return {
    date: o ? toDateInput(o.date) : localToday(),
    time: o?.time ?? "",
    type: o?.type ?? "",
    severity: o?.severity?.toString() ?? "",
    durationMinutes: o?.durationMinutes?.toString() ?? "",
    conditionId: o?.conditionId ?? "",
    tags: o?.tags ?? "",
    notes: o?.notes ?? "",
  }
}

function fieldsFor(typeOptions: string[], conditions: ConditionOption[]): FieldConfig[] {
  return [
    {
      name: "type", label: "What happened", kind: "text", required: true, wide: true, help: "observation.what-happened",
      placeholder: "Meltdown, bad night, headache…", suggestions: typeOptions,
    },
    { name: "date", label: "Date", kind: "date", required: true, help: "observation.date" },
    { name: "time", label: "Time (optional)", kind: "time", help: "observation.time" },
    { name: "severity", label: "How bad (optional)", kind: "select", options: SEVERITIES, help: "observation.severity" },
    { name: "durationMinutes", label: "How long, in minutes (optional)", kind: "number", placeholder: "20", help: "observation.duration" },
    {
      name: "conditionId", label: "Related condition (optional)", kind: "select", wide: true, help: "observation.condition",
      options: conditions.map((c) => ({ value: c.id, label: c.name })),
    },
    { name: "tags", label: "Tags (optional)", kind: "text", wide: true, placeholder: "Comma-separated: school, tired, transition", help: "observation.tags" },
    { name: "notes", label: "Notes", kind: "textarea", wide: true, placeholder: "What led up to it, what helped…", help: "observation.notes" },
  ]
}

interface DialogProps {
  personId: string
  open: boolean
  onClose: () => void
  /** null = logging a new observation. */
  editing: ObservationRow | null
  typeOptions: string[]
  conditions: ConditionOption[]
}

export function ObservationDialog({ personId, open, onClose, editing, typeOptions, conditions }: DialogProps) {
  return (
    <EntityFormDialog
      open={open}
      onClose={onClose}
      title={editing ? "Edit observation" : "Log an observation"}
      submitLabel={editing ? "Save Changes" : "Log it"}
      successMessage={editing ? "Observation updated." : "Observation logged."}
      fields={fieldsFor(typeOptions, conditions)}
      initial={initialFor(editing)}
      onSubmit={(values) => (editing ? updateObservation(editing.id, values) : createObservation(personId, values))}
      attachmentRecordType="OBSERVATION"
      recordId={editing?.id}
      attachments={editing?.attachments}
    />
  )
}

/** The one-click "Log observation" button in a person's header. */
export function LogObservationButton(props: { personId: string; typeOptions: string[]; conditions: ConditionOption[] }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <NotebookPen className="h-3.5 w-3.5" aria-hidden="true" /> Log observation
      </Button>
      <ObservationDialog {...props} open={open} onClose={() => setOpen(false)} editing={null} />
    </>
  )
}
