"use client"

import { useId, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { AddSplitButton } from "@/components/inbox/add-split-button"
import { AssetSelect, type InboxAssetOption } from "@/components/inbox/asset-select"
import { ServiceRecordFormDialog } from "@/components/service-records/service-record-form-dialog"
import { loadRecordFormContext, type RecordFormContext } from "@/lib/actions/service-records"
import { parseAssetKey } from "@/lib/inbox-form"
import type { AssetType } from "@/app/generated/prisma/client"

/**
 * The Records page's "Add record ▾". A record belongs to one asset and its form
 * needs that asset's details (meter unit, reminders, providers), so the main
 * part asks which asset, loads those details, then opens the usual form here.
 */
export function RecordsAddButton({ assets }: { assets: InboxAssetOption[] }) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [key, setKey] = useState("")
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState<{ assetType: AssetType; assetId: string; ctx: RecordFormContext } | null>(null)
  const asset = parseAssetKey(key)

  async function go() {
    if (!asset) return
    setLoading(true)
    try {
      const ctx = await loadRecordFormContext(asset.assetType, asset.assetId)
      if ("error" in ctx) { toast.error(ctx.error); return }
      setForm({ assetType: asset.assetType, assetId: asset.assetId, ctx })
      setOpen(false)
      setKey("")
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <AddSplitButton label="Add record" onAdd={() => setOpen(true)} />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add a record</DialogTitle>
            <DialogDescription>Which asset is it for?</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor={id} help="service.asset">For</Label>
            <AssetSelect id={id} assets={assets} value={key} onChange={setKey} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="button" disabled={!asset || loading} onClick={go}>Continue</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {form && (
        <ServiceRecordFormDialog
          open
          onClose={() => setForm(null)}
          assetId={form.assetId}
          assetType={form.assetType}
          {...form.ctx}
        />
      )}
    </>
  )
}
