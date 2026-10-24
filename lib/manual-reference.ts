// Imported by the backup engine (lib/backup/readable.ts): keep this file free of imports.

export const MAX_REFERENCE_PAGE = 9999

export type ManualOption = {
  id: string
  name: string // Attachment.originalName
  filename: string // UUID name on disk
  recordType: "DOCUMENT" | "MAINTENANCE"
  assetType: string | null // DOCUMENT: the asset it's filed on
  assetId: string | null
  maintenanceScheduleId: string | null
  hasText: boolean // AttachmentText DONE with charCount > 0
}

export type ReferenceTarget = { assetType: string; assetId: string }
export type ReferenceFields = { referenceAttachmentId: string | null; referencePage: number | null }

const PAGE_ERROR = "Page must be a whole number from 1 to 9999."

export function isPdfFile(filename: string): boolean {
  return /\.pdf$/i.test(filename)
}

/// Same paths as attachmentDir in lib/attachment-location.ts, written out so this file stays import-free.
/// `#page=N` only for PDFs: other types ignore it, and the label still carries the page.
export function manualFileHref(
  o: Pick<ManualOption, "recordType" | "assetId" | "maintenanceScheduleId" | "filename">,
  page: number | null,
): string | null {
  let dir: string
  if (o.recordType === "DOCUMENT") {
    if (!o.assetId) return null
    dir = `document/${o.assetId}`
  } else {
    if (!o.maintenanceScheduleId) return null
    dir = `maintenance/${o.maintenanceScheduleId}`
  }
  const base = `/api/files/${dir}/${o.filename}`
  return page != null && isPdfFile(o.filename) ? `${base}#page=${page}` : base
}

export function manualLabel(page: number | null): string {
  return page != null ? `Manual, p. ${page}` : "Manual"
}

export function manualText(name: string, page: number | null): string {
  return page != null ? `${name}, p. ${page}` : name
}

/// A saved reminder's own asset beats the one a client sent: Health and file checks must not
/// rest on a value the caller can choose.
export function trustedTarget(sent: ReferenceTarget, saved: ReferenceTarget | null): ReferenceTarget {
  return saved ?? sent
}

/// A reminder may link a DOCUMENT filed on its own asset, or a file attached to the reminder itself.
export function referenceAllowed(
  a: { recordType: string; assetType: string | null; assetId: string | null; maintenanceScheduleId: string | null },
  target: ReferenceTarget,
  scheduleId: string | null,
  health: boolean,
): boolean {
  if (!health && target.assetType === "PERSON") return false
  if (a.recordType === "DOCUMENT") {
    return a.assetType === target.assetType && a.assetId === target.assetId
  }
  if (a.recordType === "MAINTENANCE") {
    return scheduleId != null && a.maintenanceScheduleId === scheduleId
  }
  return false
}

/// The loader already drops person files while Health is off, so Health is passed as on here.
export function manualChoices(options: ManualOption[], target: ReferenceTarget, scheduleId: string | null): ManualOption[] {
  return options
    .filter((o) => referenceAllowed(o, target, scheduleId, true))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function resolveManual(
  s: ReferenceFields,
  options: ManualOption[],
): { href: string; label: string; title: string } | null {
  if (!s.referenceAttachmentId) return null
  const o = options.find((x) => x.id === s.referenceAttachmentId)
  if (!o) return null
  const href = manualFileHref(o, s.referencePage)
  if (!href) return null
  return { href, label: manualLabel(s.referencePage), title: manualText(o.name, s.referencePage) }
}

/// Neither field sent: value is undefined and the stored reference stays as it is.
/// A page sent without a file is dropped.
export function cleanReference(v: {
  attachmentId?: string
  page?: string | number
}): { ok: true; value: ReferenceFields | undefined } | { ok: false; error: string } {
  if (v.attachmentId === undefined && v.page === undefined) return { ok: true, value: undefined }
  const attachmentId = v.attachmentId?.trim() || null
  if (!attachmentId) return { ok: true, value: { referenceAttachmentId: null, referencePage: null } }

  let page: number | null = null
  if (typeof v.page === "number") {
    if (!Number.isInteger(v.page)) return { ok: false, error: PAGE_ERROR }
    page = v.page
  } else if (v.page !== undefined && v.page.trim() !== "") {
    const t = v.page.trim()
    if (!/^\d+$/.test(t)) return { ok: false, error: PAGE_ERROR }
    page = Number(t)
  }
  if (page != null && (page < 1 || page > MAX_REFERENCE_PAGE)) return { ok: false, error: PAGE_ERROR }
  return { ok: true, value: { referenceAttachmentId: attachmentId, referencePage: page } }
}
