"use client"

import { useState } from "react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { EntityFormDialog } from "@/components/forms/entity-form-dialog"
import { EntityTable, type EntityColumn } from "@/components/forms/entity-table"
import { AttachmentList } from "@/components/attachments/attachment-list"
import { AttachmentCount } from "@/components/attachments/attachment-count"
import { createAllergy, deleteAllergy, updateAllergy } from "@/lib/actions/health"
import { ALLERGY_SEVERITIES, labelFor } from "@/lib/health"
import type { FieldConfig, FormValues } from "@/lib/form-types"
import type { Allergy, Attachment } from "@/app/generated/prisma/client"

export type AllergyRow = Allergy & { attachments: Attachment[] }

const FIELDS: FieldConfig[] = [
  { name: "substance", label: "Substance", kind: "text", required: true, placeholder: "Penicillin", help: "allergy.substance" },
  { name: "severity", label: "Severity", kind: "select", required: true, options: ALLERGY_SEVERITIES, help: "allergy.severity" },
  { name: "reaction", label: "Reaction", kind: "text", placeholder: "Hives, swelling", wide: true, help: "allergy.reaction" },
  { name: "notes", label: "Notes", kind: "textarea", wide: true, help: "allergy.notes" },
]

const SEVERITY_VARIANT = { MILD: "outline", MODERATE: "secondary", SEVERE: "destructive" } as const

const COLUMNS: EntityColumn<AllergyRow>[] = [
  { key: "substance", label: "Substance", cell: (a) => <span className="font-medium">{a.substance}</span> },
  { key: "severity", label: "Severity", cell: (a) => <Badge variant={SEVERITY_VARIANT[a.severity]}>{labelFor(ALLERGY_SEVERITIES, a.severity)}</Badge> },
  { key: "reaction", label: "Reaction", className: "text-muted-foreground", cell: (a) => a.reaction ?? "—" },
  { key: "files", label: "Files", cell: (a) => <AttachmentCount attachments={a.attachments} /> },
]

function initialFor(a: AllergyRow | null): FormValues {
  return { substance: a?.substance ?? "", severity: a?.severity ?? "MODERATE", reaction: a?.reaction ?? "", notes: a?.notes ?? "" }
}

export function AllergiesSection({ personId, allergies }: { personId: string; allergies: AllergyRow[] }) {
  const [editing, setEditing] = useState<AllergyRow | null>(null)
  const [open, setOpen] = useState(false)

  async function handleDelete(a: AllergyRow) {
    if (!confirm(`Delete the ${a.substance} allergy?`)) return
    const result = await deleteAllergy(a.id)
    if (result.error) { toast.error("Delete failed."); return }
    toast.success("Allergy deleted.")
  }

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-muted-foreground">{allergies.length} allerg{allergies.length === 1 ? "y" : "ies"}</p>
        <Button size="sm" onClick={() => { setEditing(null); setOpen(true) }}>Add Allergy</Button>
      </div>

      <EntityTable
        rows={allergies}
        columns={COLUMNS}
        describe={(a) => `${a.substance} allergy`}
        onEdit={(a) => { setEditing(a); setOpen(true) }}
        onDelete={handleDelete}
        empty="No allergies recorded."
        renderExpanded={(a) => <AttachmentList recordId={a.id} recordType="ALLERGY" attachments={a.attachments} />}
      />

      <EntityFormDialog
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? "Edit Allergy" : "Add Allergy"}
        submitLabel={editing ? "Save Changes" : "Add Allergy"}
        successMessage={editing ? "Allergy updated." : "Allergy added."}
        fields={FIELDS}
        initial={initialFor(editing)}
        onSubmit={(values) => (editing ? updateAllergy(editing.id, values) : createAllergy(personId, values))}
        attachmentRecordType="ALLERGY"
        recordId={editing?.id}
        attachments={editing?.attachments}
      />
    </>
  )
}
