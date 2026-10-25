"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { Building2 } from "lucide-react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { PropertyFilterCue, usePrefersReducedMotion } from "@/components/property-filter-cue"
import { cn } from "@/lib/utils"
import { propertyFilterCookie } from "@/lib/property-filter"

const ALL = "__all__"

/** Top-bar dropdown that narrows the app to one property. The choice lives in a cookie the server reads. */
export function PropertyFilter({
  properties,
  selectedId,
}: {
  properties: { id: string; name: string }[]
  selectedId: string | null
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const reducedMotion = usePrefersReducedMotion()
  const selected = selectedId !== null

  function change(value: string | null) {
    document.cookie = propertyFilterCookie(!value || value === ALL ? null : value)
    startTransition(() => router.refresh())
  }

  return (
    <Select value={selectedId ?? ALL} onValueChange={change}>
      <SelectTrigger
        aria-label="Property filter"
        size="sm"
        className={cn("relative max-w-40 gap-1.5 max-sm:[&>svg:last-child]:hidden", selected && reducedMotion && "ring-1 ring-primary/40")}
      >
        <PropertyFilterCue active={selected} />
        <Building2 className="h-4 w-4 shrink-0 text-muted-foreground sm:hidden" aria-hidden="true" />
        <span className="hidden min-w-0 truncate sm:inline">
          <SelectValue>{(v: string) => (v === ALL ? "All properties" : (properties.find((p) => p.id === v)?.name ?? "All properties"))}</SelectValue>
        </span>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>All properties</SelectItem>
        {properties.map((p) => (
          <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
