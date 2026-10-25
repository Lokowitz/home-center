"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { FieldHelp } from "@/components/ui/field-help"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { updateNotificationRepeat } from "@/lib/actions/users"
import { REPEAT_OPTIONS, type NotificationRepeat } from "@/lib/notifications/repeat"
import { untilDismissedWarning } from "@/lib/notifications/interval"
import { Warning } from "./notification-schedule"

export function RepeatPreferences({ repeat, intervalMinutes }: { repeat: NotificationRepeat; intervalMinutes: number }) {
  const [value, setValue] = useState<NotificationRepeat>(repeat)
  const [pending, startTransition] = useTransition()

  function change(next: string | null) {
    if (!next || next === value) return
    const previous = value
    setValue(next as NotificationRepeat)
    startTransition(async () => {
      const result = await updateNotificationRepeat(next)
      if (result?.error) {
        setValue(previous) // put the control back if the server refused
        toast.error(result.error)
      } else if (next === "UNTIL_DISMISSED") {
        toast.warning("Saved. Expect a lot of reminders with this on. Dismiss items to stop them.", { duration: 10000 })
      } else {
        toast.success("Reminder preference saved.")
      }
    })
  }

  const hint = REPEAT_OPTIONS.find((o) => o.value === value)?.hint
  const spam = value === "UNTIL_DISMISSED" ? untilDismissedWarning(intervalMinutes) : null

  return (
    <Card className="py-5">
      <CardHeader className="px-5">
        <CardTitle className="flex items-center gap-2">
          Repeat reminders
          <FieldHelp id="repeat.mode" />
        </CardTitle>
        <CardDescription>
          How often you&apos;re reminded about the same due item, in the bell and by email. A new due
          date always starts afresh.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-5">
        <div className="flex flex-wrap items-center gap-3">
          <Select value={value} onValueChange={change} disabled={pending}>
            <SelectTrigger className="w-80">
              {/* Base UI renders the raw value unless given a formatter. */}
              <SelectValue>
                {(v: string) => REPEAT_OPTIONS.find((o) => o.value === v)?.label ?? v}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {REPEAT_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-sm text-muted-foreground">{hint}</span>
        </div>
        {spam && (
          <div className="mt-3 space-y-2">
            <Warning>{spam}</Warning>
            <Warning>
              Reading an item doesn&apos;t stop it. Only dismissing it does. If you use email set to &quot;As soon as
              possible&quot;, every one of these is an email. Most people should pick one of the other two.
            </Warning>
          </div>
        )}
        {!spam && value !== "UNTIL_DISMISSED" && (
          <p className="mt-3 text-xs text-muted-foreground">
            &quot;Every check until dismissed&quot; repeats a reminder on every check, which is very noisy unless checks are
            less than once a day apart.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
