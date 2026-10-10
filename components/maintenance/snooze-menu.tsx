"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { AlarmClockOff, BellRing, Pause, Play } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { snoozeMaintenanceSchedule, setMaintenanceScheduleActive } from "@/lib/actions/maintenance"
import { SNOOZE_OPTIONS, isSnoozed, type SnoozeFor } from "@/lib/maintenance-due"
import { cn } from "@/lib/utils"

interface Props {
  schedule: { id: string; title: string; isActive: boolean; snoozedUntil: Date | null }
  /** Just the clock icon, for tight rows. */
  iconOnly?: boolean
  className?: string
}

type ScheduleRef = Props["schedule"]

/**
 * Runs a reminder's snooze and pause actions with a toast and a refresh. Shared
 * by the menu below and the notification bell, which nests the choices in its
 * own menu instead.
 */
export function useReminderActions(schedule: Pick<ScheduleRef, "id" | "title">, onDone?: () => void) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function run(action: () => Promise<{ error?: string } | undefined>, done: string) {
    startTransition(async () => {
      const result = await action()
      if (!result || result.error) { toast.error("Something went wrong."); return }
      toast.success(done)
      onDone?.()
      router.refresh()
    })
  }

  return {
    pending,
    run,
    snooze: (value: SnoozeFor, label: string) =>
      run(() => snoozeMaintenanceSchedule(schedule.id, value), `"${schedule.title}" snoozed for ${label}.`),
    // Paused reminders leave the dashboard and the bell, so say where to find them.
    pause: () =>
      run(() => setMaintenanceScheduleActive(schedule.id, false), `"${schedule.title}" paused. Resume it from its asset page.`),
  }
}

/** Snooze a reminder for a while, wake it early, or pause it outright. */
export function SnoozeMenu({ schedule, iconOnly = false, className }: Props) {
  const { pending, run, snooze, pause } = useReminderActions(schedule)
  const snoozed = isSnoozed(schedule)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Snooze "${schedule.title}"`}
        disabled={pending}
        className={cn(
          "inline-flex h-7 shrink-0 items-center justify-center gap-1 rounded-md border text-xs font-medium transition-colors hover:bg-muted disabled:opacity-50",
          iconOnly ? "w-7" : "px-2",
          className,
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <AlarmClockOff className="h-3.5 w-3.5" />
        {!iconOnly && "Snooze"}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
        {schedule.isActive && SNOOZE_OPTIONS.map((o) => (
          <DropdownMenuItem key={o.value} onClick={() => snooze(o.value, o.label)}>
            {o.label}
          </DropdownMenuItem>
        ))}
        {schedule.isActive && snoozed && (
          <DropdownMenuItem onClick={() => run(() => snoozeMaintenanceSchedule(schedule.id, null), `"${schedule.title}" is back on.`)}>
            <BellRing className="mr-2 h-4 w-4" /> Unsnooze
          </DropdownMenuItem>
        )}
        {schedule.isActive && <DropdownMenuSeparator />}
        {schedule.isActive ? (
          <DropdownMenuItem onClick={pause}>
            <Pause className="mr-2 h-4 w-4" /> Pause
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onClick={() => run(() => setMaintenanceScheduleActive(schedule.id, true), `"${schedule.title}" resumed.`)}>
            <Play className="mr-2 h-4 w-4" /> Resume
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
