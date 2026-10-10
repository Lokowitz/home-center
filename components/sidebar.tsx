"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Fragment, useState } from "react"
import { cn } from "@/lib/utils"
import { isHealthPath } from "@/lib/features"
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet"
import {
  LayoutDashboard, Building2, Car, Refrigerator, Wrench, ShieldCheck,
  Calendar, Bell, Settings, Menu, PiggyBank, HeartPulse, Stethoscope, ShieldPlus, Sparkles, Inbox,
} from "lucide-react"

type NavItem = { href: string; label: string; icon: React.ElementType; section?: string }

const navItems: NavItem[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/intake", label: "Intake", icon: Inbox },
  { href: "/chat", label: "Assistant", icon: Sparkles },
  { href: "/assets/properties", label: "Properties", icon: Building2, section: "Home" },
  { href: "/assets/vehicles", label: "Vehicles", icon: Car },
  { href: "/assets/equipment", label: "Equipment", icon: Refrigerator },
  { href: "/assets/people", label: "People", icon: HeartPulse, section: "Health" },
  { href: "/providers", label: "Providers", icon: Stethoscope },
  { href: "/insurance", label: "Insurance", icon: ShieldPlus },
  { href: "/records", label: "Records", icon: Wrench, section: "Activity" },
  { href: "/costs", label: "Costs", icon: PiggyBank },
  { href: "/warranties", label: "Warranties", icon: ShieldCheck },
  { href: "/maintenance", label: "Maintenance", icon: Calendar },
  { href: "/notifications", label: "Notifications", icon: Bell },
]

const bottomItems = [{ href: "/settings", label: "Settings", icon: Settings }]

function NavLink({ href, label, icon: Icon, badge, onClick }: { href: string; label: string; icon: React.ElementType; badge?: number; onClick?: () => void }) {
  const pathname = usePathname()
  const active = pathname === href || (href !== "/" && pathname.startsWith(href))
  return (
    <Link
      href={href}
      onClick={onClick}
      className={cn(
        "relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors duration-150",
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
      <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={1.5} />
      {label}
      {badge ? (
        <span className="ml-auto inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold leading-5 text-primary-foreground tabular-nums">
          {badge > 99 ? "99+" : badge}
          <span className="sr-only"> waiting</span>
        </span>
      ) : null}
    </Link>
  )
}

type NavProps = { showAssistant: boolean; showHealth: boolean; inboxCount?: number }

function SidebarContent({ onNavClick, showAssistant, showHealth, inboxCount = 0 }: NavProps & { onNavClick?: () => void }) {
  return (
    <div className="flex flex-col h-full px-3 py-4">
      <div className="mb-6 flex items-center gap-2 px-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground text-xs font-bold">HC</div>
        <span className="font-heading font-semibold tracking-tight">HomeCenter</span>
      </div>
      <nav className="flex flex-1 flex-col gap-1">
        {navItems
          .filter((item) => (showAssistant || item.href !== "/chat") && (showHealth || !isHealthPath(item.href)))
          .map(({ section, ...item }) => (
          <Fragment key={item.href}>
            {section && (
              <p className="mt-3 px-3 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">{section}</p>
            )}
            <NavLink {...item} badge={item.href === "/intake" ? inboxCount : undefined} onClick={onNavClick} />
          </Fragment>
        ))}
      </nav>
      <nav className="flex flex-col gap-1 border-t pt-3 mt-3">
        {bottomItems.map((item) => <NavLink key={item.href} {...item} onClick={onNavClick} />)}
      </nav>
    </div>
  )
}

export function Sidebar(props: NavProps) {
  return (
    <aside className="hidden md:flex w-56 shrink-0 flex-col border-r bg-card">
      <SidebarContent {...props} />
    </aside>
  )
}

export function MobileSidebarTrigger(props: NavProps) {
  const [open, setOpen] = useState(false)
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-muted transition-colors md:hidden">
        <Menu className="h-4 w-4" />
        <span className="sr-only">Menu</span>
      </SheetTrigger>
      <SheetContent side="left" className="w-56 p-0">
        <SidebarContent {...props} onNavClick={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  )
}

