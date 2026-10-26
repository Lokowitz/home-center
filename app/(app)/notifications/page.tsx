import { getFormat } from "@/lib/regional-server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { redirect } from "next/navigation"
import Link from "next/link"
import { dismissNotification, markAllNotificationsRead, restoreNotification } from "@/lib/actions/notifications"
import { resolveNotificationHrefs } from "@/lib/notification-links"
import { loadNotificationReminders } from "@/lib/notification-reminders"
import { NotificationRowLink } from "@/components/notification-row-link"
import { ReminderActions } from "@/components/maintenance/reminder-actions"
import { loadFeatures, visibleNotificationsWhere } from "@/lib/features-server"
import { loadHiddenEntityIds, loadPropertyScope } from "@/lib/property-filter-server"
import { notificationScopeWhere } from "@/lib/property-filter"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { Bell, Eye, EyeOff, Wrench, ShieldCheck, Pill, Syringe, ShieldPlus, Umbrella } from "lucide-react"
import { cn } from "@/lib/utils"

const typeIcon: Record<string, React.ElementType> = {
  MAINTENANCE_DUE: Wrench,
  WARRANTY_EXPIRING: ShieldCheck,
  MEDICATION_REFILL: Pill,
  IMMUNIZATION_DUE: Syringe,
  INSURANCE_EXPIRING: ShieldPlus,
  POLICY_RENEWAL: Umbrella,
  CUSTOM: Bell,
}

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ hidden?: string }>
}) {
  const fmt = await getFormat()
  const session = await auth()
  if (!session) redirect("/login")
  const showHidden = (await searchParams).hidden === "1"
  const scope = await loadPropertyScope()
  // Two ORs can't share one object, so each goes in its own AND slot.
  const visible = {
    AND: [await visibleNotificationsWhere(await loadFeatures()), notificationScopeWhere(await loadHiddenEntityIds(scope))],
  }

  const [notifications, hiddenCount] = await Promise.all([
    prisma.notification.findMany({
      where: { userId: session.user.id, ...visible, ...(showHidden ? {} : { dismissedAt: null }) },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.notification.count({ where: { userId: session.user.id, ...visible, dismissedAt: { not: null } } }),
  ])

  const unread = notifications.filter((n) => !n.isRead).length
  const [hrefs, reminders] = await Promise.all([resolveNotificationHrefs(notifications), loadNotificationReminders(notifications)])

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold">Notifications</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {unread > 0 ? `${unread} unread` : "All caught up"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {(hiddenCount > 0 || showHidden) && (
            <Link
              href={showHidden ? "/notifications" : "/notifications?hidden=1"}
              className={buttonVariants({ variant: "ghost", size: "sm" })}
            >
              {showHidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              {showHidden ? "Hide dismissed" : `Show hidden (${hiddenCount})`}
            </Link>
          )}
          {unread > 0 && (
            <form action={markAllNotificationsRead}>
              <Button variant="outline" size="sm" type="submit">Mark all read</Button>
            </form>
          )}
        </div>
      </div>

      {notifications.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center text-muted-foreground">
          <Bell className="h-8 w-8 mx-auto mb-2 opacity-40" />
          <p className="font-medium">{hiddenCount > 0 ? "Nothing new — dismissed notifications are hidden" : "No notifications yet"}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {notifications.map((n) => {
            const Icon = typeIcon[n.type] ?? Bell
            const dismissed = n.dismissedAt !== null
            const reminder = reminders.get(n.id)
            return (
              <div
                key={n.id}
                className={cn(
                  "flex items-start gap-3 rounded-lg border p-4 transition-colors",
                  !n.isRead && "bg-primary/5 border-primary/20",
                  dismissed && "border-dashed opacity-60"
                )}
              >
                <Icon className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
                <div className="flex-1 min-w-0">
                  <NotificationRowLink id={n.id} href={hrefs.get(n.id) ?? "#"} isRead={n.isRead}>
                    <div className="flex items-center gap-2">
                      <p className={cn("text-sm font-medium", !n.isRead && "text-foreground")}>{n.title}</p>
                      {!n.isRead && <Badge variant="secondary" className="h-4 px-1.5 text-xs">New</Badge>}
                      {dismissed && <Badge variant="outline" className="h-4 px-1.5 text-xs">Dismissed</Badge>}
                    </div>
                    <p className="text-sm text-muted-foreground mt-0.5">{n.message}</p>
                    <p className="text-xs text-muted-foreground mt-1">{fmt.dateTime(n.createdAt)}</p>
                  </NotificationRowLink>
                </div>
                {/* A due reminder is dealt with by completing or snoozing it, which
                    also clears the notification. Dismissing would only hide it. */}
                {reminder ? (
                  <div className="flex shrink-0 flex-col items-end gap-1.5 sm:flex-row sm:items-center">
                    <ReminderActions {...reminder} />
                  </div>
                ) : (
                  <form action={(dismissed ? restoreNotification : dismissNotification).bind(null, n.id)}>
                    <Button variant="ghost" size="sm" className="h-7 text-xs shrink-0" type="submit">
                      {dismissed ? "Restore" : "Dismiss"}
                    </Button>
                  </form>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
