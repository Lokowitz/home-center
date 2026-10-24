"use client"

import { useFormat } from "@/components/regional-provider"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { AlarmClockOff, Bell, Pause, Wrench, ShieldCheck, Pill, Syringe, ShieldPlus, Umbrella } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { CompleteDialog } from "@/components/maintenance/complete-dialog"
import { SkipItem, useReminderActions } from "@/components/maintenance/snooze-menu"
import { SNOOZE_OPTIONS } from "@/lib/maintenance-due"
import type { NotificationReminder } from "@/lib/notification-reminders"
import { dismissNotification, markAllNotificationsRead, markNotificationRead } from "@/lib/actions/notifications"
import { cn } from "@/lib/utils"

type NotificationItem = {
  id: string
  type: string
  title: string
  message: string
  isRead: boolean
  createdAt: Date
  href: string
  /** Set on a maintenance notification whose reminder can be completed or snoozed from here. */
  reminder?: NotificationReminder
}

const typeIcon: Record<string, React.ElementType> = {
  MAINTENANCE_DUE: Wrench,
  WARRANTY_EXPIRING: ShieldCheck,
  MEDICATION_REFILL: Pill,
  IMMUNIZATION_DUE: Syringe,
  INSURANCE_EXPIRING: ShieldPlus,
  POLICY_RENEWAL: Umbrella,
  CUSTOM: Bell,
}

export function NotificationBell({ notifications }: { notifications: NotificationItem[] }) {
  const fmt = useFormat()
  const router = useRouter()
  const [items, setItems] = useState(notifications)
  const [open, setOpen] = useState(false)
  const [, startTransition] = useTransition()
  // Rendered outside the menu: the menu closes before the dialog opens.
  const [completing, setCompleting] = useState<NotificationReminder | null>(null)

  // A server refresh brings a new list; take it over the optimistic one.
  const [source, setSource] = useState(notifications)
  if (source !== notifications) {
    setSource(notifications)
    setItems(notifications)
  }

  const unreadCount = items.filter((n) => !n.isRead).length

  function markRead(id: string) {
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)))
    startTransition(async () => {
      await markNotificationRead(id)
      router.refresh()
    })
  }

  function dismiss(id: string) {
    setItems((prev) => prev.filter((n) => n.id !== id))
    startTransition(async () => {
      await dismissNotification(id)
      router.refresh()
    })
  }

  function dismissAll() {
    setItems((prev) => prev.map((n) => ({ ...n, isRead: true })))
    startTransition(async () => {
      await markAllNotificationsRead()
      router.refresh()
    })
  }

  // Completing or snoozing dismisses the notification on the server too.
  function handled(id: string) {
    setItems((prev) => prev.filter((n) => n.id !== id))
  }

  function openItem(n: NotificationItem) {
    setOpen(false)
    if (!n.isRead) markRead(n.id)
  }

  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger
          className="group relative inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-all duration-150 hover:bg-muted hover:text-foreground"
          aria-label={`${unreadCount} unread notifications`}
        >
          <Bell className="h-4 w-4 transition-transform duration-150 group-hover:scale-110" />
          {unreadCount > 0 && (
            <Badge
              variant="destructive"
              className="absolute -top-0.5 -right-0.5 h-4 min-w-4 px-1 text-[10px] font-semibold leading-none flex items-center justify-center ring-2 ring-card"
            >
              {unreadCount > 99 ? "99+" : unreadCount}
            </Badge>
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-80 max-w-[calc(100vw-2rem)] p-0">
          <div className="flex items-center justify-between px-3 py-2">
            <span className="text-sm font-semibold">Notifications</span>
            {unreadCount > 0 && (
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={dismissAll}>
                Mark all read
              </Button>
            )}
          </div>
          <DropdownMenuSeparator className="m-0" />
          <div className="max-h-96 overflow-y-auto p-1">
            {items.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">
                <Bell className="h-6 w-6 mx-auto mb-2 opacity-40" />
                No notifications yet
              </div>
            ) : (
              items.slice(0, 20).map((n) => {
                const Icon = typeIcon[n.type] ?? Bell
                return (
                  <div
                    key={n.id}
                    className={cn("flex items-start gap-2.5 rounded-md p-2.5 text-sm hover:bg-muted/60", !n.isRead && "bg-primary/5")}
                  >
                    <Icon className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
                    <div className="flex-1 min-w-0">
                      <Link href={n.href} onClick={() => openItem(n)} className="block">
                        <p className={cn("font-medium leading-snug", !n.isRead && "text-foreground")}>{n.title}</p>
                        <p className="text-muted-foreground text-xs mt-0.5 leading-snug">{n.message}</p>
                        <p className="text-muted-foreground/70 text-[11px] mt-1">{fmt.dateTime(n.createdAt)}</p>
                      </Link>
                    </div>
                    {/* A due reminder is completed or snoozed instead of dismissed. */}
                    {n.reminder ? (
                      <BellReminderActions
                        reminder={n.reminder}
                        onComplete={() => { setOpen(false); setCompleting(n.reminder!) }}
                        onHandled={() => handled(n.id)}
                      />
                    ) : !n.isRead && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-1.5 text-[11px] shrink-0"
                        onClick={() => dismiss(n.id)}
                      >
                        Dismiss
                      </Button>
                    )}
                  </div>
                )
              })
            )}
          </div>
          <DropdownMenuSeparator className="m-0" />
          <Link
            href="/notifications"
            onClick={() => setOpen(false)}
            className="block px-3 py-2 text-center text-xs font-medium text-primary hover:underline"
          >
            View all
          </Link>
        </DropdownMenuContent>
      </DropdownMenu>
      {completing && (
        <CompleteDialog
          schedule={completing.schedule}
          currentMileage={completing.currentMileage}
          meterUnit={completing.meterUnit}
          onClose={() => setCompleting(null)}
        />
      )}
    </>
  )
}

function BellReminderActions({ reminder, onComplete, onHandled }: {
  reminder: NotificationReminder
  onComplete: () => void
  onHandled: () => void
}) {
  const { pending, snooze, pause, skip } = useReminderActions(reminder.schedule, onHandled)
  return (
    <div className="flex shrink-0 flex-col items-stretch gap-1">
      <Button variant="outline" size="sm" className="h-6 px-2 text-[11px]" onClick={onComplete}>
        Complete
      </Button>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger
          disabled={pending}
          className="h-6 rounded-md border px-2 text-[11px] font-medium [&_svg]:size-3"
          aria-label={`Snooze "${reminder.schedule.title}"`}
        >
          <AlarmClockOff /> Snooze
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent side="left">
          {SNOOZE_OPTIONS.map((o) => (
            <DropdownMenuItem key={o.value} onClick={() => snooze(o.value, o.label)}>
              {o.label}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <SkipItem schedule={reminder.schedule} onSkip={skip} />
          <DropdownMenuItem onClick={pause}>
            <Pause className="mr-2 h-4 w-4" /> Pause
          </DropdownMenuItem>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    </div>
  )
}
