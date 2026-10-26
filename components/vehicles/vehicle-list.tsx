"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { MoreHorizontal, Gauge, Pencil, Trash2 } from "lucide-react"
import { deleteVehicle } from "@/lib/actions/vehicles"
import { VehicleFormDialog } from "./vehicle-form-dialog"
import { AssetCollection, type AssetColumn } from "@/components/assets/asset-collection"
import { AssetViewToggle } from "@/components/assets/asset-view-toggle"
import { useAssetView } from "@/components/assets/use-asset-view"
import type { Accessor } from "@/lib/use-client-table"
import type { AssetView } from "@/lib/asset-view"
import { useFormat } from "@/components/regional-provider"
import type { Formatter } from "@/lib/regional"
import type { Vehicle } from "@/app/generated/prisma/client"

const ACCESSORS: Record<string, Accessor<Vehicle>> = {
  name: (v) => v.name,
  year: (v) => v.year,
  make: (v) => `${v.make} ${v.model}`,
  currentMileage: (v) => v.currentMileage,
  color: (v) => v.color,
  vin: (v) => v.vin,
}

const columnsFor = (fmt: Formatter): AssetColumn<Vehicle>[] => [
  { key: "name", label: "Name", cell: (v) => <span className="font-medium">{v.name}</span> },
  { key: "year", label: "Year", className: "text-muted-foreground whitespace-nowrap", cell: (v) => v.year },
  { key: "make", label: "Make / Model", className: "text-muted-foreground", cell: (v) => `${v.make} ${v.model}` },
  { key: "currentMileage", label: fmt.distanceNoun, className: "text-muted-foreground whitespace-nowrap tabular-nums", cell: (v) => (v.currentMileage != null ? `${v.currentMileage.toLocaleString()} ${fmt.meterShort(v.meterUnit)}` : "—") },
  { key: "color", label: "Color", className: "text-muted-foreground", cell: (v) => v.color ?? "—" },
  { key: "vin", label: "VIN", className: "text-muted-foreground font-mono text-xs max-w-[180px] truncate", cell: (v) => v.vin ?? "—" },
]

const INITIAL_DIRS = { year: "desc" as const, currentMileage: "desc" as const }

function toCard(v: Vehicle, fmt: Formatter) {
  return {
    name: v.name,
    subtitle: `${v.year} ${v.make} ${v.model}`,
    meta: [
      ...(v.currentMileage != null ? [{ icon: Gauge, text: `${v.currentMileage.toLocaleString()} ${fmt.meterShort(v.meterUnit)}` }] : []),
      ...(v.color ? [{ text: v.color }] : []),
    ],
    mono: v.vin ? `VIN: ${v.vin}` : null,
  }
}

interface Props {
  vehicles: Vehicle[]
  initialView: AssetView
  propertyChoices?: { id: string; name: string }[]
  /** Shown instead of the usual empty state when the property filter left nothing. */
  emptyText?: string | null
  /** Property a new vehicle starts on; null: Not assigned. */
  newPropertyId?: string | null
}

export function VehicleList({ vehicles, initialView, propertyChoices, emptyText, newPropertyId }: Props) {
  const router = useRouter()
  const fmt = useFormat()
  const [view, setView] = useAssetView("vehicles", initialView)
  const [editing, setEditing] = useState<Vehicle | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete "${name}"? This will also delete all associated records.`)) return
    await deleteVehicle(id)
    toast.success(`"${name}" deleted.`)
  }

  function openNew() { setEditing(null); setDialogOpen(true) }
  function openEdit(v: Vehicle) { setEditing(v); setDialogOpen(true) }

  function renderActions(v: Vehicle) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`More actions for "${v.name}"`}
          className="relative max-sm:before:absolute max-sm:before:top-1/2 max-sm:before:left-1/2 max-sm:before:size-10 max-sm:before:-translate-1/2 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md hover:bg-muted transition-colors"
          onClick={(e) => e.stopPropagation()}
        >
          <MoreHorizontal className="h-4 w-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
          <DropdownMenuItem onClick={() => openEdit(v)}>
            <Pencil className="h-4 w-4 mr-2" /> Edit
          </DropdownMenuItem>
          <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => handleDelete(v.id, v.name)}>
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
          <h1 className="font-heading text-2xl font-semibold">Vehicles</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{vehicles.length} vehicle{vehicles.length !== 1 ? "s" : ""}</p>
        </div>
        <div className="flex items-center gap-2">
          {vehicles.length > 0 && <AssetViewToggle value={view} onChange={setView} />}
          <Button onClick={openNew}>Add Vehicle</Button>
        </div>
      </div>

      {vehicles.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center text-muted-foreground">
          {emptyText ? (
            <p className="font-medium">{emptyText}</p>
          ) : (
            <>
              <p className="font-medium">No vehicles yet</p>
              <p className="text-sm mt-1">Add your first vehicle to get started.</p>
            </>
          )}
        </div>
      ) : (
        <AssetCollection
          items={vehicles}
          view={view}
          assetType="VEHICLE"
          imageFilenameOf={(v) => v.imageFilename}
          toCard={(v) => toCard(v, fmt)}
          columns={columnsFor(fmt)}
          accessors={ACCESSORS}
          defaultSort="name"
          defaultDir="asc"
          initialDirs={INITIAL_DIRS}
          renderActions={renderActions}
          onOpen={(v) => router.push(`/assets/vehicles/${v.id}`)}
          label="vehicles"
        />
      )}

      <VehicleFormDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        vehicle={editing}
        propertyChoices={propertyChoices}
        newPropertyId={newPropertyId}
      />
    </>
  )
}
