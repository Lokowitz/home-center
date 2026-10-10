"use client"

import { useId, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { AddSplitButton } from "@/components/inbox/add-split-button"
import { AssetSelect, type InboxAssetOption } from "@/components/inbox/asset-select"
import { assetHref } from "@/lib/assets"
import { parseAssetKey } from "@/lib/inbox-form"

/**
 * The Records page's "Add record ▾". A record belongs to one asset and its form
 * needs that asset's details (meter unit, reminders, providers), so the main
 * part asks which asset, then opens the usual form on that asset's page.
 */
export function RecordsAddButton({ assets }: { assets: InboxAssetOption[] }) {
  const router = useRouter()
  const id = useId()
  const [open, setOpen] = useState(false)
  const [key, setKey] = useState("")
  const asset = parseAssetKey(key)

  function go() {
    if (!asset) return
    const tab = asset.assetType === "PERSON" ? "visits" : "service"
    router.push(`${assetHref(asset.assetType, asset.assetId)}?tab=${tab}&open=new`)
  }

  return (
    <>
      <AddSplitButton label="Add record" onAdd={() => setOpen(true)} />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add a record</DialogTitle>
            <DialogDescription>Which asset is it for? The form opens on its page.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor={id}>For</Label>
            <AssetSelect id={id} assets={assets} value={key} onChange={setKey} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="button" disabled={!asset} onClick={go}>Continue</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
