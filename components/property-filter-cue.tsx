"use client"

import { useEffect, useState, useSyncExternalStore } from "react"
import { CUE_DURATION_MS, CUE_INTERVAL_MS, cueActive } from "@/lib/property-filter-cue"

const QUERY = "(prefers-reduced-motion: reduce)"

function subscribeMotion(onChange: () => void) {
  const mq = window.matchMedia(QUERY)
  mq.addEventListener("change", onChange)
  return () => mq.removeEventListener("change", onChange)
}

/** True when the OS asks for reduced motion. The server snapshot is false, so hydration matches. */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribeMotion, () => window.matchMedia(QUERY).matches, () => false)
}

/** A thin accent line that runs once around the trigger every 20 seconds while `active`. Nothing moves. */
export function PropertyFilterCue({ active }: { active: boolean }) {
  const reducedMotion = usePrefersReducedMotion()
  const [tracing, setTracing] = useState(false)
  const running = cueActive({ selected: active, hidden: false, reducedMotion })

  useEffect(() => {
    if (!running) return
    let id: ReturnType<typeof setInterval> | undefined
    const stop = () => {
      if (id !== undefined) clearInterval(id)
      id = undefined
    }
    // Always a fresh full interval: no catch-up after the tab was hidden.
    const start = () => {
      stop()
      id = setInterval(() => setTracing(true), CUE_INTERVAL_MS)
    }
    const onVisibility = () => {
      if (cueActive({ selected: true, hidden: document.hidden, reducedMotion: false })) start()
      else stop()
    }
    if (!document.hidden) start()
    document.addEventListener("visibilitychange", onVisibility)
    return () => {
      stop()
      document.removeEventListener("visibilitychange", onVisibility)
      setTracing(false)
    }
  }, [running])

  // Fallback in case animationend never fires (tab throttled, style stripped).
  useEffect(() => {
    if (!tracing) return
    const t = setTimeout(() => setTracing(false), CUE_DURATION_MS + 200)
    return () => clearTimeout(t)
  }, [tracing])

  if (!running || !tracing) return null

  return (
    <svg className="pointer-events-none absolute inset-0 size-full overflow-visible" aria-hidden>
      <rect
        x="0"
        y="0"
        width="100%"
        height="100%"
        rx={10}
        // The trigger's radius follows the theme (min(var(--radius-md), 10px) for size sm); CSS rx overrides the attribute.
        style={{ rx: "min(var(--radius-md), 10px)" }}
        pathLength={100}
        fill="none"
        stroke="var(--primary)"
        strokeWidth={1.5}
        strokeDasharray="14 86"
        className="property-cue"
        onAnimationEnd={() => setTracing(false)}
      />
    </svg>
  )
}
