"use client"

import { Lightbulb, X } from "lucide-react"
import { useTip } from "@/components/tips/use-tip"

/** One-time hint in the dashboard's Intake card; gone for good once dismissed. */
export function IntakeTip() {
  const { show, dismiss } = useTip("drop-anywhere-dashboard")
  if (!show) return null
  return (
    <div className="flex items-start gap-2 rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
      <Lightbulb className="mt-px size-3.5 shrink-0" aria-hidden />
      <p className="flex-1">Tip: drag a file onto any page to add it to Intake.</p>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss tip"
        className="-m-1 rounded p-1 transition-colors hover:bg-muted hover:text-foreground"
      >
        <X className="size-3.5" />
      </button>
    </div>
  )
}
