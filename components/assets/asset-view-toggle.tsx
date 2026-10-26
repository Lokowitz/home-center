"use client"

import { Grid2x2, Grid3x3, List } from "lucide-react"
import { cn } from "@/lib/utils"
import type { AssetView } from "@/lib/asset-view"

const OPTIONS: { value: AssetView; label: string; icon: React.ElementType }[] = [
  { value: "cards", label: "Large cards", icon: Grid2x2 },
  { value: "compact", label: "Small cards", icon: Grid3x3 },
  { value: "list", label: "List", icon: List },
]

export function AssetViewToggle({
  value,
  onChange,
}: {
  value: AssetView
  onChange: (view: AssetView) => void
}) {
  return (
    <div role="group" aria-label="View layout" className="inline-flex items-center rounded-lg border bg-card p-0.5">
      {OPTIONS.map((option) => {
        const Icon = option.icon
        const active = value === option.value
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={active}
            title={option.label}
            className={cn(
              "relative inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors max-sm:before:absolute max-sm:before:top-1/2 max-sm:before:left-1/2 max-sm:before:size-10 max-sm:before:-translate-1/2",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
              active
                ? "bg-sidebar-primary/10 text-sidebar-primary"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            <Icon className="h-4 w-4" strokeWidth={1.75} />
            <span className="sr-only">{option.label}</span>
          </button>
        )
      })}
    </div>
  )
}
