"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { FieldHelp } from "@/components/ui/field-help"
import { setReceivesNotifications } from "@/lib/actions/users"

export type Recipient = { id: string; name: string; email: string; role: string; receivesNotifications: boolean }

// Admin-only: which accounts get the bell and digest emails. Turning someone
// off stops new notifications; anything already in their list stays there.
export function NotificationRecipients({ users, currentUserId }: { users: Recipient[]; currentUserId: string }) {
  const [on, setOn] = useState(() => Object.fromEntries(users.map((u) => [u.id, u.receivesNotifications])))
  const [pending, start] = useTransition()
  const count = Object.values(on).filter(Boolean).length

  function toggle(user: Recipient, next: boolean) {
    setOn((prev) => ({ ...prev, [user.id]: next }))
    start(async () => {
      const r = await setReceivesNotifications(user.id, next)
      if (r?.error) {
        setOn((prev) => ({ ...prev, [user.id]: !next })) // put the box back if the server refused
        toast.error(r.error)
        return
      }
      toast.success(next ? `${user.name} will get notifications.` : `${user.name} won't get notifications.`)
    })
  }

  return (
    <Card className="py-5">
      <CardHeader className="px-5">
        <CardTitle className="flex items-center gap-2">
          Who gets notifications
          <FieldHelp id="recipients.receives" />
          <Badge variant="outline">{count} of {users.length}</Badge>
        </CardTitle>
        <CardDescription>
          Checked accounts get reminders in the bell and, if they&apos;ve chosen to, by email. Unchecked
          accounts get neither.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-5">
        <ul className="divide-y rounded-lg border">
          {users.map((u) => (
            <li key={u.id}>
              <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-primary"
                  checked={on[u.id]}
                  disabled={pending}
                  onChange={(e) => toggle(u, e.target.checked)}
                />
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{u.name}</span>
                  {u.id === currentUserId && <span className="text-muted-foreground"> (you)</span>}
                  <span className="block truncate text-muted-foreground">{u.email}</span>
                </span>
                {u.role === "ADMIN" && <Badge variant="secondary">Admin</Badge>}
              </label>
            </li>
          ))}
        </ul>
        {count === 0 && (
          <p className="mt-3 text-sm text-muted-foreground">
            Nobody is checked, so reminders won&apos;t reach anyone.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
