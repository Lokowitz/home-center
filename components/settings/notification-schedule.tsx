"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"
import { AlertTriangle } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { FieldHelp } from "@/components/ui/field-help"
import { updateNotificationInterval } from "@/lib/actions/notification-settings"
import {
  describeInterval,
  intervalWarning,
  isValidInterval,
  MIN_INTERVAL_MINUTES,
  untilDismissedWarning,
  type IntervalSource,
} from "@/lib/notifications/interval"

export function Warning({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-1.5 rounded-md border border-amber-500/50 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>{children}</span>
    </p>
  )
}

// Admin-only. The interval is server-wide, so everyone's reminders follow it.
export function NotificationSchedule({
  savedMinutes,
  effectiveMinutes,
  fallbackMinutes,
  source,
  untilDismissedPeople,
}: {
  /** What is saved in Settings; blank when it falls back to the environment or default. */
  savedMinutes: string
  effectiveMinutes: number
  /** What applies with nothing saved: the environment variable, else 360. */
  fallbackMinutes: number
  source: IntervalSource
  /** How many people use "Every check until dismissed". */
  untilDismissedPeople: number
}) {
  const [value, setValue] = useState(savedMinutes)
  const [pending, startTransition] = useTransition()

  // What would be in effect if saved now.
  const typed = value.trim() === "" ? null : Number(value)
  const valid = typed === null || isValidInterval(typed)
  const shown = typed ?? fallbackMinutes
  const lowWarning = valid ? intervalWarning(shown) : null
  const repeatWarning = valid && untilDismissedPeople > 0 ? untilDismissedWarning(shown) : null

  function save() {
    startTransition(async () => {
      const result = await updateNotificationInterval({ intervalMinutes: value })
      if (result?.error) toast.error(result.error)
      else toast.success("Check interval saved.")
    })
  }

  return (
    <Card className="py-5">
      <CardHeader className="px-5">
        <CardTitle className="flex items-center gap-2">
          Check schedule
          <FieldHelp id="notify.interval" />
        </CardTitle>
        <CardDescription>
          How often HomeCenter looks for due items, then creates, emails and pushes reminders. Right now
          it checks every {describeInterval(effectiveMinutes)}
          {source === "env" ? " (from NOTIFY_INTERVAL_MINUTES)" : source === "default" ? " (the default)" : ""}.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 px-5">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="number"
            min={0}
            className="w-32"
            placeholder="360"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            aria-label="Minutes between checks"
          />
          <span className="text-sm text-muted-foreground">minutes</span>
          <Button type="button" disabled={pending || !valid} onClick={save}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          0 turns checks off. The lowest is {MIN_INTERVAL_MINUTES}. Leave it blank to use the default of 6 hours. Takes effect
          when you save.
        </p>
        {!valid && <p className="text-xs text-destructive">Enter 0, or {MIN_INTERVAL_MINUTES} or more.</p>}
        {lowWarning && <Warning>{lowWarning}</Warning>}
        {repeatWarning && (
          <Warning>
            {untilDismissedPeople === 1 ? "1 person is" : `${untilDismissedPeople} people are`} set to &quot;Every check until
            dismissed&quot;. {repeatWarning}
          </Warning>
        )}
      </CardContent>
    </Card>
  )
}
