"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { AlertTriangle, MoreHorizontal, Pencil, Pill, Stethoscope, Trash2 } from "lucide-react"
import { AssetCollection, type AssetColumn } from "@/components/assets/asset-collection"
import { AssetViewToggle } from "@/components/assets/asset-view-toggle"
import { useAssetView } from "@/components/assets/use-asset-view"
import { EntityFormDialog } from "@/components/forms/entity-form-dialog"
import { createPerson, deletePerson, updatePerson } from "@/lib/actions/people"
import { ageFrom, labelFor, RELATIONSHIPS } from "@/lib/health"
import { personFields, personInitial, propertiesWithLinked } from "./person-fields"
import type { Accessor } from "@/lib/use-client-table"
import type { AssetView } from "@/lib/asset-view"
import type { Person } from "@/app/generated/prisma/client"

export type PersonRow = Person & { _count: { conditions: number; medications: number; allergies: number } }

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`

interface Props {
  people: PersonRow[]
  providers: { id: string; name: string }[]
  initialView: AssetView
  /** Properties to pick from. Absent: no Property field and a person's link is left alone. */
  propertyChoices?: { id: string; name: string }[]
  /** Shown instead of the usual empty state when the property filter left nothing. */
  emptyText?: string | null
  /** Property a new person starts on; null: Not assigned. */
  newPropertyId?: string | null
}

export function PeopleList({ people, providers, initialView, propertyChoices, emptyText, newPropertyId }: Props) {
  const router = useRouter()
  const [view, setView] = useAssetView("people", initialView)
  const [editing, setEditing] = useState<PersonRow | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const age = (p: PersonRow) => (p.dateOfBirth ? ageFrom(p.dateOfBirth, new Date()) : null)

  // Memoized because the sort in useClientTable keys off this object's identity.
  const accessors = useMemo<Record<string, Accessor<PersonRow>>>(
    () => ({
      name: (p) => p.name,
      relationship: (p) => labelFor(RELATIONSHIPS, p.relationship),
      age: (p) => (p.dateOfBirth ? ageFrom(p.dateOfBirth, new Date()) : null),
      conditions: (p) => p._count.conditions,
      medications: (p) => p._count.medications,
    }),
    []
  )

  const columns: AssetColumn<PersonRow>[] = [
    { key: "name", label: "Name", cell: (p) => <span className="font-medium">{p.name}</span> },
    { key: "relationship", label: "Relationship", cell: (p) => <Badge variant="secondary" className="text-xs">{labelFor(RELATIONSHIPS, p.relationship)}</Badge> },
    { key: "age", label: "Age", className: "text-muted-foreground", cell: (p) => age(p) ?? "—" },
    { key: "conditions", label: "Active conditions", className: "text-muted-foreground", cell: (p) => p._count.conditions },
    { key: "medications", label: "Medications", className: "text-muted-foreground", cell: (p) => p._count.medications },
    {
      key: "allergy", label: "Allergies", sortable: false,
      cell: (p) => (p._count.allergies > 0 ? <Badge variant="destructive" className="text-xs">Severe</Badge> : "—"),
    },
  ]

  function toCard(p: PersonRow) {
    const a = age(p)
    return {
      name: p.name,
      badge: labelFor(RELATIONSHIPS, p.relationship),
      subtitle: a != null ? `Age ${a}` : null,
      meta: [
        ...(p._count.conditions > 0 ? [{ icon: Stethoscope, text: plural(p._count.conditions, "active condition") }] : []),
        ...(p._count.medications > 0 ? [{ icon: Pill, text: plural(p._count.medications, "medication") }] : []),
        ...(p._count.allergies > 0 ? [{ icon: AlertTriangle, text: "Severe allergy on file" }] : []),
      ],
    }
  }

  async function handleDelete(p: PersonRow) {
    if (!confirm(`Delete "${p.name}"? This also deletes their visits, reminders, conditions, medications and files.`)) return
    const result = await deletePerson(p.id)
    if (result.error) { toast.error(typeof result.error === "string" ? result.error : "Delete failed."); return }
    toast.success(`"${p.name}" deleted.`)
  }

  function openNew() { setEditing(null); setDialogOpen(true) }
  function openEdit(p: PersonRow) { setEditing(p); setDialogOpen(true) }

  function renderActions(p: PersonRow) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`More actions for "${p.name}"`}
          className="relative max-sm:before:absolute max-sm:before:top-1/2 max-sm:before:left-1/2 max-sm:before:size-10 max-sm:before:-translate-1/2 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md hover:bg-muted transition-colors"
          onClick={(evt) => evt.stopPropagation()}
        >
          <MoreHorizontal className="h-4 w-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onClick={(evt) => evt.stopPropagation()}>
          <DropdownMenuItem onClick={() => openEdit(p)}>
            <Pencil className="h-4 w-4 mr-2" /> Edit
          </DropdownMenuItem>
          <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => handleDelete(p)}>
            <Trash2 className="h-4 w-4 mr-2" /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold">People</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{people.length} {people.length === 1 ? "person" : "people"}</p>
        </div>
        <div className="flex items-center gap-2">
          {people.length > 0 && <AssetViewToggle value={view} onChange={setView} />}
          <Button onClick={openNew}>Add Person</Button>
        </div>
      </div>

      {people.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center text-muted-foreground">
          {emptyText ? (
            <p className="font-medium">{emptyText}</p>
          ) : (
            <>
              <p className="font-medium">No people yet</p>
              <p className="text-sm mt-1">Add household members to track visits, medical receipts, conditions and medications.</p>
            </>
          )}
        </div>
      ) : (
        <AssetCollection
          items={people}
          view={view}
          assetType="PERSON"
          imageFilenameOf={(p) => p.imageFilename}
          toCard={toCard}
          columns={columns}
          accessors={accessors}
          defaultSort="name"
          defaultDir="asc"
          renderActions={renderActions}
          onOpen={(p) => router.push(`/assets/people/${p.id}`)}
          label="people"
        />
      )}

      <EntityFormDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title={editing ? "Edit Person" : "Add Person"}
        submitLabel={editing ? "Save Changes" : "Add Person"}
        successMessage={editing ? "Person updated." : "Person added."}
        fields={personFields(providers, [], propertiesWithLinked(propertyChoices, editing))}
        initial={personInitial(editing, undefined, !!propertyChoices, newPropertyId ?? "")}
        onSubmit={(values) => (editing ? updatePerson(editing.id, values) : createPerson(values))}
      />
    </>
  )
}
