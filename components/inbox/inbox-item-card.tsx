"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { AlertTriangle, FileText, FolderInput, Link2, Loader2, RotateCw, Trash2 } from "lucide-react"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { FileInboxDialog } from "@/components/inbox/file-inbox-dialog"
import { KeepDocumentDialog } from "@/components/inbox/keep-document-dialog"
import { AttachRecordDialog, loadAttachChoices, type AttachChoices } from "@/components/inbox/attach-record-dialog"
import type { InboxAssetOption, InboxReminderOption } from "@/components/inbox/asset-select"
import { discardInboxItem, reparseInboxItem } from "@/lib/actions/inbox"
import { assetIcon, assetLabel } from "@/lib/assets"
import { formatMoney } from "@/lib/costs"
import { formatDay } from "@/lib/health"
import { assetKey, fileFormDefaults, isPreviewableImage, localDay, readByLabel, type FileFormValues } from "@/lib/inbox-form"
// Type only: inbox-server reaches Prisma.
import type { InboxListItem } from "@/lib/inbox-server"

type OpenDialog = { kind: "file"; defaults: FileFormValues } | { kind: "keep" } | { kind: "attach"; initial: AttachChoices } | null

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function StatusBadge({ item }: { item: InboxListItem }) {
  if (!item.attachments.length) {
    return <Badge variant="outline"><Loader2 className="animate-spin" />Uploading…</Badge>
  }
  if (item.status === "PENDING") {
    return <Badge variant="secondary"><Loader2 className="animate-spin" />Reading…</Badge>
  }
  if (item.status === "FAILED") {
    return <Badge variant="destructive"><AlertTriangle />Couldn&apos;t read</Badge>
  }
  return <Badge variant="secondary">Ready</Badge>
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate text-sm font-medium">{children}</dd>
    </div>
  )
}

export function InboxItemCard({
  item,
  assets,
  reminders,
}: {
  item: InboxListItem
  assets: InboxAssetOption[]
  reminders: InboxReminderOption[]
}) {
  const router = useRouter()
  const [dialog, setDialog] = useState<OpenDialog>(null)
  const [pending, start] = useTransition()

  const first = item.attachments[0]
  const fileName = first ? (item.attachments.length > 1 ? `${first.originalName} +${item.attachments.length - 1}` : first.originalName) : "Uploading…"
  const thumb = item.attachments.find((a) => isPreviewableImage(a.mimeType))
  const uploading = item.attachments.length === 0
  const readBy = readByLabel(item.parseMethod)
  const SuggestedIcon = item.suggestedAsset ? assetIcon[item.suggestedAsset.type] : null
  const nothingRead = item.status === "READY" && !item.parsedDate && item.parsedTotal == null && !item.parsedVendor
  const parsed = { date: item.parsedDate ? new Date(item.parsedDate) : null, total: item.parsedTotal }

  function openFile() {
    setDialog({ kind: "file", defaults: fileFormDefaults(item, localDay(new Date())) })
  }

  function openAttach() {
    // Load the suggested asset's records first, so the dialog opens with the best match already chosen.
    start(async () => {
      const key = item.suggestedAsset ? assetKey(item.suggestedAsset.type, item.suggestedAsset.id) : ""
      setDialog({ kind: "attach", initial: await loadAttachChoices(key, parsed) })
    })
  }

  function reread() {
    start(async () => {
      const r = await reparseInboxItem(item.id)
      if ("error" in r) {
        toast.error(r.error)
        return
      }
      toast.success(r.status === "PENDING" ? "Still reading the file; it'll update shortly." : "Read again.")
      router.refresh()
    })
  }

  function discard() {
    if (!confirm(`Discard "${fileName}"? The file is deleted.`)) return
    start(async () => {
      const r = await discardInboxItem(item.id)
      if ("error" in r) {
        toast.error(r.error)
        return
      }
      toast.success("Discarded.")
      router.refresh()
    })
  }

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="flex gap-4 p-4">
        <a
          href={first?.href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={first ? `Open ${first.originalName}` : undefined}
          className="flex h-20 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted/40"
        >
          {thumb ? (
            // eslint-disable-next-line @next/next/no-img-element -- served from a private, auth-gated route
            <img src={thumb.href} alt="" loading="lazy" className="h-full w-full object-cover" />
          ) : (
            <FileText className="h-6 w-6 text-muted-foreground" strokeWidth={1.5} />
          )}
        </a>

        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <ul className="space-y-0.5">
                {item.attachments.map((a) => (
                  <li key={a.id} className="flex min-w-0 items-baseline gap-2 text-sm">
                    <a href={a.href} target="_blank" rel="noopener noreferrer" className="truncate font-medium hover:underline">
                      {a.originalName}
                    </a>
                    <span className="shrink-0 text-xs text-muted-foreground">{formatBytes(a.sizeBytes)}</span>
                  </li>
                ))}
                {uploading && <li className="text-sm text-muted-foreground">Waiting for the upload…</li>}
              </ul>
              <p className="text-xs text-muted-foreground">
                Added by {item.createdBy} · <time dateTime={new Date(item.createdAt).toISOString()} suppressHydrationWarning>{new Date(item.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</time>
              </p>
            </div>
            <StatusBadge item={item} />
          </div>

          {item.status === "FAILED" && (
            <p className="text-sm text-destructive">
              {item.error ?? "Couldn't read this file."} You can still file it by hand.
            </p>
          )}

          {item.status === "READY" && (
            <>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
                <Field label="Date">{item.parsedDate ? formatDay(item.parsedDate) : "—"}</Field>
                <Field label="Total">{item.parsedTotal != null ? formatMoney(item.parsedTotal) : "—"}</Field>
                <Field label="Vendor">{item.parsedVendor ?? "—"}</Field>
                <Field label="For">
                  {item.suggestedAsset && SuggestedIcon ? (
                    <span className="inline-flex items-center gap-1" title={assetLabel[item.suggestedAsset.type]}>
                      <SuggestedIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={1.5} />
                      <span className="truncate">{item.suggestedAsset.name}</span>
                    </span>
                  ) : "—"}
                </Field>
              </dl>
              <p className="text-xs text-muted-foreground">
                {readBy
                  ? nothingRead ? `Read by: ${readBy}. Nothing recognised; fill it in by hand.` : `Read by: ${readBy}. Check before filing.`
                  : "Receipt reading is off."}
              </p>
            </>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t bg-muted/20 px-4 py-2.5">
        <Button type="button" size="sm" disabled={uploading || pending} onClick={openFile}>
          File it
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={uploading || pending} onClick={() => setDialog({ kind: "keep" })}>
          <FolderInput />
          Keep as document
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={uploading || pending} onClick={openAttach}>
          <Link2 />
          Attach to record
        </Button>
        <div className="ml-auto flex items-center gap-1">
          <Button type="button" size="sm" variant="ghost" disabled={uploading || pending} onClick={reread} title="Read the file again, e.g. after changing Receipt reading in Settings">
            {pending ? <Loader2 className="animate-spin" /> : <RotateCw />}
            Re-read
          </Button>
          <Button type="button" size="sm" variant="ghost" className="text-destructive hover:text-destructive" disabled={pending} onClick={discard}>
            <Trash2 />
            Discard
          </Button>
        </div>
      </div>

      {dialog?.kind === "file" && (
        <FileInboxDialog
          itemId={item.id}
          fileName={fileName}
          defaults={dialog.defaults}
          assets={assets}
          reminders={reminders}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "keep" && (
        <KeepDocumentDialog
          itemId={item.id}
          fileName={fileName}
          initialAssetKey={item.suggestedAsset ? assetKey(item.suggestedAsset.type, item.suggestedAsset.id) : ""}
          assets={assets}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "attach" && (
        <AttachRecordDialog
          itemId={item.id}
          fileName={fileName}
          parsed={parsed}
          initial={dialog.initial}
          assets={assets}
          onClose={() => setDialog(null)}
        />
      )}
    </Card>
  )
}
