import type { AssetType, CaptureParser, DocumentTextStatus } from "@/app/generated/prisma/client"
import type { MovePlan } from "@/lib/capture/move"

// Rules for the capture inbox that don't need the database or the disk. The
// server side (lib/capture-server.ts, lib/actions/inbox.ts) only wires these up.

/** An item whose upload never arrived is cleaned up after this long. */
export const EMPTY_ITEM_MAX_AGE_MS = 60 * 60 * 1000

export function isStaleEmptyItem(item: { createdAt: Date; attachmentCount: number }, now: Date = new Date()): boolean {
  return item.attachmentCount === 0 && now.getTime() - item.createdAt.getTime() > EMPTY_ITEM_MAX_AGE_MS
}

export type StoredText = { status: DocumentTextStatus; text: string | null; error: string | null }

export type InboxText =
  | { kind: "wait" }
  | { kind: "failed"; error: string }
  | { kind: "text"; text: string }

/**
 * What an item's files say once read. Waits for every file; fails only when
 * nothing was read and something failed. Files with no text (a photo with OCR
 * off) give an empty read, so the item is still ready to file by hand.
 * While indexing is off, unread files count as having no text.
 */
export function inboxText(texts: StoredText[], opts: { indexing: boolean } = { indexing: true }): InboxText {
  // With indexing off nothing will read a PENDING file, so waiting would be forever.
  if (!texts.length || (opts.indexing && texts.some((t) => t.status === "PENDING"))) return { kind: "wait" }
  const read = texts.filter((t) => t.status === "DONE" && t.text).map((t) => t.text as string)
  if (read.length) return { kind: "text", text: read.join("\f") }
  const failed = texts.find((t) => t.status === "FAILED")
  if (failed) return { kind: "failed", error: failed.error ?? "Couldn't read this file" }
  return { kind: "text", text: "" }
}

export type ParserChoice = "none" | "basic" | "llm"

/**
 * Local AI only when the assistant is ready, and never for a file that looks
 * like a person's unless health documents may go to the LLM.
 */
export function chooseParser(c: {
  mode: CaptureParser
  llmReady: boolean
  suggestedAssetType: AssetType | null
  healthDocumentsEnabled: boolean
}): ParserChoice {
  if (c.mode === "OFF") return "none"
  if (c.mode === "BASIC" || !c.llmReady) return "basic"
  if (c.suggestedAssetType === "PERSON" && !c.healthDocumentsEnabled) return "basic"
  return "llm"
}

export type ParsedReceiptLike = { date: string | null; total: number | null; vendor: string | null }

export function parsedFields(parsed: ParsedReceiptLike | null, method: "basic" | "llm" | null) {
  const date = parsed?.date && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date) ? new Date(`${parsed.date}T00:00:00Z`) : null
  return {
    // A day like 2026-02-30 rolls over in Date; only keep it if it survives the round trip.
    parsedDate: date && !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === parsed?.date ? date : null,
    parsedTotal: parsed?.total ?? null,
    parsedVendor: parsed?.vendor ?? null,
    parseMethod: method,
  }
}

export type FileTarget =
  | { kind: "SERVICE"; recordId: string }
  | { kind: "DOCUMENT"; assetType: AssetType; assetId: string }

/** The attachment columns once the file leaves the inbox; every other owner key is already null. */
export function filedAttachmentData(t: FileTarget) {
  return t.kind === "SERVICE"
    ? { recordType: "SERVICE" as const, serviceRecordId: t.recordId, assetType: null, assetId: null, inboxItemId: null }
    : { recordType: "DOCUMENT" as const, serviceRecordId: null, assetType: t.assetType, assetId: t.assetId, inboxItemId: null }
}

/** The upload directory a filed file moves to: [recordType, recordId]. */
export function targetDir(t: FileTarget): { recordType: string; recordId: string } {
  return t.kind === "SERVICE" ? { recordType: "SERVICE", recordId: t.recordId } : { recordType: "DOCUMENT", recordId: t.assetId }
}

export type MoveFs = {
  mkdir(dir: string): Promise<unknown>
  rename(from: string, to: string): Promise<void>
}

/**
 * Moves the files, then commits the database change. A failed move or commit
 * moves back whatever had moved (latest first) and rethrows the first error,
 * so the files always end up where the database says they are.
 */
export async function moveWithRollback<T>(
  plans: MovePlan[],
  fs: MoveFs,
  commit: () => Promise<T>,
  onUndoError: (error: unknown, plan: MovePlan) => void = () => {}
): Promise<T> {
  const moved: MovePlan[] = []
  const undo = async () => {
    for (const p of [...moved].reverse()) {
      try {
        await fs.rename(p.toPath, p.fromPath)
      } catch (error) {
        onUndoError(error, p)
      }
    }
  }
  try {
    for (const dir of new Set(plans.map((p) => p.toDir))) await fs.mkdir(dir)
    for (const p of plans) {
      await fs.rename(p.fromPath, p.toPath)
      moved.push(p)
    }
  } catch (error) {
    await undo()
    throw error
  }
  try {
    return await commit()
  } catch (error) {
    await undo()
    throw error
  }
}
