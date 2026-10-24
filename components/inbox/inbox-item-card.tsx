"use client"

import { useId, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { AlertTriangle, ArrowRight, FileText, Loader2, MoreHorizontal, RotateCw, Sparkles, Trash2 } from "lucide-react"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { FieldHelp } from "@/components/ui/field-help"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { FileInboxDialog } from "@/components/inbox/file-inbox-dialog"
import { KeepDocumentDialog } from "@/components/inbox/keep-document-dialog"
import { AttachRecordDialog, loadAttachChoices, type AttachChoices } from "@/components/inbox/attach-record-dialog"
import type { InboxAssetOption, InboxReminderOption } from "@/components/inbox/asset-select"
import { discardInboxItem, reparseInboxItem } from "@/lib/actions/inbox"
import { assetIcon, assetLabel } from "@/lib/assets"
import {
  assetKey, defaultDestination, fileFormDefaults, inboxHeadline, inboxReadiness, isPreviewableImage, localDay, readByLabel, readerNote, readFields,
  type FieldRead, type FileFormValues, type InboxDestination, type InboxReadiness,
} from "@/lib/inbox-form"
import { cn } from "@/lib/utils"
// Type only: inbox-server reaches Prisma.
import type { InboxListItem } from "@/lib/inbox-server"
import { useFormat } from "@/components/regional-provider"

type OpenDialog = { kind: "file"; defaults: FileFormValues } | { kind: "keep" } | { kind: "attach"; initial: AttachChoices } | null

// No success/warning tokens in the theme; these follow the emerald/amber idiom
// used elsewhere (dashboard "due soon", search result tints), which the dark
// variant covers for every dark theme.
const AMBER_TEXT = "text-amber-700 dark:text-amber-400"

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function StatusChip({ readiness }: { readiness: InboxReadiness }) {
  switch (readiness) {
    case "reading":
      return <Badge variant="secondary"><Loader2 className="animate-spin" />Reading…</Badge>
    case "failed":
      return <Badge variant="destructive"><AlertTriangle />Couldn&apos;t read</Badge>
    case "ready":
      return (
        <Badge className="bg-emerald-500/10 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
          <span aria-hidden className="size-1.5 rounded-full bg-current" />
          Ready to file
        </Badge>
      )
    case "check":
      return (
        <Badge className="bg-amber-500/10 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
          <AlertTriangle />
          Needs a look
        </Badge>
      )
  }
}

/** One "What we read" row: the value, an amber "Not found", or the value flagged "unsure" with why. */
function ReadRow({ label, read, value, children }: { label: string; read: FieldRead; value: React.ReactNode; children?: React.ReactNode }) {
  return (
    <>
      <dt className="pt-px text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-sm">
        {read.state === "missing" ? (
          <span className={cn("inline-flex items-center gap-1 italic", AMBER_TEXT)}>
            <AlertTriangle aria-hidden className="size-3.5 shrink-0" />
            Not found
          </span>
        ) : (
          <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
            <span className="min-w-0 font-medium break-words">{value}</span>
            {read.state === "unsure" && (
              <span title={read.reason} className={cn("inline-flex cursor-help items-center gap-0.5 text-xs", AMBER_TEXT)}>
                <AlertTriangle aria-hidden className="size-3 shrink-0" />
                unsure
                <span className="sr-only">: {read.reason}</span>
              </span>
            )}
          </span>
        )}
        {children}
      </dd>
    </>
  )
}

const DESTINATIONS: { value: InboxDestination; label: string; hint: string }[] = [
  { value: "file", label: "New service record", hint: "Creates a record from these details" },
  { value: "attach", label: "Add to an existing record", hint: "Already logged it by hand?" },
  { value: "keep", label: "Keep as a document", hint: "Manuals, warranty cards, no cost" },
]

export function InboxItemCard({
  item,
  householdNames,
  assets,
  reminders,
}: {
  item: InboxListItem
  /** People in the household, so a "shop" that is really the customer reads as unsure. */
  householdNames: string[]
  assets: InboxAssetOption[]
  reminders: InboxReminderOption[]
}) {
  const fmt = useFormat()
  const router = useRouter()
  const radioName = useId()
  const [dialog, setDialog] = useState<OpenDialog>(null)
  // Null until the user picks, so the default can follow the item as it finishes reading.
  const [picked, setPicked] = useState<InboxDestination | null>(null)
  const [pending, start] = useTransition()

  const first = item.attachments[0]
  const fileName = first ? (item.attachments.length > 1 ? `${first.originalName} +${item.attachments.length - 1}` : first.originalName) : "Uploading…"
  const thumb = item.attachments.find((a) => isPreviewableImage(a.mimeType))
  const uploading = item.attachments.length === 0
  const readiness = inboxReadiness(item, householdNames)
  const fields = readFields(item, householdNames)
  const readBy = readByLabel(item.parseMethod)
  const fallback = readerNote(item.parseMethod, item.parseNote)
  const SuggestedIcon = item.suggestedAsset ? assetIcon[item.suggestedAsset.type] : null
  const nothingRead = item.status === "READY" && !item.parsedDate && item.parsedTotal == null && !item.parsedVendor
  const parsed = { date: item.parsedDate ? new Date(item.parsedDate) : null, total: item.parsedTotal }
  const destination = picked ?? defaultDestination(item)
  const headline = inboxHeadline(
    {
      total: item.parsedTotal != null ? fmt.money(item.parsedTotal) : null,
      // A doubtful vendor ("Job #1882…") would make the sentence read wrong; the row still shows it.
      vendor: fields.vendor.state === "found" ? item.parsedVendor : null,
      date: item.parsedDate ? fmt.date(item.parsedDate, { utc: true }) : null,
    },
    fileName
  )

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

  function proceed() {
    if (destination === "file") openFile()
    else if (destination === "attach") openAttach()
    else setDialog({ kind: "keep" })
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

  const added = new Date(item.createdAt)

  return (
    <Card className="gap-0 overflow-hidden py-0">
      {/* Header: what it is, how sure we are, and the rarely used actions. */}
      <div className="flex gap-3 p-4 sm:gap-4">
        <a
          href={first?.href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={first ? `Open ${first.originalName}` : undefined}
          title={first ? `Open ${first.originalName}` : undefined}
          className="flex h-20 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted/40 transition-colors hover:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none sm:h-24 sm:w-20"
        >
          {thumb ? (
            // eslint-disable-next-line @next/next/no-img-element -- served from a private, auth-gated route
            <img src={thumb.href} alt="" loading="lazy" className="h-full w-full object-cover" />
          ) : (
            <FileText className="h-7 w-7 text-muted-foreground" strokeWidth={1.5} />
          )}
        </a>

        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
              <h3 className="min-w-0 text-base leading-snug font-semibold break-words">{headline}</h3>
              <StatusChip readiness={readiness} />
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label={`More actions for ${fileName}`}
                disabled={pending}
                className="-mt-1 -mr-1 inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
              >
                {pending ? <Loader2 className="size-4 animate-spin" /> : <MoreHorizontal className="size-4" />}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem disabled={uploading} onClick={reread} title="Read the file again, e.g. after changing Receipt reading in Settings">
                  <RotateCw />
                  Re-read
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={discard}>
                  <Trash2 />
                  Discard
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <p className="mt-1 text-xs text-muted-foreground">
            {item.attachments.map((a, i) => (
              <span key={a.id}>
                {i > 0 && ", "}
                <a href={a.href} target="_blank" rel="noopener noreferrer" className="break-all hover:text-foreground hover:underline">
                  {a.originalName}
                </a>
                {" · "}
                {formatBytes(a.sizeBytes)}
              </span>
            ))}
            {uploading && "Waiting for the upload…"}
            {" · added by "}
            {item.createdBy},{" "}
            <time dateTime={added.toISOString()} suppressHydrationWarning>
              {`${fmt.dayMonth(added)} ${fmt.time(added)}`}
            </time>
          </p>
        </div>
      </div>

      <div className="grid border-t md:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
        {/* What we read */}
        <section aria-label="What we read" className="min-w-0 p-4">
          <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1">
            <h4 className="text-[0.7rem] font-semibold tracking-wider text-muted-foreground uppercase">What we read</h4>
            {item.status === "READY" && (
              <Badge variant="outline" className="text-muted-foreground">
                {item.parseMethod === "llm" && <Sparkles />}
                {readBy ? readBy.charAt(0).toUpperCase() + readBy.slice(1) : "Reading off"}
              </Badge>
            )}
            {item.status === "READY" && fallback && <span className="text-xs text-muted-foreground">{fallback}</span>}
          </div>

          {readiness === "reading" && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              {uploading ? "Waiting for the upload to finish…" : "Reading the file. This usually takes a few seconds."}
            </p>
          )}

          {readiness === "failed" && (
            <p className="text-sm text-destructive">
              {item.error ?? "Couldn't read this file."} You can still file it by hand.
            </p>
          )}

          {item.status === "READY" && (
            <>
              <dl className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-baseline gap-x-3 gap-y-2">
                <ReadRow label="Date" read={fields.date} value={item.parsedDate ? fmt.date(item.parsedDate, { utc: true }) : null} />
                <ReadRow label="Total" read={fields.total} value={item.parsedTotal != null ? fmt.money(item.parsedTotal) : null} />
                <ReadRow label="Shop" read={fields.vendor} value={item.parsedVendor} />
                <ReadRow
                  label="Asset"
                  read={fields.asset}
                  value={
                    item.suggestedAsset && SuggestedIcon ? (
                      <span className="inline-flex items-center gap-1.5" title={assetLabel[item.suggestedAsset.type]}>
                        <SuggestedIcon className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.5} />
                        {item.suggestedAsset.name}
                      </span>
                    ) : null
                  }
                >
                  {item.suggestedAsset && item.suggestedReason && (
                    <span className="mt-0.5 block text-xs text-muted-foreground">{item.suggestedReason}</span>
                  )}
                </ReadRow>
              </dl>
              <p className="mt-3 text-xs text-muted-foreground">
                {!readBy
                  ? "Receipt reading is off. Fill these in when you file it."
                  : nothingRead
                    ? "Nothing recognised. Fill these in when you file it."
                    : "Check these before filing."}
              </p>
            </>
          )}
        </section>

        {/* Where it goes */}
        <fieldset className="min-w-0 border-t bg-muted/50 p-4 md:border-t-0 md:border-l">
          <legend className="float-left mb-3 w-full text-[0.7rem] font-semibold tracking-wider text-muted-foreground uppercase">
            Where it goes <FieldHelp id="inbox.destination" className="ml-1 align-middle" />
          </legend>
          <div className="clear-left space-y-1">
            {DESTINATIONS.map((d) => (
              <label
                key={d.value}
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-md border border-transparent px-2.5 py-2 transition-colors hover:bg-background/60",
                  destination === d.value && "border-border bg-background shadow-xs",
                  uploading && "cursor-not-allowed opacity-60"
                )}
              >
                <input
                  type="radio"
                  name={radioName}
                  value={d.value}
                  checked={destination === d.value}
                  disabled={uploading}
                  onChange={() => setPicked(d.value)}
                  className="mt-0.5 size-4 shrink-0 accent-primary"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{d.label}</span>
                  <span className="block text-xs text-muted-foreground">
                    {d.hint}
                    {d.value === "file" && item.suggestedAsset && (
                      <>
                        {" "}
                        {/* A no-break space keeps the arrow with the name; a long name can still wrap. */}
                        <span aria-hidden>→&nbsp;</span>
                        <span className="sr-only">for </span>
                        <span className="font-medium break-words text-foreground">{item.suggestedAsset.name}</span>
                      </>
                    )}
                  </span>
                </span>
              </label>
            ))}
          </div>
          <div className="mt-3 flex justify-end">
            <Button type="button" className="w-full sm:w-auto" disabled={uploading || pending} onClick={proceed}>
              {pending && destination === "attach" ? <Loader2 className="animate-spin" /> : null}
              Continue
              <ArrowRight data-icon="inline-end" />
            </Button>
          </div>
        </fieldset>
      </div>

      {dialog?.kind === "file" && (
        <FileInboxDialog
          itemId={item.id}
          fileName={fileName}
          defaults={dialog.defaults}
          assets={assets}
          reminders={reminders}
          reminderMatches={item.reminderMatches}
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
