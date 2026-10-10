import type { AssetType, InboxStatus } from "@/app/generated/prisma/client"
import { ASSET_TYPES } from "@/lib/assets"
import { UPLOAD_TYPES } from "@/lib/upload-types"

// Client-safe rules for the /inbox page: what the "File it" form starts with,
// how it becomes a ServiceRecordInput, and when the list must keep refreshing.

/** Base UI Select has no empty-string option, so "no category" needs a sentinel. */
export const NO_CATEGORY = "__none__"

export type FileFormValues = {
  /** `${assetType}:${assetId}`, or "" until one is chosen. */
  assetKey: string
  date: string
  title: string
  vendor: string
  cost: string
  category: string
  mileageAtService: string
  scheduleId: string
  description: string
}

export function assetKey(assetType: AssetType, assetId: string): string {
  return `${assetType}:${assetId}`
}

export function parseAssetKey(key: string): { assetType: AssetType; assetId: string } | null {
  const at = key.indexOf(":")
  if (at < 0) return null
  const type = key.slice(0, at)
  const id = key.slice(at + 1)
  if (!id || !(ASSET_TYPES as readonly string[]).includes(type)) return null
  return { assetType: type as AssetType, assetId: id }
}

/** "Jiffy Lube" → "Jiffy Lube service"; blank without a vendor (the user must type one). */
export function guessTitle(vendor: string | null): string {
  const v = vendor?.trim()
  return v ? `${v} service` : ""
}

/** The local calendar day, as a date input wants it. */
export function localDay(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export type PrefillSource = {
  status: InboxStatus
  parsedDate: Date | null
  parsedTotal: number | null
  parsedVendor: string | null
  suggestedAsset: { type: AssetType; id: string } | null
}

/** The form's starting values. Parsed dates are stored as UTC midnight, so their UTC day is the receipt's day. */
export function fileFormDefaults(item: PrefillSource, today: string): FileFormValues {
  return {
    assetKey: item.suggestedAsset ? assetKey(item.suggestedAsset.type, item.suggestedAsset.id) : "",
    date: item.parsedDate ? new Date(item.parsedDate).toISOString().slice(0, 10) : today,
    title: guessTitle(item.parsedVendor),
    vendor: item.parsedVendor ?? "",
    cost: item.parsedTotal != null ? String(item.parsedTotal) : "",
    category: NO_CATEGORY,
    mileageAtService: "",
    scheduleId: "",
    description: "",
  }
}

/** What fileInboxItem takes. A blank asset is sent as-is so the server's validation reports it. */
export function fileFormPayload(v: FileFormValues) {
  const asset = parseAssetKey(v.assetKey)
  const assetType: AssetType = asset?.assetType ?? "PROPERTY"
  return {
    assetType,
    assetId: asset?.assetId ?? "",
    date: v.date,
    title: v.title,
    vendor: v.vendor,
    cost: v.cost,
    category: v.category === NO_CATEGORY ? "" : v.category,
    mileageAtService: assetType === "VEHICLE" && asset ? v.mileageAtService : "",
    scheduleId: v.scheduleId,
    description: v.description,
  }
}

const FORM_FIELDS = new Set<string>(["date", "title", "vendor", "cost", "category", "mileageAtService", "scheduleId", "description"])

/** Which form field shows a server field error; null for fields this form doesn't have. */
export function fieldErrorTarget(field: string): keyof FileFormValues | null {
  if (field === "assetId" || field === "assetType") return "assetKey"
  return FORM_FIELDS.has(field) ? (field as keyof FileFormValues) : null
}

/** True while any item is still being read, or its upload hasn't landed yet. */
export function hasPendingItems(items: { status: InboxStatus; attachments: unknown[] }[]): boolean {
  return items.some((i) => i.status === "PENDING" || i.attachments.length === 0)
}

export function readByLabel(parseMethod: string | null): string | null {
  if (parseMethod === "basic") return "basic"
  if (parseMethod === "llm") return "local AI"
  return null
}

/** The file input's `accept`, from the same table the upload route enforces. */
export function uploadAccept(): string {
  return Object.keys(UPLOAD_TYPES).join(",")
}

// HEIC and TIFF are allowed uploads but most browsers can't draw them.
const PREVIEWABLE = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/bmp"])

export function isPreviewableImage(mimeType: string): boolean {
  return PREVIEWABLE.has(mimeType)
}

// ─── The inbox card: what was read, how sure we are, where it goes ───────────

const DAY_MS = 24 * 60 * 60 * 1000
/** A receipt dated this long before its upload is probably misread (or a very old scan). */
const OLD_RECEIPT_MS = 3 * 365.25 * DAY_MS
/** Slack after the upload for clocks and time zones. */
const FUTURE_SLACK_MS = 3 * DAY_MS

const NUMBER_PREFIX = /^(job|order|invoice|inv|ref|reference|receipt|po|p\.o\.|acct|account|ticket|transaction|trans|ro|work\s+order)\b/i
const MONTH = String.raw`(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?`
const DATE_SHAPES = [
  /^\d{1,4}[/.\-]\d{1,2}[/.\-]\d{1,4}$/,
  new RegExp(String.raw`^${MONTH}\s+\d{1,2}(?:st|nd|rd|th)?,?(?:\s+\d{2,4})?$`, "i"),
  new RegExp(String.raw`^\d{1,2}(?:st|nd|rd|th)?\s+${MONTH},?\s+\d{2,4}$`, "i"),
]

/**
 * Why a read vendor might not be a shop name: an order or job number, a date,
 * a line that starts with stray punctuation, or mostly digits. Null when it
 * looks fine or there is none. Conservative: "THE HOME DEPOT #1234" passes.
 */
export function vendorDoubt(vendor: string | null): string | null {
  const v = vendor?.replace(/\s+/g, " ").trim()
  if (!v) return null
  if (NUMBER_PREFIX.test(v) && /\d/.test(v)) return "Looks like a job, order or invoice number, not a shop name."
  if (DATE_SHAPES.some((re) => re.test(v))) return "Looks like a date, not a shop name."
  if (/^[^\p{L}\p{N}]/u.test(v)) return "Starts with stray punctuation, so it may be misread."
  const digits = (v.match(/\p{N}/gu) ?? []).length
  const letters = (v.match(/\p{L}/gu) ?? []).length
  if (digits > letters) return "Mostly numbers, so it may not be the shop name."
  return null
}

/** Why a read date might be wrong: well after the upload, or over about three years before it. */
export function dateDoubt(date: Date | null, uploadedAt: Date): string | null {
  if (!date) return null
  const t = new Date(date).getTime()
  const up = new Date(uploadedAt).getTime()
  if (!Number.isFinite(t)) return "Not a valid date."
  if (t > up + FUTURE_SLACK_MS) return "After the day it was added, so it may be misread."
  if (t < up - OLD_RECEIPT_MS) return "More than 3 years before it was added, so it may be misread."
  return null
}

/** Why a read total might be wrong. Refunds (negative totals) are fine; zero is suspicious. */
export function totalDoubt(total: number | null): string | null {
  if (total == null) return null
  if (!Number.isFinite(total)) return "Not a valid amount."
  if (total === 0) return "The total read as zero."
  return null
}

export type FieldRead = { state: "found" } | { state: "missing" } | { state: "unsure"; reason: string }

export type CardSource = {
  status: InboxStatus
  createdAt: Date
  parsedDate: Date | null
  parsedTotal: number | null
  parsedVendor: string | null
  suggestedAsset: { type: AssetType; id: string; name: string } | null
  attachments: unknown[]
}

function fieldRead(present: boolean, doubt: string | null): FieldRead {
  if (!present) return { state: "missing" }
  return doubt ? { state: "unsure", reason: doubt } : { state: "found" }
}

/** Each field the card shows: found, not found, or found but doubtful (with why). */
export function readFields(item: Omit<CardSource, "status" | "attachments">) {
  const date = item.parsedDate ? new Date(item.parsedDate) : null
  return {
    date: fieldRead(date != null, dateDoubt(date, new Date(item.createdAt))),
    total: fieldRead(item.parsedTotal != null, totalDoubt(item.parsedTotal)),
    vendor: fieldRead(!!item.parsedVendor?.trim(), vendorDoubt(item.parsedVendor)),
    asset: fieldRead(item.suggestedAsset != null, null),
  }
}

export type InboxReadiness = "reading" | "failed" | "ready" | "check"

/** The card's status chip. "ready" needs a date, a total and an asset, and nothing read doubtful. */
export function inboxReadiness(item: CardSource): InboxReadiness {
  if (!item.attachments.length || item.status === "PENDING") return "reading"
  if (item.status === "FAILED") return "failed"
  const f = readFields(item)
  const required = [f.date, f.total, f.asset].every((x) => x.state === "found")
  return required && f.vendor.state !== "unsure" ? "ready" : "check"
}

/** "$125.00 at Haley Mechanical · Apr 30, 2024" from already formatted parts; the file name when nothing was read. */
export function inboxHeadline(parts: { total: string | null; vendor: string | null; date: string | null }, fileName: string): string {
  const total = parts.total?.trim() || null
  const vendor = parts.vendor?.replace(/\s+/g, " ").trim() || null
  const date = parts.date?.trim() || null
  const what = total && vendor ? `${total} at ${vendor}` : (total ?? vendor)
  if (what && date) return `${what} · ${date}`
  if (what) return what
  if (date) return `Receipt from ${date}`
  return fileName
}

export type InboxDestination = "file" | "attach" | "keep"

/** Attach when the suggested asset already has a record with this receipt's total and day; otherwise a new record. */
export function defaultDestination(item: { suggestedAsset: unknown | null; matchingRecord: boolean }): InboxDestination {
  return item.suggestedAsset && item.matchingRecord ? "attach" : "file"
}
