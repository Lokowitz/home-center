import type { AssetType, InboxStatus } from "@/app/generated/prisma/client"

// The assistant's view of the capture inbox, and the note the chat shows after
// it drops a file there. The assistant only reads the inbox: filing stays on
// the /inbox page. Pure and import-light, so the chat page can use it too
// (serialize.ts would pull the whole ontology into the browser bundle).

const toDay = (d: Date) => d.toISOString().slice(0, 10)
const compact = <T extends Record<string, unknown>>(o: T) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined)) as Partial<T>

export const INBOX_HREF = "/inbox"
export const INBOX_LIMIT = 20

export const INBOX_TOOL_DESCRIPTION =
  "List the files waiting in the Inbox: receipts and invoices someone added (on the Inbox page or by attaching them in this chat) that aren't filed yet. " +
  "Each item has its file names, whether it has been read, the date, total and shop read from it, and the asset it seems to be for (with why, when known). " +
  "Use it when asked what's in the Inbox, what was read from a file just added, or about a receipt that may not be filed yet. " +
  "You can't file, edit or discard items: the user does that on the Inbox page (href in the result)."

/** One inbox item as the tool's server side loads it. */
export type InboxToolRow = {
  createdAt: Date
  status: InboxStatus
  parsedDate: Date | null
  parsedTotal: number | null
  parsedVendor: string | null
  error: string | null
  /** The stored suggestion's type, kept even when its name is hidden, so health filtering doesn't depend on the name lookup. */
  suggestedAssetType: AssetType | null
  /** Null when there's no suggestion or the asset is gone or hidden. */
  suggestedAsset: { name: string; href: string } | null
  /** Why it was suggested, in plain words ("VIN on the receipt"); never the matched value. */
  suggestedReason: string | null
  files: string[]
}

const STATUS_TEXT: Record<InboxStatus, string> = {
  PENDING: "still being read",
  READY: "read, ready to file",
  FAILED: "couldn't be read",
}

export function inboxToolResult(rows: InboxToolRow[], opts: { includeHealth: boolean; limit?: number }) {
  const limit = opts.limit ?? INBOX_LIMIT
  // An item that looks like a person's is a health document: left out entirely,
  // file names included, unless health documents may go to the model.
  const visible = rows.filter((r) => r.files.length > 0 && (opts.includeHealth || r.suggestedAssetType !== "PERSON"))
  const items = visible.slice(0, limit).map((r) =>
    compact({
      files: r.files,
      added: toDay(r.createdAt),
      status: STATUS_TEXT[r.status],
      date: r.parsedDate ? toDay(r.parsedDate) : null,
      total: r.parsedTotal,
      vendor: r.parsedVendor,
      suggestedAsset:
        r.suggestedAssetType && r.suggestedAsset
          ? { type: r.suggestedAssetType, ...r.suggestedAsset, ...(r.suggestedReason ? { why: r.suggestedReason } : {}) }
          : null,
      error: r.status === "FAILED" ? r.error : null,
    })
  )
  const note = !visible.length
    ? "The Inbox is empty."
    : "These files are not filed yet: they are not service records and don't count in costs. The user files them on the Inbox page." +
      (visible.length > items.length ? ` Showing the ${items.length} newest of ${visible.length}.` : "")
  return { href: INBOX_HREF, count: visible.length, items, note }
}

/** The chat's own line after files land in the Inbox. Never sent to the model. */
export function inboxNoticeText(names: string[]): string {
  if (names.length === 1) return `Added ${names[0]} to your Inbox — reading it now.`
  const list = names.length === 2 ? `${names[0]} and ${names[1]}` : `${names[0]} and ${names.length - 1} more files`
  return `Added ${list} to your Inbox — reading them now.`
}

/** Prefilled in the composer after an attach; the user decides whether to send it. */
export function inboxFollowUpQuestion(names: string[]): string {
  return names.length === 1 ? `What did you read from ${names[0]}?` : "What did you read from the files I just added?"
}
