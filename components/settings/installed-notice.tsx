"use client"

import { useSyncExternalStore } from "react"
import { CheckCircle2 } from "lucide-react"

// iOS exposes navigator.standalone; other browsers use the display-mode query.
function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

const subscribe = () => () => {}

export function InstalledNotice() {
  const installed = useSyncExternalStore(subscribe, isStandalone, () => false)
  if (!installed) return null
  return (
    <p className="flex items-center gap-2 rounded-lg border bg-accent px-4 py-3 text-sm text-accent-foreground">
      <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
      You&apos;re already using HomeCenter as an installed app.
    </p>
  )
}
