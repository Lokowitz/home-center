"use client"

import { useState } from "react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { EntityFormDialog } from "@/components/forms/entity-form-dialog"
import { EntityTable, type EntityColumn } from "@/components/forms/entity-table"
import { AttachmentList } from "@/components/attachments/attachment-list"
import { AttachmentCount } from "@/components/attachments/attachment-count"
import { createCondition, deleteCondition, updateCondition } from "@/lib/actions/health"
import { CONDITION_STATUSES, labelFor, toDateInput } from "@/lib/health"
import type { FieldConfig, FormValues } from "@/lib/form-types"
import { useFormat } from "@/components/regional-provider"
import type { Formatter } from "@/lib/regional"
import { filterObservations, type ObservationLike } from "@/lib/observations"
import type { Attachment, HealthCondition } from "@/app/generated/prisma/client"

export type ConditionRow = HealthCondition & { attachments: Attachment[]; provider: { name: string } | null }

const STATUS_VARIANT = { ACTIVE: "destructive", MANAGED: "secondary", RESOLVED: "outline" } as const

const columnsFor = (fmt: Formatter): EntityColumn<ConditionRow>[] => [
  { key: "name", label: "Condition", cell: (c) => <span className="font-medium">{c.name}</span> },
  { key: "status", label: "Status", cell: (c) => <Badge variant={STATUS_VARIANT[c.status]}>{labelFor(CONDITION_STATUSES, c.status)}</Badge> },
  { key: "diagnosed", label: "Diagnosed", className: "whitespace-nowrap text-muted-foreground", cell: (c) => (c.diagnosedDate ? fmt.date(c.diagnosedDate, { utc: true }) : "—") },
  { key: "provider", label: "Provider", className: "text-muted-foreground", cell: (c) => c.provider?.name ?? "—" },
  { key: "files", label: "Files", cell: (c) => <AttachmentCount attachments={c.attachments} /> },
]

function initialFor(c: ConditionRow | null): FormValues {
  return {
    name: c?.name ?? "",
    status: c?.status ?? "ACTIVE",
    providerId: c?.providerId ?? "",
    diagnosedDate: toDateInput(c?.diagnosedDate),
    resolvedDate: toDateInput(c?.resolvedDate),
    notes: c?.notes ?? "",
  }
}

interface Props {
  personId: string
  conditions: ConditionRow[]
  providers: { id: string; name: string }[]
  /** Newest first; the expanded row shows the ones linked to each condition. */
  observations?: ObservationLike[]
}

export function ConditionsSection({ personId, conditions, providers, observations = [] }: Props) {
  const fmt = useFormat()
  const [editing, setEditing] = useState<ConditionRow | null>(null)
  const [open, setOpen] = useState(false)

  const fields: FieldConfig[] = [
    { name: "name", label: "Condition", kind: "text", required: true, placeholder: "Type 2 diabetes", wide: true, help: "condition.name" },
    {
      name: "status", label: "Status", kind: "select", required: true, options: CONDITION_STATUSES, help: "condition.status",
      // Only a Resolved condition has a resolved date; switching away from Resolved drops it on save.
      notice: (v) => (v.status !== "RESOLVED" && v.resolvedDate ? "The resolved date will be cleared when you save." : null),
    },
    { name: "providerId", label: "Treating provider", kind: "select", options: providers.map((p) => ({ value: p.id, label: p.name })), help: "condition.provider" },
    { name: "diagnosedDate", label: "Diagnosed", kind: "date", help: "condition.diagnosed" },
    { name: "resolvedDate", label: "Resolved", kind: "date", help: "condition.resolved", showWhen: (v) => v.status === "RESOLVED" },
    { name: "notes", label: "Notes", kind: "textarea", wide: true, help: "condition.notes" },
  ]

  async function handleDelete(c: ConditionRow) {
    if (!confirm(`Delete "${c.name}" and its files? Visits and medications linked to it are kept.`)) return
    const result = await deleteCondition(c.id)
    if (result.error) { toast.error("Delete failed."); return }
    toast.success("Condition deleted.")
  }

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-muted-foreground">{conditions.length} condition{conditions.length === 1 ? "" : "s"}</p>
        <Button size="sm" onClick={() => { setEditing(null); setOpen(true) }}>Add Condition</Button>
      </div>

      <EntityTable
        rows={conditions}
        columns={columnsFor(fmt)}
        describe={(c) => c.name}
        onEdit={(c) => { setEditing(c); setOpen(true) }}
        onDelete={handleDelete}
        empty="No conditions recorded."
        renderExpanded={(c) => (
          <div className="space-y-3">
            {c.notes && <p className="text-sm text-muted-foreground whitespace-pre-wrap">{c.notes}</p>}
            {c.resolvedDate && <p className="text-sm text-muted-foreground">Resolved {fmt.date(c.resolvedDate, { utc: true })}</p>}
            <LinkedObservations rows={observations.filter((o) => o.conditionId === c.id)} />
            <AttachmentList recordId={c.id} recordType="CONDITION" attachments={c.attachments} />
          </div>
        )}
      />

      <EntityFormDialog
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? "Edit Condition" : "Add Condition"}
        submitLabel={editing ? "Save Changes" : "Add Condition"}
        successMessage={editing ? "Condition updated." : "Condition added."}
        fields={fields}
        initial={initialFor(editing)}
        onSubmit={(values) => (editing ? updateCondition(editing.id, values) : createCondition(personId, values))}
        attachmentRecordType="CONDITION"
        recordId={editing?.id}
        attachments={editing?.attachments}
      />
    </>
  )
}

function LinkedObservations({ rows }: { rows: ObservationLike[] }) {
  const fmt = useFormat()
  if (!rows.length) return null
  const recent = filterObservations(rows, { range: "30" }, new Date()).length
  return (
    <div className="text-sm">
      <p className="text-muted-foreground">
        {rows.length} observation{rows.length === 1 ? "" : "s"} linked · {recent} in the last 30 days (see the Observations tab)
      </p>
      <ul className="mt-1 space-y-0.5">
        {rows.slice(0, 5).map((o, i) => (
          <li key={i}>
            {fmt.date(o.date, { utc: true })}{o.time ? ` ${fmt.clock(o.time)}` : ""} — {o.type}
            {o.severity ? <span className="text-muted-foreground"> ({o.severity}/5)</span> : null}
          </li>
        ))}
      </ul>
    </div>
  )
}
