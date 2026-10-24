"use client"

import { useState } from "react"
import { CalendarClock } from "lucide-react"
import { MaintenanceFormDialog, type MaintenanceFormDefaults } from "@/components/maintenance/maintenance-form-dialog"
import { localDay, replacementPlan } from "@/lib/equipment-life"
import type { RoomOption } from "@/lib/rooms-server"
import type { Equipment } from "@/app/generated/prisma/client"

/** Opens the reminder form prefilled as a one-time "Replace ..." item. Nothing is saved until the form is. */
export function PlanReplacementButton({ equipment, roomOptions }: { equipment: Equipment; roomOptions: RoomOption[] }) {
  const [open, setOpen] = useState(false)
  const [defaults, setDefaults] = useState<MaintenanceFormDefaults | undefined>(undefined)

  function start() {
    const plan = replacementPlan(equipment, localDay(new Date()))
    setDefaults({
      title: plan.title,
      repeat: "once",
      nextDueDate: plan.dueDate.toISOString().split("T")[0],
      estimatedCost: plan.estimatedCost?.toString() ?? "",
    })
    setOpen(true)
  }

  return (
    <>
      <button
        type="button"
        onClick={start}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-md border bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted transition-colors"
      >
        <CalendarClock className="h-3.5 w-3.5" /> Plan replacement
      </button>
      <MaintenanceFormDialog
        open={open}
        onClose={() => setOpen(false)}
        assetId={equipment.id}
        assetType="EQUIPMENT"
        roomOptions={roomOptions}
        defaultRoomId={equipment.roomId}
        defaults={defaults}
      />
    </>
  )
}
