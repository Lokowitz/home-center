"use client"

import { useCallback, useSyncExternalStore } from "react"
import { TIP_DISMISSED, isTipDismissed, tipStorageKey, type TipId } from "@/lib/tips"

// Dismissed in this tab even when storage is blocked (private mode, a
// sandboxed preview), so the close button always works.
const dismissedHere = new Set<TipId>()
const listeners = new Set<() => void>()

function subscribe(onChange: () => void) {
  listeners.add(onChange)
  // Another tab dismissing the same tip.
  window.addEventListener("storage", onChange)
  return () => {
    listeners.delete(onChange)
    window.removeEventListener("storage", onChange)
  }
}

function readDismissed(id: TipId): boolean {
  if (dismissedHere.has(id)) return true
  try {
    return isTipDismissed(window.localStorage.getItem(tipStorageKey(id)))
  } catch {
    return false
  }
}

/**
 * A one-time tip: `show` is false during SSR and hydration (storage is only
 * known on the client) and after `dismiss()`, which is remembered per browser.
 */
export function useTip(id: TipId): { show: boolean; dismiss: () => void } {
  const show = useSyncExternalStore(
    subscribe,
    () => !readDismissed(id),
    () => false
  )
  const dismiss = useCallback(() => {
    dismissedHere.add(id)
    try {
      window.localStorage.setItem(tipStorageKey(id), TIP_DISMISSED)
    } catch {
      // Storage blocked: dismissed for this tab only.
    }
    for (const l of listeners) l()
  }, [id])
  return { show, dismiss }
}
