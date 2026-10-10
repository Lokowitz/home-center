import { Suspense } from "react"
import { Coffee } from "lucide-react"
import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { Sidebar, MobileSidebarTrigger } from "@/components/sidebar"
import { UserMenu } from "@/components/user-menu"
import { NotificationBell } from "@/components/notification-bell"
import { ThemeToggle } from "@/components/theme-toggle"
import { GlobalSearch } from "@/components/global-search"
import { resolveNotificationHrefs } from "@/lib/notification-links"
import { loadNotificationReminders } from "@/lib/notification-reminders"
import { loadLlmStatus } from "@/lib/llm/config"
import { ChatProvider } from "@/components/chat/chat-provider"
import { ChatDock, ChatToggle } from "@/components/chat/chat-panel"
import packageJson from "@/package.json"
import { loadFeatures, visibleNotificationsWhere } from "@/lib/features-server"

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session) redirect("/login")

  const features = await loadFeatures()
  const [notifications, llm] = await Promise.all([
    prisma.notification.findMany({
      where: { userId: session.user.id, dismissedAt: null, ...(await visibleNotificationsWhere(features)) },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    loadLlmStatus(),
  ])
  const [hrefs, reminders] = await Promise.all([resolveNotificationHrefs(notifications), loadNotificationReminders(notifications)])
  const notificationItems = notifications.map((n) => ({ ...n, href: hrefs.get(n.id) ?? "/notifications", reminder: reminders.get(n.id) }))
  const isAdmin = session.user.role === "ADMIN"
  // Admins see the entry points even when it's off, so they can find the setup —
  // unless it's been explicitly hidden.
  const showAssistant = !llm.hidden && (llm.available || isAdmin)

  return (
    <ChatProvider userId={session.user.id} available={llm.available} isAdmin={isAdmin} model={llm.model}>
      <div className="flex h-svh overflow-hidden">
        <Sidebar showAssistant={showAssistant} showHealth={features.health} />
        <div className="flex flex-1 flex-col overflow-hidden">
          <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border/60 bg-card/80 backdrop-blur-sm px-4">
            <MobileSidebarTrigger showAssistant={showAssistant} showHealth={features.health} />
            <div className="flex min-w-0 flex-1 justify-center">
              <Suspense fallback={null}>
                <GlobalSearch className="max-w-xl" />
              </Suspense>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <ThemeToggle />
              {showAssistant && <ChatToggle />}
              <NotificationBell notifications={notificationItems} />
              <UserMenu name={session.user.name ?? "User"} email={session.user.email ?? ""} />
            </div>
          </header>
          {/* The page and the docked assistant sit side by side; opening the assistant narrows the page. */}
          <div className="flex min-h-0 flex-1">
            <div className="flex min-w-0 flex-1 flex-col">
              <main className="flex-1 overflow-y-auto p-6">{children}</main>
              {/* Name and version centred; the empty first column balances the coffee link on the right. */}
              <footer className="grid shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-2 border-t border-border/60 px-4 py-2 text-xs text-muted-foreground">
                <span />
                <span>
                  <a
                    href="https://github.com/yatzin/home-center"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline-offset-2 hover:text-foreground hover:underline"
                  >
                    HomeCenter
                  </a>{" "}
                  &middot; v{packageJson.version}
                </span>
                <a
                  href="https://buymeacoffee.com/yatzin"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 justify-self-end whitespace-nowrap underline-offset-2 hover:text-foreground hover:underline"
                >
                  <Coffee className="h-3 w-3" aria-hidden="true" />
                  Buy me a coffee
                </a>
              </footer>
            </div>
            {showAssistant && <ChatDock />}
          </div>
        </div>
      </div>
    </ChatProvider>
  )
}
