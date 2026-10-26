"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Fragment, useState } from "react"
import { cn } from "@/lib/utils"
import { isHealthPath } from "@/lib/features"
import { sidebarCookie } from "@/lib/sidebar-state"
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import {
  LayoutDashboard, Building2, Car, Refrigerator, Wrench, ShieldCheck,
  Calendar, Bell, Settings, Menu, PiggyBank, HeartPulse, Stethoscope, Umbrella, Sparkles,
  PanelLeftClose, PanelLeftOpen, Inbox,
} from "lucide-react"

type NavItem = { href: string; label: string; icon: React.ElementType; section?: string }

const navItems: NavItem[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  // Only when Intake is placed in the side menu (Settings → Appearance); otherwise it's in the header.
  { href: "/intake", label: "Intake", icon: Inbox },
  { href: "/chat", label: "Assistant", icon: Sparkles },
  { href: "/assets/properties", label: "Properties", icon: Building2, section: "Home" },
  { href: "/assets/vehicles", label: "Vehicles", icon: Car },
  { href: "/assets/equipment", label: "Equipment", icon: Refrigerator },
  { href: "/insurance", label: "Insurance", icon: Umbrella },
  { href: "/assets/people", label: "People", icon: HeartPulse, section: "Health" },
  { href: "/providers", label: "Providers", icon: Stethoscope },
  { href: "/records", label: "Records", icon: Wrench, section: "Activity" },
  { href: "/costs", label: "Costs", icon: PiggyBank },
  { href: "/warranties", label: "Warranties", icon: ShieldCheck },
  { href: "/maintenance", label: "Maintenance", icon: Calendar },
  { href: "/notifications", label: "Notifications", icon: Bell },
]

const bottomItems = [{ href: "/settings", label: "Settings", icon: Settings }]

/**
 * The name beside an icon in the collapsed sidebar: shown at once on hover or
 * keyboard focus (no delay, no animation), styled as the theme's popover.
 */
function NavTooltip({ label, children }: { label: string; children: React.ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger delay={0} closeDelay={0} render={children} />
      <TooltipContent
        side="right"
        sideOffset={10}
        className="animate-none! border border-border bg-popover px-2.5 py-1.5 text-sm font-medium text-popover-foreground shadow-md"
      >
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

const countText = (n: number) => (n > 99 ? "99+" : String(n))

type LinkProps = { href: string; label: string; icon: React.ElementType; badge?: number; onClick?: () => void; collapsed?: boolean }

function NavLink({ href, label, icon: Icon, badge, onClick, collapsed = false }: LinkProps) {
  const pathname = usePathname()
  const active = pathname === href || (href !== "/" && pathname.startsWith(href))
  const link = (
    <Link
      href={href}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        // nowrap: labels mustn't wrap while the width animates.
        "relative flex items-center whitespace-nowrap rounded-lg py-2.5 text-sm font-medium transition-colors duration-150",
        collapsed ? "justify-center px-0" : "gap-3 px-3",
        active
          ? "bg-sidebar-primary/10 text-sidebar-primary"
          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-sidebar-primary transition-opacity duration-150",
          active ? "opacity-100" : "opacity-0"
        )}
      />
      <span className="relative">
        <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={1.5} />
        {/* Collapsed, the count rides on the icon's corner. */}
        {collapsed && badge ? (
          <span
            aria-hidden="true"
            className="absolute -right-2.5 -top-2 inline-flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-4 text-primary-foreground tabular-nums ring-2 ring-card"
          >
            {countText(badge)}
          </span>
        ) : null}
      </span>
      <span className={cn(collapsed && "sr-only")}>
        {label}
        {collapsed && badge ? `, ${countText(badge)} waiting` : ""}
      </span>
      {!collapsed && badge ? (
        <span className="ml-auto inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold leading-5 text-primary-foreground tabular-nums">
          {countText(badge)}
          <span className="sr-only"> waiting</span>
        </span>
      ) : null}
    </Link>
  )
  return collapsed ? <NavTooltip label={badge ? `${label} (${countText(badge)})` : label}>{link}</NavTooltip> : link
}

/** `intakeCount` is set only when Intake goes in the side menu rather than the header. */
type NavProps = { showAssistant: boolean; showHealth: boolean; intakeCount?: number }

function SidebarContent({
  onNavClick, showAssistant, showHealth, intakeCount, collapsed = false, onToggle,
}: NavProps & { onNavClick?: () => void; collapsed?: boolean; onToggle?: () => void }) {
  const ToggleIcon = collapsed ? PanelLeftOpen : PanelLeftClose
  const toggleLabel = collapsed ? "Expand sidebar" : "Collapse sidebar"
  const toggle = onToggle && (
    <button
      type="button"
      onClick={onToggle}
      aria-label={toggleLabel}
      aria-expanded={!collapsed}
      title={collapsed ? undefined : toggleLabel}
      className={cn(
        "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors duration-150 hover:bg-muted/60 hover:text-foreground",
        !collapsed && "ml-auto"
      )}
    >
      <ToggleIcon className="h-[18px] w-[18px]" strokeWidth={1.5} aria-hidden="true" />
    </button>
  )
  return (
    <div className={cn("flex h-full flex-col py-4", collapsed ? "px-2" : "px-3")}>
      {/* The toggle shares the logo's row (under it when collapsed), so it costs the nav no height. */}
      <div className={cn("mb-6 flex items-center gap-2", collapsed ? "flex-col" : "pl-3")}>
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground text-xs font-bold">HC</div>
        <span className={cn("font-heading font-semibold tracking-tight", collapsed && "sr-only")}>HomeCenter</span>
        {toggle && (collapsed ? <NavTooltip label={toggleLabel}>{toggle}</NavTooltip> : toggle)}
      </div>
      <nav aria-label="Main" className="flex flex-1 flex-col gap-1 overflow-y-auto overflow-x-hidden">
        {navItems
          .filter(
            (item) =>
              (showAssistant || item.href !== "/chat") &&
              (intakeCount !== undefined || item.href !== "/intake") &&
              (showHealth || !isHealthPath(item.href))
          )
          .map(({ section, ...item }) => (
          <Fragment key={item.href}>
            {section &&
              (collapsed ? (
                // A section name doesn't fit beside icons; a rule keeps the grouping.
                <hr aria-hidden="true" className="mx-2 my-2 border-border" />
              ) : (
                <p className="mt-3 px-3 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">{section}</p>
              ))}
            <NavLink {...item} badge={item.href === "/intake" ? intakeCount : undefined} onClick={onNavClick} collapsed={collapsed} />
          </Fragment>
        ))}
      </nav>
      <nav aria-label="Settings" className="mt-3 flex flex-col gap-1 border-t pt-3">
        {bottomItems.map((item) => <NavLink key={item.href} {...item} onClick={onNavClick} collapsed={collapsed} />)}
      </nav>
    </div>
  )
}

/** The desktop sidebar. `initialCollapsed` comes from the cookie, so the first render has the right width. */
export function Sidebar({ initialCollapsed = false, ...props }: NavProps & { initialCollapsed?: boolean }) {
  const [collapsed, setCollapsed] = useState(initialCollapsed)
  function toggle() {
    const next = !collapsed
    setCollapsed(next)
    document.cookie = sidebarCookie(next)
  }
  return (
    <aside
      data-collapsed={collapsed || undefined}
      className={cn(
        "hidden shrink-0 flex-col overflow-hidden border-r bg-card transition-[width] duration-200 ease-out motion-reduce:transition-none md:flex",
        collapsed ? "w-16" : "w-56"
      )}
    >
      <SidebarContent {...props} collapsed={collapsed} onToggle={toggle} />
    </aside>
  )
}

export function MobileSidebarTrigger(props: NavProps) {
  const [open, setOpen] = useState(false)
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger className="relative inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-muted transition-colors before:absolute before:top-1/2 before:left-1/2 before:size-10 before:-translate-1/2 md:hidden">
        <Menu className="h-4 w-4" />
        <span className="sr-only">Menu</span>
      </SheetTrigger>
      <SheetContent side="left" className="w-56 p-0">
        <SidebarContent {...props} onNavClick={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  )
}
