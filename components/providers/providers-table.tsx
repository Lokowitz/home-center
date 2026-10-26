"use client"

import { useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { EntityFormDialog } from "@/components/forms/entity-form-dialog"
import { EntityTable, type EntityColumn } from "@/components/forms/entity-table"
import { createProvider, deleteProvider, updateProvider } from "@/lib/actions/providers"
import type { FieldConfig, FormValues } from "@/lib/form-types"
import type { Provider } from "@/app/generated/prisma/client"
import { useFormat } from "@/components/regional-provider"

const FIELDS: FieldConfig[] = [
  { name: "name", label: "Name", kind: "text", required: true, placeholder: "Dr. Maria Chen", wide: true, help: "provider.name" },
  { name: "specialty", label: "Specialty", kind: "text", placeholder: "Family medicine", help: "provider.specialty" },
  { name: "practice", label: "Practice", kind: "text", placeholder: "Riverside Family Health", help: "provider.practice" },
  { name: "phone", label: "Phone", kind: "tel", placeholder: "555-555-5555", help: "provider.phone" },
  { name: "email", label: "Email", kind: "email", help: "provider.email" },
  { name: "address", label: "Address", kind: "text", wide: true, help: "provider.address" },
  { name: "notes", label: "Notes", kind: "textarea", wide: true, help: "provider.notes" },
]

function initialFor(p: Provider | null): FormValues {
  return {
    name: p?.name ?? "", specialty: p?.specialty ?? "", practice: p?.practice ?? "",
    phone: p?.phone ?? "", email: p?.email ?? "", address: p?.address ?? "", notes: p?.notes ?? "",
  }
}

interface Props {
  providers: Provider[]
  stats: Record<string, { visits: number; spend: number }>
  openId?: string
}

export function ProvidersTable({ providers, stats, openId }: Props) {
  const fmt = useFormat()
  const [editing, setEditing] = useState<Provider | null>(null)
  const [open, setOpen] = useState(false)

  const [prevOpenId, setPrevOpenId] = useState<string | undefined>(undefined)
  if (openId !== prevOpenId) {
    setPrevOpenId(openId)
    const match = openId ? providers.find((p) => p.id === openId) : undefined
    if (match) { setEditing(match); setOpen(true) }
  }

  const columns: EntityColumn<Provider>[] = [
    {
      key: "name", label: "Provider",
      cell: (p) => (
        <div>
          <div className="font-medium">{p.name}</div>
          {p.specialty && <div className="text-xs text-muted-foreground">{p.specialty}</div>}
        </div>
      ),
    },
    { key: "practice", label: "Practice", className: "text-muted-foreground", cell: (p) => p.practice ?? "—" },
    {
      key: "phone", label: "Phone", className: "whitespace-nowrap",
      cell: (p) => (p.phone ? <a href={`tel:${p.phone}`} onClick={(e) => e.stopPropagation()} className="hover:underline">{p.phone}</a> : "—"),
    },
    { key: "visits", label: "Visits", className: "text-right text-muted-foreground", cell: (p) => stats[p.id]?.visits ?? 0 },
    { key: "spend", label: "Spend", className: "text-right whitespace-nowrap", cell: (p) => fmt.money(stats[p.id]?.spend ?? 0) },
  ]

  async function handleDelete(p: Provider) {
    if (!confirm(`Delete "${p.name}"? Visits, conditions and prescriptions keep their history but lose the link.`)) return
    const result = await deleteProvider(p.id)
    if (result.error) { toast.error("Delete failed."); return }
    toast.success("Provider deleted.")
  }

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold">Providers</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Doctors, dentists, therapists and clinics the household uses.</p>
        </div>
        <Button onClick={() => { setEditing(null); setOpen(true) }}>Add Provider</Button>
      </div>

      <EntityTable
        rows={providers}
        columns={columns}
        describe={(p) => p.name}
        onEdit={(p) => { setEditing(p); setOpen(true) }}
        onDelete={handleDelete}
        empty="No providers yet. Add the doctors and clinics your household sees."
        renderExpanded={(p) => (
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
            {p.email && <span>Email: <a href={`mailto:${p.email}`} className="hover:underline">{p.email}</a></span>}
            {p.address && <span>Address: {p.address}</span>}
            {p.notes && <span className="whitespace-pre-wrap">{p.notes}</span>}
          </div>
        )}
      />

      <EntityFormDialog
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? "Edit Provider" : "Add Provider"}
        submitLabel={editing ? "Save Changes" : "Add Provider"}
        successMessage={editing ? "Provider updated." : "Provider added."}
        fields={FIELDS}
        initial={initialFor(editing)}
        onSubmit={(values) => (editing ? updateProvider(editing.id, values) : createProvider(values))}
      />
    </>
  )
}
