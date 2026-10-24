"use client"

import { useState } from "react"
import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { EquipmentFormDialog, type EquipmentWithRoom } from "./equipment-form-dialog"
import { EquipmentRows } from "./equipment-rows"
import { EquipmentValueSummary } from "./equipment-value-summary"
import type { PropertyWithRooms } from "@/lib/rooms-server"

/** A property's equipment tab: every item at the property, added and edited in a dialog over the page. */
export function PropertyEquipment({ equipment, property, openId }: { equipment: EquipmentWithRoom[]; property: PropertyWithRooms; openId?: string }) {
  // The target outlives `open` so the dialog keeps its content while it fades out.
  const [target, setTarget] = useState<"new" | string>("new")
  const [dialogOpen, setDialogOpen] = useState(false)

  const [prevOpenId, setPrevOpenId] = useState<string | undefined>(undefined)
  if (openId !== prevOpenId) {
    setPrevOpenId(openId)
    if (openId && equipment.some((e) => e.id === openId)) { setTarget(openId); setDialogOpen(true) }
  }

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{equipment.length} item{equipment.length !== 1 ? "s" : ""}</p>
        <Button size="sm" onClick={() => { setTarget("new"); setDialogOpen(true) }}>
          <Plus className="mr-1 h-3.5 w-3.5" /> Add equipment
        </Button>
      </div>

      {equipment.length > 0 && <EquipmentValueSummary equipment={equipment} />}

      {equipment.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          No equipment at this property yet.
        </div>
      ) : (
        <EquipmentRows equipment={equipment} showLocation onEdit={(e) => { setTarget(e.id); setDialogOpen(true) }} />
      )}

      <EquipmentFormDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        equipment={target !== "new" ? equipment.find((e) => e.id === target) ?? null : null}
        properties={[property]}
        defaultPropertyId={property.id}
      />
    </>
  )
}
