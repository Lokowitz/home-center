"use client"

import { useState } from "react"
import { Pencil } from "lucide-react"
import { EntityFormDialog } from "@/components/forms/entity-form-dialog"
import { updatePerson } from "@/lib/actions/people"
import { personFields, personInitial } from "./person-fields"
import type { Person } from "@/app/generated/prisma/client"

export function PersonEditButton({ person, providers, policyChoices = [], policyIds = [] }: { person: Person; providers: { id: string; name: string }[]; policyChoices?: { id: string; name: string }[]; policyIds?: string[] }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-md border bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted transition-colors"
      >
        <Pencil className="h-3.5 w-3.5" /> Edit
      </button>
      <EntityFormDialog
        open={open}
        onClose={() => setOpen(false)}
        title="Edit Person"
        submitLabel="Save Changes"
        successMessage="Person updated."
        fields={personFields(providers, policyChoices)}
        // The key only reaches updatePerson while the list is shown, so a hidden list never unlinks anything.
        initial={personInitial(person, policyChoices.length > 0 ? policyIds : undefined)}
        onSubmit={(values) => updatePerson(person.id, values)}
      />
    </>
  )
}
