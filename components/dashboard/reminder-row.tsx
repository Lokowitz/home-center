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

/**
 * One dashboard reminder: open its asset, or deal with it right here. The row
 * sizes itself to its own width, not the screen's: in a narrow card (the
 * dashboard's three columns, a phone) the title and asset get the whole first
 * line and the due badge and actions drop to a second; with room, it's one line.
 */
export function ReminderRow({ schedule, assetName, href, overdue, dueLabel, currentMileage, meterUnit }: Props) {
  return (
    <div className="@container rounded-md px-2 py-1.5 text-sm transition-colors duration-150 hover:bg-muted/60">
      <div className="flex flex-col gap-1 @lg:flex-row @lg:items-center @lg:gap-2">
        <Link href={href} title={assetName ? `${schedule.title} — ${assetName}` : schedule.title} className="flex min-w-0 flex-1 items-center gap-2 py-1">
          {overdue ? <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-destructive" /> : <Clock className="h-3.5 w-3.5 shrink-0 text-amber-700 dark:text-amber-400" />}
          <span className="min-w-0 flex-1 truncate font-medium">{schedule.title}</span>
          {assetName && <span className="min-w-0 max-w-[45%] shrink truncate text-xs text-muted-foreground">{assetName}</span>}
        </Link>
        {/* Indented under the title on its own line, so the badge lines up with the text, not the icon. */}
        <div className="flex shrink-0 items-center gap-2 pl-5.5 @lg:pl-0">
          <Badge variant={overdue ? "destructive" : "secondary"} className="shrink-0 text-xs">
            {dueLabel}
          </Badge>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <ReminderActions schedule={schedule} currentMileage={currentMileage} meterUnit={meterUnit} compact />
          </div>
        </div>
      </div>
    </div>
  )
}
