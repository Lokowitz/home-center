"use client"

import { toast } from "sonner"
import { TIP_DISMISSED, isTipDismissed, tipStorageKey } from "@/lib/tips"
import { receiptTipDue } from "@/lib/intake-ui"

const KEY = tipStorageKey("manual-record-receipt")

function seen(): boolean {
  try {
    return isTipDismissed(window.localStorage.getItem(KEY))
  } catch {
    // Storage blocked: better never than every time.
    return true
  }
}

/**
 * After a new service record is saved by hand: if it went in without a file,
 * suggest dropping the receipt next time. Shown once per browser; it counts as
 * seen the moment it shows, so it never nags.
 */
export function maybeShowReceiptTip(hadFiles: boolean, { isNew = true }: { isNew?: boolean } = {}): void {
  if (!receiptTipDue({ isNew, hadFiles, seen: seen() })) return
  try {
    window.localStorage.setItem(KEY, TIP_DISMISSED)
  } catch {
    return
  }
  toast("Tip: drop the receipt next time and HomeCenter fills this in.", { duration: 8000 })
}
