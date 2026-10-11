"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Inbox } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

/** Intake in the header, beside the notifications bell, with the count of items waiting. */
export function IntakeHeaderLink({ count }: { count: number }) {
  const active = usePathname().startsWith("/intake")
  return (
    <Link
      href="/intake"
      aria-current={active ? "page" : undefined}
      aria-label={count ? `Intake, ${count} to review` : "Intake"}
      title="Intake"
      className={cn(
        "group relative inline-flex h-9 w-9 items-center justify-center rounded-lg transition-all duration-150 hover:bg-muted hover:text-foreground",
        active ? "bg-primary/10 text-primary" : "text-muted-foreground"
      )}
    >
      <Inbox className="h-4 w-4 transition-transform duration-150 group-hover:scale-110" aria-hidden="true" />
      {count > 0 && (
        <Badge
          aria-hidden="true"
          className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center px-1 text-[10px] font-semibold leading-none tabular-nums ring-2 ring-card"
        >
          {count > 99 ? "99+" : count}
        </Badge>
      )}
    </Link>
  )
}
