"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { MoreHorizontal, MapPin, Pencil, Trash2 } from "lucide-react"
import { deleteProperty } from "@/lib/actions/properties"
import { PropertyFormDialog } from "./property-form-dialog"
import { AssetCollection, type AssetColumn } from "@/components/assets/asset-collection"
import { AssetViewToggle } from "@/components/assets/asset-view-toggle"
import { useAssetView } from "@/components/assets/use-asset-view"
import type { Accessor } from "@/lib/use-client-table"
import type { AssetView } from "@/lib/asset-view"
import type { Property } from "@/app/generated/prisma/client"
import { useFormat } from "@/components/regional-provider"
import type { Formatter } from "@/lib/regional"

const typeLabel: Record<string, string> = {
  HOUSE: "House", CONDO: "Condo", TOWNHOUSE: "Townhouse", LOT: "Lot / Land", OTHER: "Other",
}

const ACCESSORS: Record<string, Accessor<Property>> = {
  name: (p) => p.name,
  type: (p) => typeLabel[p.type],
  address: (p) => p.address,
  sqFt: (p) => p.sqFt,
  yearBuilt: (p) => p.yearBuilt,
  purchasePrice: (p) => p.purchasePrice,
}

const columnsFor = (fmt: Formatter): AssetColumn<Property>[] => [
  { key: "name", label: "Name", cell: (p) => <span className="font-medium">{p.name}</span> },
  { key: "type", label: "Type", cell: (p) => <Badge variant="secondary" className="text-xs">{typeLabel[p.type]}</Badge> },
  { key: "address", label: "Address", className: "text-muted-foreground max-w-[280px] truncate", cell: (p) => p.address },
  { key: "sqFt", label: fmt.areaShort === "ft²" ? "Sq Ft" : fmt.areaShort, className: "text-muted-foreground whitespace-nowrap", cell: (p) => (p.sqFt ? p.sqFt.toLocaleString() : "—") },
  { key: "yearBuilt", label: "Built", className: "text-muted-foreground whitespace-nowrap", cell: (p) => p.yearBuilt ?? "—" },
  { key: "purchasePrice", label: "Price", className: "text-muted-foreground whitespace-nowrap tabular-nums", cell: (p) => (p.purchasePrice ? fmt.moneyWhole(p.purchasePrice) : "—") },
]

const INITIAL_DIRS = { sqFt: "desc" as const, yearBuilt: "desc" as const, purchasePrice: "desc" as const }

function toCard(p: Property, fmt: Formatter) {
  return {
    name: p.name,
    badge: typeLabel[p.type],
    meta: [
      { icon: MapPin, text: p.address, clamp: true },
      ...(p.sqFt ? [{ text: fmt.area(p.sqFt) }] : []),
      ...(p.yearBuilt ? [{ text: `Built ${p.yearBuilt}` }] : []),
      ...(p.purchasePrice ? [{ text: fmt.moneyWhole(p.purchasePrice) }] : []),
    ],
  }
}

interface Props {
  properties: Property[]
  initialView: AssetView
}

export function PropertyList({ properties, initialView }: Props) {
  const fmt = useFormat()
  const router = useRouter()
  const [view, setView] = useAssetView("properties", initialView)
  const [editing, setEditing] = useState<Property | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete "${name}"? This will also delete all associated records. Equipment in it is kept.`)) return
    await deleteProperty(id)
    toast.success(`"${name}" deleted.`)
  }

  function openNew() { setEditing(null); setDialogOpen(true) }
  function openEdit(p: Property) { setEditing(p); setDialogOpen(true) }

  function renderActions(p: Property) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`More actions for "${p.name}"`}
          className="relative max-sm:before:absolute max-sm:before:top-1/2 max-sm:before:left-1/2 max-sm:before:size-10 max-sm:before:-translate-1/2 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md hover:bg-muted transition-colors"
          onClick={(e) => e.stopPropagation()}
        >
          <MoreHorizontal className="h-4 w-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
          <DropdownMenuItem onClick={() => openEdit(p)}>
            <Pencil className="h-4 w-4 mr-2" /> Edit
          </DropdownMenuItem>
          <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => handleDelete(p.id, p.name)}>
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
          <h1 className="font-heading text-2xl font-semibold">Properties</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {properties.length} {properties.length === 1 ? "property" : "properties"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {properties.length > 0 && <AssetViewToggle value={view} onChange={setView} />}
          <Button onClick={openNew}>Add Property</Button>
        </div>
      </div>

      {properties.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center text-muted-foreground">
          <p className="font-medium">No properties yet</p>
          <p className="text-sm mt-1">Add your first property to get started.</p>
        </div>
      ) : (
        <AssetCollection
          items={properties}
          view={view}
          assetType="PROPERTY"
          imageFilenameOf={(p) => p.imageFilename}
          toCard={(p) => toCard(p, fmt)}
          columns={columnsFor(fmt)}
          accessors={ACCESSORS}
          defaultSort="name"
          defaultDir="asc"
          initialDirs={INITIAL_DIRS}
          renderActions={renderActions}
          onOpen={(p) => router.push(`/assets/properties/${p.id}`)}
          label="properties"
        />
      )}

      <PropertyFormDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        property={editing}
      />
    </>
  )
}
