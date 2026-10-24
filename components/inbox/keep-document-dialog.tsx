"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { AssetSelect, type InboxAssetOption } from "@/components/inbox/asset-select"
import { keepAsDocument } from "@/lib/actions/inbox"
import { parseAssetKey } from "@/lib/inbox-form"

/** "Keep as document": moves the files to an asset's Documents tab (a manual, a title, a warranty card). Mounted only while open. */
export function KeepDocumentDialog({
  itemId,
  fileName,
  initialAssetKey,
  assets,
  onClose,
}: {
  itemId: string
  fileName: string
  initialAssetKey: string
  assets: InboxAssetOption[]
  onClose: () => void
}) {
  const router = useRouter()
  const [key, setKey] = useState(initialAssetKey)
  const [pending, start] = useTransition()
  const asset = parseAssetKey(key)

  function submit() {
    if (!asset) return
    start(async () => {
      const r = await keepAsDocument(itemId, asset.assetType, asset.assetId)
      if ("error" in r) {
        toast.error(r.error)
        return
      }
      const name = assets.find((a) => a.type === asset.assetType && a.id === asset.assetId)?.name ?? "the asset"
      toast.success(`Kept on ${name}.`, { action: { label: "View", onClick: () => router.push(r.href) } })
      onClose()
      router.refresh()
    })
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Keep as document</DialogTitle>
          <DialogDescription>
            Moves <span className="font-medium text-foreground">{fileName}</span> to the asset&apos;s Documents, with no service record.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor={`keep-${itemId}`} help="inbox.keep-asset">For</Label>
          <AssetSelect id={`keep-${itemId}`} assets={assets} value={key} onChange={setKey} />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="button" disabled={!asset || pending} onClick={submit}>
            {pending ? "Moving…" : "Keep"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
