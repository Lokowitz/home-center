import Link from "next/link"
import { AlertTriangle, Clock } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { ReminderActions } from "@/components/maintenance/reminder-actions"
import type { MaintenanceSchedule, MeterUnit } from "@/app/generated/prisma/client"

interface Props {
  schedule: MaintenanceSchedule
  assetName: string | undefined
  href: string
  overdue: boolean
  dueLabel: string
  /** The vehicle's odometer, to prefill the completion. Null for anything else. */
  currentMileage: number | null
  meterUnit: MeterUnit
}

/** One dashboard reminder: open its asset, or deal with it right here. */
export function ReminderRow({ schedule, assetName, href, overdue, dueLabel, currentMileage, meterUnit }: Props) {
  return (
    <div className="group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors duration-150 hover:bg-muted/60">
      <Link href={href} className="flex min-w-0 flex-1 items-center gap-2 py-1">
        {overdue ? <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-destructive" /> : <Clock className="h-3.5 w-3.5 shrink-0 text-amber-700 dark:text-amber-400" />}
        <span className="flex-1 truncate">{schedule.title}</span>
        <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">{assetName}</span>
        <Badge variant={overdue ? "destructive" : "secondary"} className="shrink-0 text-xs">
          {dueLabel}
        </Badge>
      </Link>
      <ReminderActions schedule={schedule} currentMileage={currentMileage} meterUnit={meterUnit} compact />
    </div>
  )
}
