"use server"

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { mkdir, rename } from "fs/promises"
import { randomBytes } from "crypto"
import { z } from "zod"
import type { AssetType, CaptureParser, InboxStatus, Prisma } from "@/app/generated/prisma/client"
import { ASSET_TYPES, assetHref } from "@/lib/assets"
import { loadFeatures } from "@/lib/features-server"
import { uploadRoot } from "@/lib/upload-path"
import { removeUploadDir } from "@/lib/upload-fs"
import { planMove } from "@/lib/capture/move"
import {
  ATTACH_KINDS, filedAttachmentData, moveWithRollback, targetDir, userAssetSuggestion, type AttachCandidate, type AttachKind, type FileTarget,
} from "@/lib/inbox"
import { assetRecordHref } from "@/lib/documents/owner"
import { processInboxItem } from "@/lib/capture-server"
import { reindexMovedDocuments, searchIndex } from "@/lib/documents/indexer-server"
import { DOCUMENT_SETTINGS_ID } from "@/lib/documents/settings"
import { loadLlmConfig } from "@/lib/llm/config"
import { isLlmReady } from "@/lib/llm/settings-schema"
import { captureParserAllowed } from "@/lib/capture-options"
import {
  newServiceRecordWrites, prepareNewServiceRecord, revalidateNewServiceRecord,
  type ServiceRecordFieldErrors, type ServiceRecordInput,
} from "@/lib/service-record-server"

// The capture inbox: files dropped before anyone chose a record, then filed as
// a service record, kept as an asset document, or discarded. Any signed-in
// member of the household can use it.

async function requireUser() {
  const session = await auth()
  if (!session) redirect("/login")
  return session
}

async function requireAdmin() {
  const session = await requireUser()
  if (session.user.role !== "ADMIN") redirect("/")
  return session
}

// Inbox item ids also name an upload directory, and filing must know the new
// record's id before the files move (so the move and the database change can
// be undone together). cuid-shaped, like Prisma's own.
function newRecordId(): string {
  return `c${Date.now().toString(36)}${randomBytes(8).toString("hex")}`
}

/** The asset's name, or null if it's gone (or a person's while Health is off). */
async function assetName(type: AssetType, id: string): Promise<string | null> {
  const where = { where: { id }, select: { name: true } } as const
  if (type === "PROPERTY") return (await prisma.property.findUnique(where))?.name ?? null
  if (type === "VEHICLE") return (await prisma.vehicle.findUnique(where))?.name ?? null
  if (type === "EQUIPMENT") return (await prisma.equipment.findUnique(where))?.name ?? null
  // People go with the rest of Health.
  if (!(await loadFeatures()).health) return null
  return (await prisma.person.findUnique(where))?.name ?? null
}

async function assetExists(type: AssetType, id: string): Promise<boolean> {
  return (await assetName(type, id)) !== null
}

function revalidateInbox() {
  revalidatePath("/intake")
  // The sidebar's count badge is in the shared layout.
  revalidatePath("/", "layout")
}

const fileSchema = z.object({ assetType: z.enum(ASSET_TYPES), assetId: z.string().min(1) })

/**
 * A new, empty item for an upload. `asset` when the file was added from that
 * asset's page: it becomes the item's suggestion, kept by the reader (see
 * keptUserAsset). Throws if that asset is gone, so the upload stops.
 */
export async function createInboxItem(asset?: { assetType: AssetType; assetId: string }): Promise<{ success: true; id: string }> {
  const session = await requireUser()
  let suggestion = {}
  if (asset) {
    const parsed = fileSchema.safeParse(asset)
    if (!parsed.success) throw new Error("Invalid input")
    const name = await assetName(parsed.data.assetType, parsed.data.assetId)
    if (name === null) throw new Error("That asset no longer exists.")
    suggestion = userAssetSuggestion(parsed.data, name)
  }
  const item = await prisma.inboxItem.create({ data: { createdById: session.user.id, ...suggestion }, select: { id: true } })
  return { success: true, id: item.id }
}

/**
 * Shared by every way out of the inbox (file as a new record, attach to an
 * existing one, keep as a document). Moves every file of the item to the
 * target, then (in one transaction) runs `writes`, repoints the attachments
 * and deletes the item. Files are moved back if the database step fails, and
 * a failure comes back as `failure.message` with nothing changed.
 */
async function moveOut(
  itemId: string,
  target: FileTarget,
  writes: () => Prisma.PrismaPromise<unknown>[],
  failure: { log: string; message: string }
): Promise<{ success: true; attachmentIds: string[] } | { error: string }> {
  try {
    const item = await prisma.inboxItem.findUnique({
      where: { id: itemId },
      select: { id: true, attachments: { select: { id: true, filename: true } } },
    })
    if (!item) return { error: "Not found" }
    const root = uploadRoot()
    const plans = item.attachments.map((a) => planMove(root, { recordType: "INBOX", recordId: item.id }, targetDir(target), a.filename))
    const ids = item.attachments.map((a) => a.id)
    await moveWithRollback(
      plans,
      { mkdir: (dir) => mkdir(dir, { recursive: true }), rename },
      () =>
        prisma.$transaction([
          ...writes(),
          prisma.attachment.updateMany({ where: { id: { in: ids } }, data: filedAttachmentData(target) }),
          // Cascades to anything uploaded after the files were listed; its file goes with the directory below.
          prisma.inboxItem.delete({ where: { id: item.id } }),
        ]),
      (error, plan) => console.error("[inbox] couldn't move a file back", plan.toPath, error instanceof Error ? error.message : error)
    )
    await removeUploadDir("inbox", item.id)
    await reindexMovedDocuments(ids).catch((error) => console.error("[inbox] reindex failed:", error instanceof Error ? error.name : error))
    revalidateInbox()
    return { success: true, attachmentIds: ids }
  } catch (error) {
    console.error(`[inbox] ${failure.log} failed:`, error instanceof Error ? error.message : error)
    return { error: failure.message }
  }
}

export type FileInboxResult =
  | { success: true; recordId: string; href: string }
  | { error: string; fieldErrors?: ServiceRecordFieldErrors }

/** Files the item as a new service record, optionally completing one of the asset's reminders (scheduleId). */
export async function fileInboxItem(id: string, data: ServiceRecordInput): Promise<FileInboxResult> {
  const session = await requireUser()
  const prepared = await prepareNewServiceRecord(data, session.user.id)
  if ("error" in prepared) return { error: "Check the highlighted fields.", fieldErrors: prepared.error }
  const { row } = prepared.ok
  if (!(await assetExists(row.assetType, row.assetId))) return { error: "That asset no longer exists." }

  const recordId = newRecordId()
  const done = await moveOut(id, { kind: "SERVICE", recordId }, () => [...newServiceRecordWrites(prepared.ok, recordId)], {
    log: "filing",
    message: "Couldn't file this item. Nothing was changed; try again.",
  })
  if ("error" in done) return done
  revalidateNewServiceRecord(prepared.ok)
  return { success: true, recordId, href: `${assetHref(row.assetType, row.assetId)}?tab=${row.assetType === "PERSON" ? "visits" : "service"}&open=${recordId}` }
}

export type InboxActionResult = { success: true; href: string } | { error: string }

/** Keeps the item's files on an asset as documents (manual, title, warranty card), with no record around them. */
export async function keepAsDocument(id: string, assetType: AssetType, assetId: string): Promise<InboxActionResult> {
  await requireUser()
  const parsed = fileSchema.safeParse({ assetType, assetId })
  if (!parsed.success) return { error: "Invalid input" }
  if (!(await assetExists(parsed.data.assetType, parsed.data.assetId))) return { error: "That asset no longer exists." }

  const target: FileTarget = { kind: "DOCUMENT", assetType: parsed.data.assetType, assetId: parsed.data.assetId }
  const done = await moveOut(id, target, () => [], {
    log: "keep as document",
    message: "Couldn't move this item. Nothing was changed; try again.",
  })
  if ("error" in done) return done
  const href = assetHref(parsed.data.assetType, parsed.data.assetId)
  revalidatePath(href)
  return { success: true, href: `${href}?tab=documents` }
}

const attachSchema = z.object({ recordType: z.enum(ATTACH_KINDS), recordId: z.string().min(1) })

/** The asset a service record or warranty sits on; null if it's gone, or a person's while Health is off. */
async function attachableRecord(kind: AttachKind, id: string): Promise<{ assetType: AssetType; assetId: string } | null> {
  const query = { where: { id }, select: { assetType: true, assetId: true } } as const
  const record = kind === "SERVICE" ? await prisma.serviceRecord.findUnique(query) : await prisma.warranty.findUnique(query)
  if (!record) return null
  // A person's records go with the rest of Health, like the upload route's.
  if (record.assetType === "PERSON" && !(await loadFeatures()).health) return null
  return record
}

/**
 * Attaches the item's files to a service record or warranty that already
 * exists (entered by hand before the receipt turned up). Pure attach: the
 * record's own fields, cost and vendor included, are left as they are.
 */
export async function attachToRecord(itemId: string, recordType: AttachKind, recordId: string): Promise<InboxActionResult> {
  await requireUser()
  const parsed = attachSchema.safeParse({ recordType, recordId })
  if (!parsed.success) return { error: "Invalid input" }
  const { recordType: kind, recordId: id } = parsed.data
  const owner = await attachableRecord(kind, id)
  if (!owner) return { error: "That record no longer exists." }

  const done = await moveOut(
    itemId,
    { kind, recordId: id },
    // Fails the transaction (moving the files back) if the record was deleted since the check above.
    () => [
      kind === "SERVICE"
        ? prisma.serviceRecord.update({ where: { id }, data: {}, select: { id: true } })
        : prisma.warranty.update({ where: { id }, data: {}, select: { id: true } }),
    ],
    { log: "attach to record", message: "Couldn't attach this item. Nothing was changed; try again." }
  )
  if ("error" in done) return done
  revalidatePath(assetHref(owner.assetType, owner.assetId))
  revalidatePath(kind === "SERVICE" ? "/records" : "/warranties")
  return { success: true, href: assetRecordHref(kind, id, owner) }
}

/** "Attach to record": an asset's most recent service records and warranties, newest first. */
export async function listAttachCandidates(assetType: AssetType, assetId: string): Promise<{ success: true; candidates: AttachCandidate[] } | { error: string }> {
  await requireUser()
  const parsed = fileSchema.safeParse({ assetType, assetId })
  if (!parsed.success) return { error: "Invalid input" }
  if (!(await assetExists(parsed.data.assetType, parsed.data.assetId))) return { error: "That asset no longer exists." }
  const where = { assetType: parsed.data.assetType, assetId: parsed.data.assetId }
  const [records, warranties] = await Promise.all([
    prisma.serviceRecord.findMany({ where, orderBy: { date: "desc" }, take: 25, select: { id: true, date: true, title: true, cost: true } }),
    prisma.warranty.findMany({ where, orderBy: { purchaseDate: "desc" }, take: 10, select: { id: true, purchaseDate: true, productName: true } }),
  ])
  return {
    success: true,
    candidates: [
      ...records.map((r) => ({ kind: "SERVICE" as const, id: r.id, date: r.date, title: r.title, cost: r.cost })),
      ...warranties.map((w) => ({ kind: "WARRANTY" as const, id: w.id, date: w.purchaseDate, title: w.productName, cost: null })),
    ],
  }
}

/** Deletes the item, its files and their search entries. */
export async function discardInboxItem(id: string): Promise<{ success: true } | { error: string }> {
  await requireUser()
  const item = await prisma.inboxItem.findUnique({ where: { id }, select: { id: true, attachments: { select: { id: true } } } })
  if (!item) return { error: "Not found" }
  // Cascades to the attachments and their extracted text.
  await prisma.inboxItem.delete({ where: { id: item.id } })
  await removeUploadDir("inbox", item.id)
  // Best effort: reconcile() removes anything left behind.
  const ids = item.attachments.map((a) => a.id)
  if (ids.length) await searchIndex().then((index) => index.remove(ids)).catch(() => {})
  revalidateInbox()
  return { success: true }
}

/** "Re-read": runs the receipt reader and asset match again, e.g. after changing the setting. */
export async function reparseInboxItem(id: string): Promise<{ success: true; status: InboxStatus } | { error: string }> {
  await requireUser()
  if (!(await prisma.inboxItem.findUnique({ where: { id }, select: { id: true } }))) return { error: "Not found" }
  await processInboxItem(id)
  const after = await prisma.inboxItem.findUnique({ where: { id }, select: { status: true } })
  revalidatePath("/intake")
  return after ? { success: true, status: after.status } : { error: "Not found" }
}

const parserSchema = z.enum(["OFF", "BASIC", "LLM"])

/** Settings → "Receipt reading". Admins only. */
export async function setCaptureParser(mode: CaptureParser): Promise<{ success: true; mode: CaptureParser } | { error: string }> {
  await requireAdmin()
  const parsed = parserSchema.safeParse(mode)
  if (!parsed.success) return { error: "Invalid input." }
  if (!captureParserAllowed(parsed.data, isLlmReady(await loadLlmConfig()))) {
    return { error: "Set up the assistant's model under Assistant first." }
  }
  await prisma.documentSettings.upsert({
    where: { id: DOCUMENT_SETTINGS_ID },
    create: { id: DOCUMENT_SETTINGS_ID, captureParser: parsed.data },
    update: { captureParser: parsed.data },
  })
  revalidatePath("/settings")
  return { success: true, mode: parsed.data }
}
