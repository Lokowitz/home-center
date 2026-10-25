import { prisma } from "@/lib/prisma"
import type { AssetType, AttachmentRecordType, DocumentTextStatus, Prisma } from "@/app/generated/prisma/client"
import { describeAttachment, type DocumentRef } from "./owner"
import { HEALTH_RECORD_TYPES } from "./limits"
import { HEALTH_INSURANCE_KINDS } from "@/lib/insurance"
import { attachmentOutOfScopeWhere, type PropertyScope } from "@/lib/property-filter"

// Database side of the document tools: which files belong to an asset, and
// what each file belongs to.

/**
 * The query form of isHealthDocument (tool-helpers.ts): the health record
 * types plus anything whose service record, reminder or warranty belongs to a
 * person. Keep the two in step.
 */
export function healthWhere(): Prisma.AttachmentWhereInput {
  return {
    OR: [
      { recordType: { in: [...HEALTH_RECORD_TYPES] } },
      { serviceRecord: { is: { assetType: "PERSON" } } },
      { maintenanceSchedule: { is: { assetType: "PERSON" } } },
      { warranty: { is: { assetType: "PERSON" } } },
      { recordType: "DOCUMENT", assetType: "PERSON" },
      // A medical, dental or vision card; home, auto and life policy files aren't health data.
      { insurancePolicy: { is: { kind: { in: [...HEALTH_INSURANCE_KINDS] } } } },
    ],
  }
}

/** Ids of every health file, for filtering the search index (which only knows record types). */
export async function healthAttachmentIds(): Promise<string[]> {
  const rows = await prisma.attachment.findMany({ where: healthWhere(), select: { id: true } })
  return rows.map((r) => r.id)
}

/** Ids of every file the property filter hides, for filtering the search index. Empty with the filter off. */
export async function outOfScopeAttachmentIds(scope: PropertyScope | null): Promise<string[]> {
  if (!scope) return []
  const rows = await prisma.attachment.findMany({ where: attachmentOutOfScopeWhere(scope), select: { id: true } })
  return rows.map((r) => r.id)
}

type ScopeFilter = {
  attachmentIds: string[] | null
  recordTypes: AttachmentRecordType[] | null
  includeHealth: boolean
  /** Property filter: files it hides are left out. */
  scope?: PropertyScope | null
}

/** Shared filter for list_documents and the not-indexed count. */
function scopeWhere(f: ScopeFilter): Prisma.AttachmentWhereInput {
  return {
    ...(f.recordTypes ? { recordType: { in: f.recordTypes } } : {}),
    ...(f.attachmentIds ? { id: { in: f.attachmentIds } } : {}),
    ...(f.includeHealth ? {} : { NOT: healthWhere() }),
    // In AND so it doesn't replace the health NOT above.
    ...(f.scope ? { AND: [{ NOT: attachmentOutOfScopeWhere(f.scope) }] } : {}),
  }
}

export const OWNER_SELECT = {
  id: true, recordType: true, filename: true, originalName: true,
  serviceRecordId: true, warrantyId: true, maintenanceScheduleId: true, healthConditionId: true, insurancePolicyId: true,
  observationId: true, medicationId: true, allergyId: true, immunizationId: true, assetId: true, assetType: true, inboxItemId: true, roomId: true,
  serviceRecord: { select: { title: true, assetType: true, assetId: true } },
  warranty: { select: { productName: true, assetType: true, assetId: true } },
  maintenanceSchedule: { select: { title: true, assetType: true, assetId: true } },
  healthCondition: { select: { name: true, personId: true } },
  observation: { select: { id: true, type: true, date: true, personId: true } },
  medication: { select: { name: true, personId: true } },
  allergy: { select: { substance: true, personId: true } },
  immunization: { select: { vaccine: true, personId: true } },
  insurancePolicy: { select: { carrier: true, kind: true } },
  room: { select: { name: true, propertyId: true } },
} satisfies Prisma.AttachmentSelect

export type LoadedRef = DocumentRef & {
  recordType: AttachmentRecordType
  text: { status: DocumentTextStatus; pageCount: number | null } | null
}

export async function loadDocumentRefs(ids: string[]): Promise<Map<string, LoadedRef>> {
  if (!ids.length) return new Map()
  const rows = await prisma.attachment.findMany({
    where: { id: { in: ids } },
    select: { ...OWNER_SELECT, text: { select: { status: true, pageCount: true } } },
  })
  return new Map(rows.map((r) => [r.id, { ...describeAttachment(r), recordType: r.recordType, text: r.text }]))
}

/**
 * Files on an asset and its records. A property includes the equipment
 * installed there (as the other shortcut tools do); a person includes their
 * health records and the insurance policies they're a member of.
 */
export async function attachmentIdsForAsset(type: AssetType, id: string): Promise<string[]> {
  const owners: { assetType: AssetType; assetId: string }[] = [{ assetType: type, assetId: id }]
  if (type === "PROPERTY") {
    const equipment = await prisma.equipment.findMany({ where: { propertyId: id }, select: { id: true } })
    owners.push(...equipment.map((e) => ({ assetType: "EQUIPMENT" as const, assetId: e.id })))
  }
  const OR: Prisma.AttachmentWhereInput[] = owners.flatMap((o) => [
    { serviceRecord: { is: o } },
    { warranty: { is: o } },
    { maintenanceSchedule: { is: o } },
    { recordType: "DOCUMENT" as const, ...o },
  ])
  if (type === "PERSON") {
    OR.push(
      { healthCondition: { is: { personId: id } } },
      { observation: { is: { personId: id } } },
      { medication: { is: { personId: id } } },
      { allergy: { is: { personId: id } } },
      { immunization: { is: { personId: id } } },
      { insurancePolicy: { is: { members: { some: { id } } } } },
    )
  }
  const rows = await prisma.attachment.findMany({ where: { OR }, select: { id: true } })
  return rows.map((r) => r.id)
}

export type ListedRef = LoadedRef & { uploadedAt: Date }

/** Files in scope, newest first, for list_documents. Health files never appear or count unless included. */
export async function listDocumentRefs(f: ScopeFilter & { limit: number }): Promise<{ total: number; refs: ListedRef[] }> {
  const where = scopeWhere(f)
  const [total, rows] = await Promise.all([
    prisma.attachment.count({ where }),
    prisma.attachment.findMany({
      where,
      orderBy: { uploadedAt: "desc" },
      take: f.limit,
      select: { ...OWNER_SELECT, uploadedAt: true, text: { select: { status: true, pageCount: true } } },
    }),
  ])
  return {
    total,
    refs: rows.map((r) => ({ ...describeAttachment(r), recordType: r.recordType, uploadedAt: r.uploadedAt, text: r.text })),
  }
}

/** Files in scope the search couldn't see: not read yet, failed, or unsupported. Health files never count unless included. */
export async function countNotIndexed(f: ScopeFilter): Promise<number> {
  return prisma.attachmentText.count({
    where: { status: { in: ["PENDING", "FAILED", "UNSUPPORTED"] }, attachment: scopeWhere(f) },
  })
}
