"use client"

import { useState } from "react"
import { Pencil } from "lucide-react"
import { EquipmentFormDialog, type EquipmentWithRoom } from "./equipment-form-dialog"
import type { PropertyWithRooms } from "@/lib/rooms-server"

export function EquipmentEditButton({
  equipment,
  properties,
}: {
  equipment: EquipmentWithRoom
  properties: PropertyWithRooms[]
}) {
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
      <EquipmentFormDialog open={open} onClose={() => setOpen(false)} equipment={equipment} properties={properties} />
    </>
  )
}
