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
