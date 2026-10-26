import { Suspense } from "react"
import { Coffee } from "lucide-react"
import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { cookies } from "next/headers"
import { SIDEBAR_COOKIE, readSidebarCollapsed } from "@/lib/sidebar-state"
import { PLACEMENTS, readPlacement } from "@/lib/placement"
import { prisma } from "@/lib/prisma"
import { Sidebar, MobileSidebarTrigger } from "@/components/sidebar"
import { UserMenu } from "@/components/user-menu"
import { NotificationBell } from "@/components/notification-bell"
import { ThemeNavigator } from "@/components/theme-navigator"
import { GlobalSearch } from "@/components/global-search"
import { resolveNotificationHrefs } from "@/lib/notification-links"
import { loadNotificationReminders } from "@/lib/notification-reminders"
import { loadLlmStatus } from "@/lib/llm/config"
import { assistantShown } from "@/lib/llm/settings-schema"
import { inboxCount } from "@/lib/inbox-server"
import { loadCaptureParser } from "@/lib/capture-server"
import { ChatProvider } from "@/components/chat/chat-provider"
import { ChatDock, ChatLauncher, ChatToggle } from "@/components/chat/chat-panel"
import { DropProvider } from "@/components/drop/drop-provider"
import { IntakeHeaderLink } from "@/components/inbox/intake-header-link"
import { cn } from "@/lib/utils"
import packageJson from "@/package.json"
import { loadFeatures, visibleNotificationsWhere } from "@/lib/features-server"
import { loadRegionalSettings } from "@/lib/regional-server"
import { RegionalProvider } from "@/components/regional-provider"
import { PropertyFilter } from "@/components/property-filter"
import { loadHiddenEntityIds, loadPropertyFilterChoices, loadPropertyScope } from "@/lib/property-filter-server"
import { notificationScopeWhere } from "@/lib/property-filter"

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session) redirect("/login")

  const [features, regional, scope, propertyChoices] = await Promise.all([
    loadFeatures(),
    loadRegionalSettings(),
    loadPropertyScope(),
    loadPropertyFilterChoices(null),
  ])
  const [notifications, llm, inbox, captureParser] = await Promise.all([
    prisma.notification.findMany({
      where: {
        userId: session.user.id,
        dismissedAt: null,
        AND: [await visibleNotificationsWhere(features), notificationScopeWhere(await loadHiddenEntityIds(scope))],
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    loadLlmStatus(),
    inboxCount(),
    loadCaptureParser(),
  ])
  const [hrefs, reminders] = await Promise.all([resolveNotificationHrefs(notifications), loadNotificationReminders(notifications)])
  const notificationItems = notifications.map((n) => ({ ...n, href: hrefs.get(n.id) ?? "/notifications", reminder: reminders.get(n.id) }))
  const isAdmin = session.user.role === "ADMIN"
  const jar = await cookies()
  const sidebarCollapsed = readSidebarCollapsed(jar.get(SIDEBAR_COOKIE)?.value)
  // Every entry point (nav, header, floating button) disappears while the assistant is off or hidden.
  // Admins find the setup in Settings.
  const showAssistant = assistantShown(llm)
  // Where this device put the assistant's button and Intake (Settings → Appearance).
  const floatingAssistant = showAssistant && readPlacement("assistant", jar.get(PLACEMENTS.assistant.cookie)?.value) === "floating"
  // Intake has no entry point while receipt reading is Off (Settings → Documents & search).
  const showIntake = captureParser !== "OFF"
  const intakeInSidebar = readPlacement("intake", jar.get(PLACEMENTS.intake.cookie)?.value) === "sidebar"
  // The sidebar shows Intake only when given its count.
  const sidebarIntake = showIntake && intakeInSidebar ? inbox : undefined

  return (
    <RegionalProvider value={regional}>
    <ChatProvider userId={session.user.id} available={llm.available} isAdmin={isAdmin} model={llm.model}>
      <DropProvider healthEnabled={features.health}>
      {/* h-screen first: a browser without svh units would otherwise let the shell grow
          to the page's height, pushing the sidebar's Settings link off screen. */}
      <div className="flex h-screen overflow-hidden supports-[height:100svh]:h-svh">
        <Sidebar showAssistant={showAssistant} showHealth={features.health} intakeCount={sidebarIntake} initialCollapsed={sidebarCollapsed} />
        <div className="flex flex-1 flex-col overflow-hidden">
          <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border/60 bg-card/80 backdrop-blur-sm px-4">
            <MobileSidebarTrigger showAssistant={showAssistant} showHealth={features.health} intakeCount={sidebarIntake} />
            {propertyChoices && (propertyChoices.length >= 2 || scope) && (
              <PropertyFilter properties={propertyChoices} selectedId={scope?.propertyId ?? null} />
            )}
            {/* On a phone search is an icon, so it sits with the other header buttons on the right. */}
            <div className="flex min-w-0 flex-1 justify-end lg:justify-center">
              <Suspense fallback={null}>
                <GlobalSearch className="max-w-xl" />
              </Suspense>
            </div>
            <div className="flex shrink-0 items-center gap-1 sm:gap-2">
              <ThemeNavigator />
              {showAssistant && !floatingAssistant && <ChatToggle />}
              {showIntake && !intakeInSidebar && <IntakeHeaderLink count={inbox} />}
              <NotificationBell notifications={notificationItems} />
              <UserMenu name={session.user.name ?? "User"} email={session.user.email ?? ""} />
            </div>
          </header>
          {/* The page and the docked assistant sit side by side; opening the assistant narrows the page. */}
          <div className="flex min-h-0 flex-1">
            <div className="flex min-w-0 flex-1 flex-col">
              {/* Extra bottom room so the floating assistant button never hides the end of a page. */}
              <main className={cn("flex-1 overflow-y-auto p-6", floatingAssistant && "pb-20")}>{children}</main>
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
            {floatingAssistant && <ChatLauncher />}
          </div>
        </div>
      </div>
      </DropProvider>
    </ChatProvider>
    </RegionalProvider>
  )
}
