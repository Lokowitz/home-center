import type { AttachmentRecordType, DocumentTextStatus } from "@/app/generated/prisma/client"
import { ToolInputError } from "@/lib/llm/query"
import { compact, toDay } from "@/lib/llm/serialize"
import type { Hit } from "./index-db"
import { HEALTH_RECORD_TYPES } from "./limits"
import { isHealthInsuranceKind } from "@/lib/insurance"
import type { DocumentRef } from "./owner"

// Rules for the assistant's document tools that don't need the database.

export const RECORD_TYPES = [
  "SERVICE", "WARRANTY", "MAINTENANCE", "CONDITION", "INSURANCE", "OBSERVATION", "MEDICATION", "ALLERGY", "IMMUNIZATION", "DOCUMENT", "INBOX", "ROOM",
] as const satisfies readonly AttachmentRecordType[]

/** Record types whose files the tools never see: health types unless included, room files with Rooms off. */
export function hiddenRecordTypes(includeHealth: boolean, includeRooms = true): AttachmentRecordType[] {
  return [...(includeHealth ? [] : HEALTH_RECORD_TYPES), ...(includeRooms ? [] : (["ROOM"] as const))]
}

export function visibleRecordTypes(includeHealth: boolean, includeRooms = true): AttachmentRecordType[] {
  const hidden = hiddenRecordTypes(includeHealth, includeRooms)
  return RECORD_TYPES.filter((t) => !hidden.includes(t))
}

/**
 * What "Include health record documents" covers: the health record types, and
 * anything else owned by a person — their visits (service records), reminders
 * (maintenance schedules) and warranties, and the files of medical, dental
 * and vision policies. Home, auto and life policies aren't
 * person's record and stay visible.
 */
export function isHealthDocument(ref: { recordType: string; asset: { type: string; id: string } | null; insuranceKind?: string }): boolean {
  return (
    ref.asset?.type === "PERSON" ||
    (HEALTH_RECORD_TYPES as readonly string[]).includes(ref.recordType) ||
    (ref.insuranceKind != null && isHealthInsuranceKind(ref.insuranceKind))
  )
}

const ALIASES: Record<string, AttachmentRecordType> = {
  service: "SERVICE", servicerecord: "SERVICE", record: "SERVICE",
  warranty: "WARRANTY",
  maintenance: "MAINTENANCE", maintenanceschedule: "MAINTENANCE", schedule: "MAINTENANCE",
  condition: "CONDITION", healthcondition: "CONDITION", diagnosis: "CONDITION",
  insurance: "INSURANCE", insurancepolicy: "INSURANCE", policy: "INSURANCE",
  observation: "OBSERVATION",
  medication: "MEDICATION", medicine: "MEDICATION", prescription: "MEDICATION",
  allergy: "ALLERGY",
  immunization: "IMMUNIZATION", vaccine: "IMMUNIZATION", vaccination: "IMMUNIZATION",
  document: "DOCUMENT", assetdocument: "DOCUMENT",
  intake: "INBOX", intakeitem: "INBOX", inbox: "INBOX", inboxitem: "INBOX", unfiled: "INBOX",
  room: "ROOM",
}

/** A recordType argument as models send it ("warranties", "Service records") → the enum, if visible. */
export function toRecordType(raw: string, includeHealth: boolean, includeRooms = true): AttachmentRecordType {
  const upper = raw.trim().toUpperCase()
  const key = raw.toLowerCase().replace(/[^a-z]/g, "").replace(/ies$/, "y").replace(/s$/, "")
  const type = (RECORD_TYPES as readonly string[]).includes(upper) ? (upper as AttachmentRecordType) : ALIASES[key]
  const visible = visibleRecordTypes(includeHealth, includeRooms)
  if (!type || !visible.includes(type)) {
    throw new ToolInputError(`Unknown recordType "${raw}". Use one of: ${visible.join(", ")}.`)
  }
  return type
}

/**
 * The record types a list or search covers: the one asked for, else every type
 * (null) — or, with Rooms off, every visible type, since the person-owned health
 * files are filtered separately but room files only by type.
 */
export function recordTypeFilter(raw: string | undefined, includeHealth: boolean, includeRooms: boolean): AttachmentRecordType[] | null {
  if (raw) return [toRecordType(raw, includeHealth, includeRooms)]
  return includeRooms ? null : visibleRecordTypes(includeHealth, includeRooms)
}

/** Chunks → files, best file first, each with its best `perDoc` chunks. Lower BM25 score is better. */
export function groupHits(hits: Hit[], limit: number, perDoc = 3): { attachmentId: string; hits: Hit[] }[] {
  const groups = new Map<string, Hit[]>()
  for (const h of [...hits].sort((a, b) => a.score - b.score)) {
    const g = groups.get(h.attachmentId)
    if (g) {
      if (g.length < perDoc) g.push(h)
    } else if (groups.size < limit) {
      groups.set(h.attachmentId, [h])
    }
  }
  return [...groups].map(([attachmentId, grouped]) => ({ attachmentId, hits: grouped }))
}

export function searchDocumentsDescription(includeHealth: boolean): string {
  return (
    "Search the text of uploaded files — receipts, manuals, titles, deeds, warranty cards, insurance policies" +
    (includeHealth ? ", medical documents" : "") +
    ". Use it when the answer is likely written in a document rather than stored as a field: filter sizes, part numbers, " +
    "deductibles, coverage terms, instructions. Understands meaning as well as exact words: a plain question works, and model or part numbers match exactly. " +
    "Returns the best passages per file; call read_document for more."
  )
}

export function listDocumentsDescription(includeHealth: boolean): string {
  return (
    "List the uploaded files — receipts, manuals, titles, deeds, warranty cards, insurance policies" +
    (includeHealth ? ", medical documents" : "") +
    ", newest first. Use it for 'what documents do we have', to see the files for one asset or person, " +
    "or of one record type. It lists names, not contents: use search_documents or read_document for what's inside."
  )
}

const NOT_SEARCHABLE: Record<Exclude<DocumentTextStatus, "DONE">, string> = {
  PENDING: "not yet — waiting to be read",
  EMPTY: "no — no text found",
  UNSUPPORTED: "no — file type can't be read",
  FAILED: "no — couldn't be read",
}

/** One row of list_documents: the file, what it belongs to, and whether its text can be searched. */
export function listedDocument(
  ref: Omit<DocumentRef, "asset"> & {
    asset: DocumentRef["asset"]
    uploadedAt: Date
    text: { status: DocumentTextStatus; pageCount: number | null } | null
  },
  assetName: string | undefined
): Record<string, unknown> {
  const status = ref.text?.status ?? "PENDING"
  return compact({
    attachmentId: ref.attachmentId,
    fileName: ref.fileName,
    fileHref: ref.fileHref,
    record: ref.record,
    asset: assetName,
    uploaded: toDay(ref.uploadedAt),
    pages: ref.text?.pageCount && ref.text.pageCount > 1 ? ref.text.pageCount : null,
    searchable: status === "DONE" ? null : NOT_SEARCHABLE[status],
  })
}

export const READ_DOCUMENT_DESCRIPTION =
  "Read the text of one uploaded file, a few pages at a time. Use after search_documents when a passage isn't enough. " +
  "If the result has next, call again with next.fromPage and next.offset to continue."

export const STATUS_NOTE: Record<Exclude<DocumentTextStatus, "DONE">, string> = {
  PENDING: "This file hasn't been read yet — it's waiting to be indexed. Try again in a few minutes.",
  EMPTY: "No text was found in this file (a photo or scan with OCR off, or a blank page).",
  UNSUPPORTED: "This file type can't be read (iWork, zip, old Excel or PowerPoint, HEIC photos).",
  FAILED: "This file couldn't be read.",
}

export type DocumentAccess = { enabled: boolean; includeHealth: boolean }

export function documentAccess(
  settings: { indexingEnabled: boolean },
  llm: { documentsEnabled: boolean; healthDocumentsEnabled: boolean }
): DocumentAccess {
  const enabled = settings.indexingEnabled && llm.documentsEnabled
  return { enabled, includeHealth: enabled && llm.healthDocumentsEnabled }
}
