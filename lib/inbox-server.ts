import { prisma } from "@/lib/prisma"
import type { AssetType, InboxStatus } from "@/app/generated/prisma/client"
import { loadFeatures } from "@/lib/features-server"
import { removeUploadDir } from "@/lib/upload-fs"
import { EMPTY_ITEM_MAX_AGE_MS } from "@/lib/inbox"

// Reads for the /intake page and the Intake badge.

export type InboxAttachment = {
  id: string
  originalName: string
  mimeType: string
  sizeBytes: number
  /** Served by app/api/files, like every other upload. */
  href: string
  textStatus: string | null
}

export type InboxListItem = {
  id: string
  createdAt: Date
  createdBy: string
  status: InboxStatus
  parsedDate: Date | null
  parsedTotal: number | null
  parsedVendor: string | null
  parseMethod: string | null
  /** Why Local AI was chosen but not used (see ParseNote in lib/inbox); null otherwise. */
  parseNote: string | null
  error: string | null
  /** Null when there's no suggestion, or the suggested asset is gone or hidden (a person with Health off). */
  suggestedAsset: { type: AssetType; id: string; name: string } | null
  /** Why that asset was suggested ("VIN on the receipt"); null without a suggestion. */
  suggestedReason: string | null
  /** The suggested asset already has a service record with this receipt's total on its day. */
  matchingRecord: boolean
  attachments: InboxAttachment[]
}

/** Items whose upload never arrived (no files, over an hour old) are deleted. */
async function removeAbandoned(now: Date): Promise<void> {
  const stale = await prisma.inboxItem.findMany({
    where: { attachments: { none: {} }, createdAt: { lt: new Date(now.getTime() - EMPTY_ITEM_MAX_AGE_MS) } },
    select: { id: true },
  })
  if (!stale.length) return
  await prisma.inboxItem.deleteMany({ where: { id: { in: stale.map((s) => s.id) }, attachments: { none: {} } } })
  for (const s of stale) await removeUploadDir("inbox", s.id)
}

async function assetNames(refs: { type: AssetType; id: string }[], includePeople: boolean): Promise<Map<string, string>> {
  const ids = (type: AssetType) => [...new Set(refs.filter((r) => r.type === type).map((r) => r.id))]
  const where = (type: AssetType) => ({ where: { id: { in: ids(type) } }, select: { id: true, name: true } })
  const [vehicles, properties, equipment, people] = await Promise.all([
    prisma.vehicle.findMany(where("VEHICLE")),
    prisma.property.findMany(where("PROPERTY")),
    prisma.equipment.findMany(where("EQUIPMENT")),
    includePeople ? prisma.person.findMany(where("PERSON")) : Promise.resolve([]),
  ])
  return new Map([...vehicles, ...properties, ...equipment, ...people].map((a) => [a.id, a.name]))
}

const HALF_DAY_MS = 12 * 60 * 60 * 1000

type RecordProbe = { id: string; suggestedAssetType: AssetType | null; suggestedAssetId: string | null; parsedDate: Date | null; parsedTotal: number | null }

/**
 * Items whose suggested asset already has a service record with the same total
 * on the same day (the user logged it by hand), so the card can default to
 * attaching. One query for the whole list; same rule as bestAttachMatch's top score.
 */
async function itemsWithMatchingRecord(rows: RecordProbe[]): Promise<Set<string>> {
  const probes = rows.flatMap((r) =>
    r.suggestedAssetType && r.suggestedAssetId && r.parsedDate && r.parsedTotal != null
      ? [{ id: r.id, assetType: r.suggestedAssetType, assetId: r.suggestedAssetId, day: r.parsedDate.getTime(), total: r.parsedTotal }]
      : []
  )
  if (!probes.length) return new Set()
  const records = await prisma.serviceRecord.findMany({
    where: {
      OR: probes.map((p) => ({
        assetType: p.assetType,
        assetId: p.assetId,
        cost: { gte: p.total - 0.005, lte: p.total + 0.005 },
        date: { gte: new Date(p.day - HALF_DAY_MS), lte: new Date(p.day + HALF_DAY_MS) },
      })),
    },
    select: { assetType: true, assetId: true, date: true, cost: true },
  })
  return new Set(
    probes
      .filter((p) =>
        records.some(
          (r) =>
            r.assetType === p.assetType &&
            r.assetId === p.assetId &&
            r.cost != null &&
            Math.abs(r.cost - p.total) < 0.005 &&
            Math.abs(r.date.getTime() - p.day) <= HALF_DAY_MS
        )
      )
      .map((p) => p.id)
  )
}

export type InboxList = {
  items: InboxListItem[]
  /**
   * Names of the people in the household (accounts, plus people while Health
   * is on), so the card can doubt a "shop" that is really the customer.
   */
  householdNames: string[]
}

/** Account names, plus people's names only while Health is on. */
/** Names of the household's users, and its people while Health is on. */
export async function loadHouseholdNames(includePeople: boolean): Promise<string[]> {
  const [users, people] = await Promise.all([
    prisma.user.findMany({ select: { name: true } }),
    includePeople ? prisma.person.findMany({ select: { name: true } }) : Promise.resolve([]),
  ])
  return [...new Set([...users, ...people].map((r) => r.name.trim()).filter(Boolean))]
}

/** Every item, newest first, with its files and suggested asset. Cleans up abandoned items first. */
export async function listInboxItems(now: Date = new Date()): Promise<InboxList> {
  await removeAbandoned(now)
  const [rows, features] = await Promise.all([
    prisma.inboxItem.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        createdBy: { select: { name: true } },
        attachments: {
          orderBy: { uploadedAt: "asc" },
          select: { id: true, filename: true, originalName: true, mimeType: true, sizeBytes: true, text: { select: { status: true } } },
        },
      },
    }),
    loadFeatures(),
  ])
  const refs = rows.flatMap((r) => (r.suggestedAssetType && r.suggestedAssetId ? [{ type: r.suggestedAssetType, id: r.suggestedAssetId }] : []))
  const [names, matching, householdNames] = await Promise.all([
    assetNames(refs, features.health),
    itemsWithMatchingRecord(rows),
    loadHouseholdNames(features.health),
  ])
  const items = rows.map((r): InboxListItem => {
    const name = r.suggestedAssetId ? names.get(r.suggestedAssetId) : undefined
    return {
      id: r.id,
      createdAt: r.createdAt,
      createdBy: r.createdBy.name,
      status: r.status,
      parsedDate: r.parsedDate,
      parsedTotal: r.parsedTotal,
      parsedVendor: r.parsedVendor,
      parseMethod: r.parseMethod,
      parseNote: r.parseNote,
      error: r.error,
      suggestedAsset: r.suggestedAssetType && r.suggestedAssetId && name ? { type: r.suggestedAssetType, id: r.suggestedAssetId, name } : null,
      suggestedReason: name ? r.suggestedReason : null,
      matchingRecord: !!name && matching.has(r.id),
      attachments: r.attachments.map((a) => ({
        id: a.id,
        originalName: a.originalName,
        mimeType: a.mimeType,
        sizeBytes: a.sizeBytes,
        href: `/api/files/inbox/${r.id}/${a.filename}`,
        textStatus: a.text?.status ?? null,
      })),
    }
  })
  return { items, householdNames }
}

/** For the Intake badge (header or side menu): items with at least one file. */
export async function inboxCount(): Promise<number> {
  return prisma.inboxItem.count({ where: { attachments: { some: {} } } })
}
