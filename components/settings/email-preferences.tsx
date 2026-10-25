"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { FieldHelp } from "@/components/ui/field-help"
import { updateEmailDigest } from "@/lib/actions/users"
import type { EmailDigest } from "@/app/generated/prisma/client"

const OPTIONS: { value: EmailDigest; label: string; hint: string }[] = [
  { value: "OFF", label: "Off", hint: "No email. The bell still works." },
  { value: "ASAP", label: "As soon as possible", hint: "On the next check, not instantly." },
  { value: "DAILY", label: "Daily", hint: "One message a day, if anything is pending." },
  { value: "WEEKLY", label: "Weekly", hint: "One message a week, if anything is pending." },
]

export function EmailPreferences({
  digest,
  email,
  mailConfigured,
  receivesNotifications,
}: {
  digest: EmailDigest
  email: string
  mailConfigured: boolean
  receivesNotifications: boolean
}) {
  const [value, setValue] = useState<EmailDigest>(digest)
  const [pending, startTransition] = useTransition()

  function change(next: string | null) {
    if (!next || next === value) return
    const previous = value
    setValue(next as EmailDigest)
    startTransition(async () => {
      const result = await updateEmailDigest(next)
      if (result?.error) {
        setValue(previous) // put the control back if the server refused
        toast.error(result.error)
      } else {
        toast.success("Email preference saved.")
      }
    })
  }

  const hint = OPTIONS.find((o) => o.value === value)?.hint

  return (
    <Card className="py-5">
      <CardHeader className="px-5">
        <CardTitle className="flex items-center gap-2">
          Email notifications
          <FieldHelp id="email.digest" />
          {!mailConfigured && <Badge variant="outline">Not configured</Badge>}
        </CardTitle>
        <CardDescription>
          Due maintenance and expiring warranties, sent to {email}.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-5">
        <div className="flex items-center gap-3">
          <Select value={value} onValueChange={change} disabled={pending}>
            <SelectTrigger className="w-64">
              {/* Base UI renders the raw value unless given a formatter, which
                  would show "WEEKLY" rather than "Weekly". */}
              <SelectValue>
                {(v: string) => OPTIONS.find((o) => o.value === v)?.label ?? v}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-sm text-muted-foreground">{hint}</span>
        </div>
        {!receivesNotifications && (
          <p className="mt-3 text-sm text-muted-foreground">
            An administrator has turned notifications off for your account, so nothing will be
            sent to you whatever you choose here.
          </p>
        )}
        {!mailConfigured && (
          <p className="mt-3 text-sm text-muted-foreground">
            No mail server is set up yet, so nothing will be sent whatever you choose here. An
            administrator can configure one under <strong>Mail server</strong> below.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
