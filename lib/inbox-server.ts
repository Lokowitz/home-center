import { prisma } from "@/lib/prisma"
import type { AssetType, InboxStatus } from "@/app/generated/prisma/client"
import { loadFeatures } from "@/lib/features-server"
import { removeUploadDir } from "@/lib/upload-fs"
import { EMPTY_ITEM_MAX_AGE_MS } from "@/lib/inbox"

// Reads for the /inbox page and the sidebar badge.

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
  error: string | null
  /** Null when there's no suggestion, or the suggested asset is gone or hidden (a person with Health off). */
  suggestedAsset: { type: AssetType; id: string; name: string } | null
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

/** Every item, newest first, with its files and suggested asset. Cleans up abandoned items first. */
export async function listInboxItems(now: Date = new Date()): Promise<InboxListItem[]> {
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
  const names = await assetNames(refs, features.health)
  return rows.map((r) => {
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
      error: r.error,
      suggestedAsset: r.suggestedAssetType && r.suggestedAssetId && name ? { type: r.suggestedAssetType, id: r.suggestedAssetId, name } : null,
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
}

/** For the sidebar badge: items with at least one file. */
export async function inboxCount(): Promise<number> {
  return prisma.inboxItem.count({ where: { attachments: { some: {} } } })
}
