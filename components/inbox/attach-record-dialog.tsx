"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Loader2 } from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { FieldHelp } from "@/components/ui/field-help"
import { AssetSelect, type InboxAssetOption } from "@/components/inbox/asset-select"
import { attachToRecord, listAttachCandidates } from "@/lib/actions/inbox"
import { bestAttachMatch, type AttachCandidate } from "@/lib/inbox"
import { parseAssetKey } from "@/lib/inbox-form"
import { useFormat } from "@/components/regional-provider"

export type AttachChoices = {
  assetKey: string
  candidates: AttachCandidate[]
  /** `${kind}:${id}` of the chosen record, or "". */
  selected: string
  error?: string
}

type Parsed = { date: Date | null; total: number | null }

const choiceKey = (c: Pick<AttachCandidate, "kind" | "id">) => `${c.kind}:${c.id}`

/** An asset's records, with the best match for the receipt preselected. Used when the dialog opens and when the asset changes. */
export async function loadAttachChoices(key: string, parsed: Parsed): Promise<AttachChoices> {
  const asset = parseAssetKey(key)
  if (!asset) return { assetKey: key, candidates: [], selected: "" }
  const r = await listAttachCandidates(asset.assetType, asset.assetId)
  if ("error" in r) return { assetKey: key, candidates: [], selected: "", error: r.error }
  // Dates come over the wire as Dates; guard anyway so a string can't break the ranking.
  const candidates = r.candidates.map((c) => ({ ...c, date: c.date ? new Date(c.date) : null }))
  const best = bestAttachMatch(candidates, parsed)
  const match = best ? candidates.find((c) => c.id === best) : undefined
  return { assetKey: key, candidates, selected: match ? choiceKey(match) : "" }
}

/** "Attach to record": puts the files on a service record or warranty that already exists. Mounted only while open. */
export function AttachRecordDialog({
  itemId,
  fileName,
  parsed,
  initial,
  assets,
  onClose,
}: {
  itemId: string
  fileName: string
  parsed: Parsed
  initial: AttachChoices
  assets: InboxAssetOption[]
  onClose: () => void
}) {
  const fmt = useFormat()
  const router = useRouter()
  const [choices, setChoices] = useState(initial)
  const [loading, startLoading] = useTransition()
  const [pending, start] = useTransition()
  const chosen = choices.candidates.find((c) => choiceKey(c) === choices.selected)

  function changeAsset(key: string) {
    setChoices({ assetKey: key, candidates: [], selected: "" })
    startLoading(async () => {
      const next = await loadAttachChoices(key, parsed)
      // A later pick wins over a slow earlier one.
      setChoices((current) => (current.assetKey === key ? next : current))
    })
  }

  function submit() {
    if (!chosen) return
    start(async () => {
      const r = await attachToRecord(itemId, chosen.kind, chosen.id)
      if ("error" in r) {
        toast.error(r.error)
        return
      }
      toast.success(`Attached to ${chosen.title}.`, { action: { label: "View", onClick: () => router.push(r.href) } })
      onClose()
      router.refresh()
    })
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Attach to record</DialogTitle>
          <DialogDescription>
            Adds <span className="font-medium text-foreground">{fileName}</span> to a service record or warranty you already entered. The record itself isn&apos;t changed.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor={`attach-${itemId}`} help="inbox.attach-asset">For</Label>
            <AssetSelect id={`attach-${itemId}`} assets={assets} value={choices.assetKey} onChange={changeAsset} />
          </div>
          {choices.assetKey && (
            <fieldset className="space-y-2">
              <legend className="mb-2 flex items-center gap-1.5 text-sm font-medium">Record<FieldHelp id="inbox.attach-record" /></legend>
              {loading ? (
                <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading records…</p>
              ) : choices.error ? (
                <p className="text-sm text-destructive">{choices.error}</p>
              ) : !choices.candidates.length ? (
                <p className="text-sm text-muted-foreground">No service records or warranties on this asset yet. Choose &ldquo;New service record&rdquo; on the card to create one.</p>
              ) : (
                <ul className="max-h-72 space-y-1 overflow-y-auto rounded-md border p-1">
                  {choices.candidates.map((c) => {
                    const key = choiceKey(c)
                    return (
                      <li key={key}>
                        <label className="flex cursor-pointer items-center gap-3 rounded-sm px-2 py-1.5 text-sm hover:bg-muted has-[:checked]:bg-muted">
                          <input
                            type="radio"
                            name={`attach-record-${itemId}`}
                            value={key}
                            checked={choices.selected === key}
                            onChange={() => setChoices((cur) => ({ ...cur, selected: key }))}
                            className="accent-primary"
                          />
                          <span className="w-24 shrink-0 text-muted-foreground">{c.date ? fmt.date(c.date, { utc: true }) : "No date"}</span>
                          <span className="min-w-0 flex-1 truncate font-medium">{c.title}</span>
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {c.kind === "WARRANTY" ? "Warranty" : c.cost != null ? fmt.money(c.cost) : "—"}
                          </span>
                        </label>
                      </li>
                    )
                  })}
                </ul>
              )}
            </fieldset>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="button" disabled={!chosen || loading || pending} onClick={submit}>
            {pending ? "Attaching…" : "Attach"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
