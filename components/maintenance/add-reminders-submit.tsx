"use client"

import { BellPlus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { assetHref } from "@/lib/assets"
import type { AssetType } from "@/app/generated/prisma/client"

/** Where a new asset goes to pick its default reminders. */
export function remindersHref(assetType: AssetType, assetId: string) {
  return `${assetHref(assetType, assetId)}/reminders`
}

/**
 * Second save button on the "Add" dialogs. The dialog passes its own
 * handleSubmit, which saves, then sends the user on to pick default reminders.
 */
export function AddRemindersSubmit({ pending, onClick }: { pending: boolean; onClick: () => void }) {
  return (
    <Button type="button" variant="secondary" disabled={pending} onClick={onClick}>
      <BellPlus /> Save + add reminders
    </Button>
  )
}
