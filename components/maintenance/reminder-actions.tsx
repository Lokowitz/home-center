"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { CompleteDialog } from "./complete-dialog"
import { SnoozeMenu } from "./snooze-menu"
import type { MaintenanceSchedule, MeterUnit } from "@/app/generated/prisma/client"

interface Props {
  schedule: MaintenanceSchedule
  /** The vehicle's odometer, to prefill the completion. Null for anything else. */
  currentMileage: number | null
  meterUnit: MeterUnit
  /** Snooze as an icon alone, for tight rows. */
  compact?: boolean
}

/** Complete and Snooze for a due reminder, wherever it's listed outside its asset page. */
export function ReminderActions({ schedule, currentMileage, meterUnit, compact = false }: Props) {
  const [completing, setCompleting] = useState(false)

  return (
    <>
      <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => setCompleting(true)} aria-label={`Complete "${schedule.title}"`}>
        Complete
      </Button>
      <SnoozeMenu schedule={schedule} iconOnly={compact} />
      {completing && (
        <CompleteDialog
          schedule={schedule}
          currentMileage={currentMileage}
          meterUnit={meterUnit}
          onClose={() => setCompleting(false)}
        />
      )}
    </>
  )
}
