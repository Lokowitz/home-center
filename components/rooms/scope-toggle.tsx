"use client"

import { cn } from "@/lib/utils"
import type { HistoryScope } from "@/lib/rooms"

/** Segmented "own only / with equipment" switch shared by the room History tab and the property Service tab. */
export function ScopeToggle({ scope, onChange, ownLabel, withLabel, label = "Whose records" }: {
  scope: HistoryScope
  onChange: (scope: HistoryScope) => void
  ownLabel: string
  withLabel: string
  label?: string
}) {
  const options: { value: HistoryScope; label: string }[] = [
    { value: "own", label: ownLabel },
    { value: "withEquipment", label: withLabel },
  ]
  return (
    <div className="inline-flex rounded-md border p-0.5" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={scope === o.value} onClick={() => onChange(o.value)}
          className={cn("rounded px-2.5 py-1 text-xs font-medium transition-colors", scope === o.value ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground")}>
          {o.label}
        </button>
      ))}
    </div>
  )
}
